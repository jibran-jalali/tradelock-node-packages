import http from 'node:http';
import dgram from 'node:dgram';
import {readTailscaleStatus,findPairedPeer} from './tailscale.mjs';
import {readFileSync,writeFileSync,existsSync,mkdirSync,readdirSync,openSync,closeSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {hostname,networkInterfaces} from 'node:os';
import {randomBytes,timingSafeEqual,createHash,createHmac} from 'node:crypto';
import {isIP} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire(import.meta.url);
const {JsonRpcProvider,Contract,Wallet,Transaction}=require('../vendor/ethers.cjs');
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1]};
const configPath=resolve(arg('--config')||join(root,'config/node.json'));
const config=JSON.parse(readFileSync(configPath,'utf8').replace(/^\uFEFF/,''));
const descriptor=JSON.parse(readFileSync(join(root,'config/contract.json'),'utf8'));
const data=resolve(arg('--data')||join(root,'data/node'));
mkdirSync(data,{recursive:true});
const token=randomBytes(24).toString('hex');
let vpn={connected:false,ownIp:null,peers:[],status:'CHECKING TAILSCALE'},lastVpnCheck=0,manuallyStopped=false;
const expected=(config.role==='host'?config.hostPublicKey:config.friendPublicKey).toLowerCase();
const other=(config.role==='host'?config.friendPublicKey:config.hostPublicKey).toLowerCase();
const rpcUrl=`http://127.0.0.1:${config.rpcPort}`;
const provider=new JsonRpcProvider(rpcUrl,undefined,{cacheTimeout:-1,pollingInterval:1000});
const readJson=path=>{try{return JSON.parse(readFileSync(path,'utf8'))}catch{return null}};
const events=[];
let child=null,stopping=false,polling=false,remote=null,lastRemote=0,lastHead=null,lastAdvance=0,connectedSince=0,lastRestart=0;
let error='',deployment=null,deploying=false,lastSettlement=0,settling=false;
let local={online:false,role:config.role,computer:hostname(),publicKey:expected,peerIds:[],block:0,hash:null,syncing:false,verification:!!config.verification};
let peerEndpoint=config.transport==='tailscale'?null:config.role==='friend'?`http://${config.hostIp}:${config.hostControlPort}`:readJson(join(data,'peer.json'))?.endpoint;
const publicDevSupplierKey='0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
export const allowedMethods=new Set(['eth_chainId','net_version','eth_blockNumber','eth_getBalance','eth_getCode','eth_call','eth_getLogs','eth_getBlockByNumber','eth_getBlockByHash','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getTransactionCount','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_sendRawTransaction']);
function event(message){events.unshift({time:new Date().toISOString(),message});events.splice(50);console.log(message)}
function loopback(ip){return ip==='::1'||ip?.startsWith('127.')||ip?.startsWith('::ffff:127.')}
function privateIp(ip){return isIP(ip)===4&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip)}
function lanIp(){return config.verification?'127.0.0.1':config.advertisedIp||Object.values(networkInterfaces()).flat().find(a=>a?.family==='IPv4'&&!a.internal&&privateIp(a.address))?.address||'127.0.0.1'}
function equalToken(value){const a=Buffer.from(value||''),b=Buffer.from(config.networkToken);return a.length===b.length&&timingSafeEqual(a,b)}
async function rpc(method,params=[]){const r=await fetch(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(4000)});const b=await r.json();if(b.error)throw Error(b.error.message);return b.result}
function snapshot(){return {...local,protocolVersion:2,networkId:config.networkId,genesisHash:descriptor.genesisHash,controlPort:config.controlPort,p2pPort:config.p2pPort,updatedAt:Date.now()}}
function state(){
 const remoteOnline=!!(remote?.online&&Date.now()-lastRemote<10000);
 const connected=local.online&&local.peerIds.includes(other);
 const syncing=local.syncing||!!(remoteOnline&&remote.syncing);
 const sameHead=remoteOnline&&Math.abs(remote.block-local.block)<=2;
 const advancing=(config.transport!=='tailscale'||vpn.connected)&&connected&&remoteOnline&&remote.protocolVersion===2&&!syncing&&sameHead&&lastAdvance>0&&Date.now()-lastAdvance<15000;
 const ready=advancing&&!!deployment;
 const consensus=!local.online?'THIS NODE OFFLINE':!remoteOnline?'WAITING FOR SECOND NODE':syncing?'SYNCHRONIZING':!connected?'CONNECTING PEERS':remote.protocolVersion!==2?'UPDATE SECOND NODE':!sameHead?'SYNCHRONIZING HEADS':!advancing?'RECOVERING CONSENSUS':!deployment?'REGISTERING CONTRACT':'NETWORK READY';
 return {protocolVersion:2,deviceRole:config.deviceRole||null,transport:config.transport==='tailscale'?{mode:'tailscale',connected:vpn.connected,address:vpn.ownIp,status:vpn.status}:{mode:'local-test',connected:true,status:'LOCAL TWO-PROCESS VERIFICATION'},role:config.role,controlToken:token,hostAddress:config.role==='host'?lanIp():config.hostIp,networkId:config.networkId,chainId:31337,configuredNodes:2,onlineNodes:Number(local.online)+Number(remoteOnline),connectedPeers:local.peerIds.length,connected,advancing,ready,consensus,local,remote:remoteOnline?remote:null,events,error,deployment:deployment?{address:deployment.address,blockNumber:deployment.blockNumber}:null,gateway:`http://${lanIp()}:${config.controlPort}`,settlementWorkerActive:Date.now()-lastSettlement<25000};
}
function runtimePath(folder,ending){const base=join(root,'runtime',folder);const version=readdirSync(base).find(n=>existsSync(join(base,n,ending)));if(!version)throw Error(`Missing ${folder} runtime. Run SETUP.bat.`);return join(base,version,ending)}
async function startNode(){
 if(child&&child.exitCode===null)return;
 if(config.transport==='tailscale'&&!config.advertisedIp){error='Sign in to Tailscale to connect this device.';return;}
 try{const info=await rpc('admin_nodeInfo');if(info.id.replace(/^0x/,'').toLowerCase()===expected)throw Error('Node already running under another launcher. Close it first.');throw Error('RPC port occupied by another node.')}catch(e){if(/already running|occupied/.test(e.message))throw e}
 if(config.role==='friend'&&config.hostIp)writeFileSync(join(data,'static-nodes.json'),JSON.stringify([`enode://${config.hostPublicKey}@${config.hostIp}:${config.hostP2pPort}`]));
 const lib=runtimePath('besu','lib');
 const args=['-Dvertx.disableFileCPResolving=true',`-Dbesu.home=${dirname(lib)}`,'-Dlog4j.shutdownHookEnabled=false','-Djava.util.logging.manager=org.apache.logging.log4j.jul.LogManager','--add-opens=java.base/sun.security.provider=ALL-UNNAMED','--add-opens=java.base/java.util=ALL-UNNAMED','--add-opens=java.base/java.nio=ALL-UNNAMED','--add-exports=java.base/jdk.internal.misc=ALL-UNNAMED','-Dio.netty.tryReflectionSetAccessible=true','--sun-misc-unsafe-memory-access=allow','-Xms64m','-Xmx512m','-XX:MaxDirectMemorySize=128m','-XX:ActiveProcessorCount=2','--enable-native-access=ALL-UNNAMED','-cp',join(lib,'*'),'org.hyperledger.besu.Besu',`--data-path=${data}`,`--genesis-file=${join(root,'config/genesis.json')}`,`--node-private-key-file=${resolve(config.keyFile||join(root,'config/node.key'))}`,`--p2p-port=${config.p2pPort}`,`--p2p-host=${lanIp()}`,'--p2p-interface=0.0.0.0','--nat-method=NONE','--discovery-enabled=false','--rpc-http-enabled=true','--rpc-http-host=127.0.0.1',`--rpc-http-port=${config.rpcPort}`,'--rpc-http-api=ETH,NET,WEB3,ADMIN,QBFT','--host-allowlist=localhost,127.0.0.1','--sync-mode=FULL','--data-storage-format=FOREST','--sync-min-peers=1','--min-gas-price=0','--max-peers=4'];
 const out=openSync(join(data,'node.log'),'a'),err=openSync(join(data,'node-error.log'),'a');
 child=spawn(runtimePath('java','bin/java.exe'),args,{cwd:root,windowsHide:true,stdio:['ignore',out,err]});closeSync(out);closeSync(err);
 writeFileSync(join(data,'node.pid'),String(child.pid));lastHead=null;lastAdvance=0;connectedSince=0;error='';
 child.on('error',e=>{error=e.message;event(error)});
 child.on('exit',code=>{child=null;local.online=false;event(`Validator stopped (${code}).`)});
 event('Booting Besu validator. Reading preserved chain database...');
}
async function stopNode(){stopping=true;if(child){const processToStop=child;await new Promise(resolveStop=>{processToStop.once('exit',resolveStop);processToStop.kill()})}local.online=false;lastAdvance=0;stopping=false}
async function restartNode(){await stopNode();await delay(600);await startNode()}
async function peerCall(path,options={}){if(!peerEndpoint)throw Error('Waiting for peer address');const r=await fetch(peerEndpoint+path,{...options,headers:{'Content-Type':'application/json','X-TradeLock-Network':config.networkToken,...options.headers},signal:AbortSignal.timeout(4000)});const b=await r.json();if(!r.ok)throw Error(b.error||'Peer unavailable');return b}
async function verifyContract(){
 if(!local.online||local.syncing)return;
 const code=await rpc('eth_getCode',[descriptor.address,'latest']);
 if(code!=='0x'){
  if(createHash('sha256').update(Buffer.from(code.slice(2),'hex')).digest('hex')!==descriptor.codeSha256)throw Error('Contract code does not match this network. No funds or database were changed.');
  if(deployment)return;
  const cached=readJson(join(data,'deployment.json'))||descriptor.initialDeployment;
  if(cached){const b=await rpc('eth_getBlockByNumber',['0x'+cached.blockNumber.toString(16),false]);if(b?.hash===cached.blockHash){deployment=cached;return}}
  const receipt=await rpc('eth_getTransactionReceipt',[Transaction.from(descriptor.deploymentTransaction).hash]);
  if(receipt?.status==='0x1'){deployment={schemaVersion:2,chainId:31337,address:descriptor.address,abi:descriptor.abi,receiptWindowSeconds:36000,blockNumber:Number(BigInt(receipt.blockNumber)),blockHash:receipt.blockHash,transactionHash:receipt.transactionHash};writeFileSync(join(data,'deployment.json'),JSON.stringify(deployment,null,2));event('Contract registered on the shared chain.');return}
  throw Error('Contract exists but its registration receipt is unavailable.');
 }
 if(config.role!=='host'||!state().advancing||deploying)return;
 const nonce=await rpc('eth_getTransactionCount',['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266','latest']);
 if(nonce!=='0x0')throw Error('Deployment account already used. Refusing to overwrite or reset this chain.');
 deploying=true;
 try{await rpc('eth_sendRawTransaction',[descriptor.deploymentTransaction]);event('Submitted real contract registration transaction.')}catch(e){if(!/already known|known transaction/i.test(e.message))throw e}finally{deploying=false}
}
async function settle(){
 if(config.role!=='host'||!state().ready||settling||Date.now()-lastSettlement<10000)return;
 settling=true;lastSettlement=Date.now();
 try{const c=new Contract(descriptor.address,descriptor.abi,new Wallet(publicDevSupplierKey,provider));const head=await provider.getBlock('latest');const count=Number(await c.tradeCount());
  for(let id=1;id<=count;id++){const t=await c.getTrade(id);if(Number(t.status)===1&&Number(t.releaseDeadline)<=head.timestamp){const tx=await c.claimPayment(id);event(`Deadline payment submitted for trade ${id}: ${tx.hash}`);await tx.wait()}}
 }catch(e){event('Settlement will retry: '+(e.shortMessage||e.message))}finally{settling=false}
}
async function updateTransport(){
 if(config.transport!=='tailscale'||Date.now()-lastVpnCheck<6000)return;
 lastVpnCheck=Date.now();const previous=vpn;vpn=await readTailscaleStatus();
 if(vpn.status!==previous.status)event('TAILSCALE: '+vpn.status);
 if(!vpn.connected)return;
 if(config.advertisedIp&&config.advertisedIp!==vpn.ownIp&&child)await stopNode();
 config.advertisedIp=vpn.ownIp;
 const peer=await findPairedPeer(vpn,config,descriptor);
 if(peer){
  if(peerEndpoint!==peer.endpoint)event('Paired validator found through Tailscale: '+peer.ip);
  peerEndpoint=peer.endpoint;config.hostIp=peer.ip;
  if(local.online)await rpc('admin_addPeer',[`enode://${other}@${peer.ip}:${peer.p2pPort}`]).catch(()=>{});
 }
 if(!child&&!manuallyStopped)await startNode();
}
async function poll(){
 if(polling||stopping)return;polling=true;
 try{
  await updateTransport();
  try{const [info,head,peers,syncing,genesis]=await Promise.all([rpc('admin_nodeInfo'),rpc('eth_getBlockByNumber',['latest',false]),rpc('admin_peers'),rpc('eth_syncing'),rpc('eth_getBlockByNumber',['0x0',false])]);
   if(info.id.replace(/^0x/,'').toLowerCase()!==expected||genesis.hash!==descriptor.genesisHash)throw Error('Wrong node identity or genesis.');
   if(lastHead&&lastHead!==head.hash){lastAdvance=Date.now();event(`COMMIT #${Number(BigInt(head.number))} | ${head.transactions.length} transaction(s) | ${head.hash.slice(0,18)}`)}
   lastHead=head.hash;error="";
   local={...local,online:true,block:Number(BigInt(head.number)),hash:head.hash,peerIds:peers.map(p=>p.id.replace(/^0x/,'').toLowerCase()),syncing:syncing!==false,transactionsInBlock:head.transactions.length,lastAdvance};
  }catch(e){local.online=false;if(!child)error=e.message}
  if(peerEndpoint){try{
   if(config.role==='friend')await peerCall('/network/join',{method:'POST',body:JSON.stringify({protocolVersion:2,controlPort:config.controlPort,p2pPort:config.p2pPort,publicKey:expected,verification:!!config.verification})});
   const next=await peerCall('/network/status');if(next.networkId!==config.networkId||next.publicKey!==other||next.genesisHash!==descriptor.genesisHash)throw Error('Peer network/identity mismatch');remote=next;lastRemote=Date.now();
  }catch{if(Date.now()-lastRemote>10000)remote=null}}
  const s=state();if(s.connected&&s.onlineNodes===2){if(!connectedSince)connectedSince=Date.now()}else connectedSince=0;
  // QBFT round timers grow while the other validator is absent. Restart both engines, never databases.
  if(config.role==='host'&&connectedSince&&Date.now()-connectedSince>22000&&!s.advancing&&!local.syncing&&!remote?.syncing&&Date.now()-lastRestart>90000){lastRestart=Date.now();event('Peer rejoined; recovering stalled QBFT round timers.');await peerCall('/network/recover',{method:'POST',body:JSON.stringify({publicKey:expected})}).catch(e=>{if(!/Recovery not needed/.test(e.message))throw e});await restartNode()}
  await verifyContract();void settle();
 }catch(e){error=e.message}finally{polling=false}
}
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value))}
async function body(req,limit=262144){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>limit)throw Error('Request too large')}return text?JSON.parse(text):{}}
const server=http.createServer(async(req,res)=>{
 try{const url=new URL(req.url,'http://localhost');const source=req.socket.remoteAddress.replace(/^::ffff:/,'');
  if(url.pathname.startsWith('/network/')){
   if(!privateIp(source)||!equalToken(req.headers['x-tradelock-network']))return json(res,{error:'Private network authentication required'},403);
   if(url.pathname==='/network/status'&&req.method==='GET')return json(res,snapshot());
   if(url.pathname==='/network/app'&&req.method==='GET'){const s=state();return json(res,{protocolVersion:2,networkId:config.networkId,genesisHash:descriptor.genesisHash,publicKey:expected,status:{ready:s.ready,consensus:s.consensus,onlineNodes:s.onlineNodes,block:local.block,hash:local.hash,connectedPeers:s.connectedPeers},deployment:local.online?deployment:null,settlementWorkerActive:s.settlementWorkerActive})}
   if(url.pathname==='/network/rpc'&&req.method==='POST'){
    const payload=await body(req);const calls=Array.isArray(payload)?payload:[payload];
    if(!calls.length||calls.length>50||calls.some(c=>!c||!allowedMethods.has(c.method)))return json(res,{error:'RPC method not allowed'},403);
    if(calls.some(c=>c.method==='eth_sendRawTransaction')&&!state().ready)return json(res,{error:'Both nodes must be synchronized and approving blocks before signing a payment.'},503);
    const r=await fetch(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});return json(res,await r.json(),r.status);
   }
   if(url.pathname==='/network/join'&&req.method==='POST'&&config.role==='host'){
    const input=await body(req,4096);if(input.publicKey?.toLowerCase()!==other||!Number.isInteger(input.controlPort)||input.controlPort<1024||input.controlPort>65535||!Number.isInteger(input.p2pPort)||input.p2pPort<1024||input.p2pPort>65535)return json(res,{error:'Invalid peer identity or ports'},400);
    peerEndpoint=`http://${source}:${input.controlPort}`;writeFileSync(join(data,'peer.json'),JSON.stringify({endpoint:peerEndpoint}));
    if(local.online)await rpc('admin_addPeer',[`enode://${other}@${source}:${input.p2pPort}`]).catch(()=>{});return json(res,{joined:true,protocolVersion:2});
   }
   if(url.pathname==='/network/recover'&&req.method==='POST'){
    const input=await body(req,4096);if(input.publicKey!==other||state().advancing||Date.now()-lastRestart<60000)return json(res,{error:'Recovery not needed or already attempted'},409);
    lastRestart=Date.now();setTimeout(()=>restartNode().catch(e=>{error=e.message}),100);return json(res,{recovering:true});
   }
   return json(res,{error:'Unknown network endpoint'},404);
  }
  if(!loopback(req.socket.remoteAddress))return json(res,{error:'Control panel commands are local to this laptop.'},403);
  if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(readFileSync(join(root,'src/index.html')))}
  if(req.method==='GET'&&url.pathname==='/api/status')return json(res,state());
  if(req.method==='GET'&&url.pathname==='/favicon.ico'){res.writeHead(204);return res.end()}
  if(req.method==='POST'&&req.headers['x-control-token']===token){
   if(url.pathname==='/api/start'){manuallyStopped=false;await startNode();return json(res,{ok:true})}
   if(url.pathname==='/api/stop'){manuallyStopped=true;await stopNode();return json(res,{ok:true})}
   if(url.pathname==='/api/restart'){await restartNode();return json(res,{ok:true})}
   if(url.pathname==='/api/host'&&config.role==='friend'){const input=await body(req,4096);if(!privateIp(input.hostIp))throw Error('Enter a LAN or private VPN IPv4 address.');config.hostIp=input.hostIp;peerEndpoint=`http://${config.hostIp}:${config.hostControlPort}`;writeFileSync(configPath,JSON.stringify(config,null,2));if(local.online)await rpc('admin_addPeer',[`enode://${other}@${config.hostIp}:${config.hostP2pPort}`]);return json(res,{ok:true})}
  }
  return json(res,{error:'Request not allowed'},403);
 }catch(e){json(res,{error:e.message},400)}
});
const discovery=dgram.createSocket('udp4');
discovery.on('error',e=>event('LAN discovery unavailable: '+e.message));
discovery.on('message',(bytes,rinfo)=>{try{const query=JSON.parse(bytes.toString());if(query.type!=='TRADELOCK_DISCOVER_V2'||query.networkId!==config.networkId||typeof query.nonce!=='string'||query.nonce.length>100||!privateIp(rinfo.address))return;const response={type:'TRADELOCK_NODE_V2',networkId:config.networkId,nonce:query.nonce,port:config.controlPort,publicKey:expected};response.signature=createHmac('sha256',config.networkToken).update(JSON.stringify(response)).digest('hex');discovery.send(JSON.stringify(response),rinfo.port,rinfo.address)}catch{}});
server.listen(config.controlPort,'0.0.0.0',async()=>{writeFileSync(join(data,'controller.pid'),String(process.pid));event(`TRADELOCK NODE v2 | ${config.role.toUpperCase()} | http://127.0.0.1:${config.controlPort}`);if(config.transport!=='tailscale')discovery.bind(config.discoveryPort||9052,'0.0.0.0');try{if(config.transport!=='tailscale')await startNode()}catch(e){error=e.message}void poll();setInterval(poll,2000);if(!process.argv.includes('--headless'))spawn('cmd.exe',['/d','/c','start','',`http://127.0.0.1:${config.controlPort}`],{windowsHide:true,stdio:'ignore'}).on('error',()=>{})});
server.on('error',e=>{console.error(e.message);process.exitCode=1;discovery.close()});
async function shutdown(){await stopNode();provider.destroy();try{discovery.close()}catch{}server.close();process.exit(0)}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
