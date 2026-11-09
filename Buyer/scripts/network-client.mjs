// Server-side connection discovery. The browser receives neither pairing tokens nor node keys.
import dgram from 'node:dgram';
import {networkInterfaces} from 'node:os';
import {isIP} from 'node:net';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
export const RPC_METHODS=new Set(['eth_chainId','net_version','eth_blockNumber','eth_getBalance','eth_getCode','eth_call','eth_getLogs','eth_getBlockByNumber','eth_getBlockByHash','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getTransactionCount','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_sendRawTransaction']);
let cached=null,validUntil=0,pending=null,extraCandidates=[],lastDiscovery=0;
export function isPrivateAddress(ip){return isIP(ip)===4&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip)}
export function validateGateway(value){const u=new URL(value);if(u.protocol!=='http:'||!isPrivateAddress(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!u.port||Number(u.port)<1024||Number(u.port)>65535)throw Error('Gateway must be a LAN/private VPN IPv4 address and port.');return u.origin}
function connection(){try{const value=JSON.parse(readFileSync(join(process.cwd(),'lib/network-connection.json'),'utf8'));if(process.env.TRADELOCK_LOCAL_GATEWAY)value.gateways=[validateGateway(process.env.TRADELOCK_LOCAL_GATEWAY)];return value}catch{throw Error('Network pairing profile is missing. Use the configured TradeLock website package.')}}
export function validateAnnouncement(value,config){if(value.protocolVersion!==2||value.networkId!==config.networkId||value.genesisHash!==config.genesisHash||!config.validatorKeys.includes(value.publicKey)||value.deployment&&value.deployment.address.toLowerCase()!==config.contractAddress.toLowerCase())throw Error('Node belongs to a different network or contract.');return value}
export async function discoverNodes(config,timeout=650){
 return new Promise(resolve=>{
  const socket=dgram.createSocket('udp4'),found=new Set(),nonce=randomBytes(16).toString('hex');let finished=false;
  const finish=()=>{if(finished)return;finished=true;try{socket.close()}catch{}resolve([...found])};
  const timer=setTimeout(finish,timeout);socket.on('error',()=>{clearTimeout(timer);finish()});
  socket.on('message',(bytes,rinfo)=>{try{const b=JSON.parse(bytes.toString());const signature=b.signature;delete b.signature;if(b.type!=='TRADELOCK_NODE_V2'||b.networkId!==config.networkId||b.nonce!==nonce||!config.validatorKeys.includes(b.publicKey)||typeof signature!=='string'||signature.length!==64)return;const expected=createHmac('sha256',config.networkToken).update(JSON.stringify(b)).digest('hex');if(!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return;found.add(validateGateway(`http://${rinfo.address}:${b.port}`))}catch{}});
  socket.bind(0,'0.0.0.0',()=>{socket.setBroadcast(true);const targets=new Set(['127.0.0.1','255.255.255.255']);for(const entry of Object.values(networkInterfaces()).flat()){if(entry?.family!=='IPv4'||entry.internal||!isPrivateAddress(entry.address))continue;const address=entry.address.split('.').map(Number),mask=entry.netmask.split('.').map(Number);targets.add(address.map((v,i)=>v|(~mask[i]&255)).join('.'))}const request=Buffer.from(JSON.stringify({type:'TRADELOCK_DISCOVER_V2',networkId:config.networkId,nonce}));for(const target of targets)socket.send(request,9052,target,()=>{})});
 });
}
async function inspect(base,config){base=validateGateway(base);const r=await fetch(base+'/network/app',{headers:{'X-TradeLock-Network':config.networkToken},cache:'no-store',signal:AbortSignal.timeout(1400)});if(!r.ok)throw Error('Node gateway unavailable');const value=validateAnnouncement(await r.json(),config);if(!value.deployment)throw Error('Node is starting or contract registration is pending.');return {...value,endpoint:base}}
export async function resolveNetwork(force=false){
 if(!force&&cached&&Date.now()<validUntil)return cached;
 if(pending)return pending;
 pending=(async()=>{
  const config=connection();let saved=[];try{saved=JSON.parse(readFileSync(join(process.cwd(),'.runtime/discovered-nodes.json'),'utf8'))}catch{}
  const endpoints=config.localOnly?config.gateways:[...(process.env.TRADELOCK_NODE_URLS||'').split(',').filter(Boolean),cached?.endpoint,...extraCandidates,...saved,...config.gateways].filter(Boolean);
  let results=await Promise.allSettled([...new Set(endpoints)].map(e=>inspect(e,config)));
  let available=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
  if(!config.localOnly&&(!available.length||Date.now()-lastDiscovery>30000)){lastDiscovery=Date.now();extraCandidates=await discoverNodes(config);const more=await Promise.allSettled(extraCandidates.filter(e=>!endpoints.includes(e)).map(e=>inspect(e,config)));available.push(...more.filter(r=>r.status==='fulfilled').map(r=>r.value));try{mkdirSync(join(process.cwd(),'.runtime'),{recursive:true});writeFileSync(join(process.cwd(),'.runtime/discovered-nodes.json'),JSON.stringify([...new Set([...saved,...extraCandidates])]))}catch{}}
  if(!available.length){cached=null;throw Error('No blockchain node is reachable. Start Node A and Node B, then wait for NETWORK READY. The website reconnects automatically.');}
  cached=available.find(n=>n.status.ready)||available[0];validUntil=Date.now()+1500;return cached;
 })();
 try{return await pending}finally{pending=null}
}
export async function relayRpc(payload){
 const calls=Array.isArray(payload)?payload:[payload];
 if(!calls.length||calls.length>50||calls.some(c=>!c||!RPC_METHODS.has(c.method)))return {status:403,body:{error:'RPC method not allowed'}};
 for(let attempt=0;attempt<2;attempt++){
  try{const node=await resolveNetwork(attempt>0);if(calls.some(c=>c.method==='eth_sendRawTransaction')&&!node.status.ready)return {status:503,body:{error:'Both node panels must show NETWORK READY before submitting a transaction.'}};
   const config=connection();const r=await fetch(node.endpoint+'/network/rpc',{method:'POST',headers:{'Content-Type':'application/json','X-TradeLock-Network':config.networkToken},body:JSON.stringify(payload),cache:'no-store',signal:AbortSignal.timeout(16000)});if(r.status>=500&&attempt===0){validUntil=0;continue}return {status:r.status,body:await r.json()};
  }catch(error){validUntil=0;if(attempt)throw error}
 }
 throw Error('Blockchain gateways are unavailable.');
}
export function resetConnectionCache(){cached=null;validUntil=0;lastDiscovery=0;extraCandidates=[]}
