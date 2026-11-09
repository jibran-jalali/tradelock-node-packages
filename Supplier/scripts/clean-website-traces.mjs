// Next's Windows tracer can retain broad filesystem globs. Keep node secrets/data out of website manifests.
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join,dirname,resolve,relative} from 'node:path';
const root=process.cwd();let removed=0;
function excluded(path){const rel=relative(root,path).replaceAll('\\','/');return ['node/','.runtime/','.git/','Buyer/','Supplier/','installers/'].some(prefix=>rel.startsWith(prefix))}
async function visit(folder){for(const item of await readdir(folder,{withFileTypes:true})){const path=join(folder,item.name);if(item.isDirectory())await visit(path);else if(item.name.endsWith('.nft.json')){const trace=JSON.parse(await readFile(path,'utf8'));const files=trace.files.filter(file=>!excluded(resolve(dirname(path),file)));removed+=trace.files.length-files.length;if(files.length!==trace.files.length)await writeFile(path,JSON.stringify({...trace,files}));if(files.some(file=>excluded(resolve(dirname(path),file))))throw Error('Private node path remained in a website trace.')}}}
await visit(join(root,'.next'));console.log(`Website tracing cleaned: ${removed} node/data/temporary references removed.`);
