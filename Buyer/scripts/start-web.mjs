// Website only: never starts Hardhat, a validator, a deployment, or a settlement worker.
import {spawn,spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync,mkdirSync,openSync,closeSync,writeFileSync} from 'node:fs';
import {createConnection} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
const root=dirname(dirname(fileURLToPath(import.meta.url)));process.chdir(root);
const occupied=await new Promise(resolve=>{const socket=createConnection({host:'localhost',port:3000});socket.once('connect',()=>{socket.destroy();resolve(true)});socket.once('error',()=>resolve(false))});
if(occupied){const response=await fetch('http://localhost:3000');if(!response.ok||!(await response.text()).includes('TradeLock'))throw Error('Port 3000 belongs to another application.');console.log('Reusing TradeLock website: http://localhost:3000');}
else{
 const npmCli=process.env.npm_execpath||join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
 for(const args of [!existsSync('node_modules/.package-lock.json')?['ci']:null,!existsSync('.next/BUILD_ID')?['run','build']:null].filter(Boolean)){const result=spawnSync(process.execPath,[npmCli,...args],{cwd:root,stdio:'inherit',windowsHide:true});if(result.status!==0)process.exit(result.status||1)}
 mkdirSync('.runtime',{recursive:true});const out=openSync('.runtime/web.log','a'),err=openSync('.runtime/web-error.log','a');
 const child=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'start','--hostname','localhost'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',out,err]});closeSync(out);closeSync(err);child.on('error',e=>console.error(e.message));child.unref();writeFileSync('.runtime/web.pid',String(child.pid));
 let ready=false;for(let i=0;i<60;i++){await delay(500);try{if((await fetch('http://localhost:3000')).ok){ready=true;break}}catch{}}if(!ready)throw Error('Website did not start. Check .runtime/web-error.log.');
 console.log('Website ready: http://localhost:3000');
}
console.log('Run the two node panels separately. The website discovers their shared network automatically.');
console.log('No reachable nodes = waiting mode. No Hardhat fallback or separate chain is started.');
