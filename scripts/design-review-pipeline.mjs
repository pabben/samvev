// Private staging and explicit activation for the existing synthetic LAN QA lane.
import {createHash,randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile,rename,lstat,stat,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {root,clone,localRoot,verifyInputs,directoryHashes,distHashes,captureRuntimeState,writeRuntimeProof,writeProof,requireAppRecreation,directApiCommand} from './design-review-provenance.mjs';
const app='samvev-m1-qa-app-1',worker='samvev-m1-qa-worker-1';
const pointer=resolve(localRoot,'staged-build.json');
const hash=value=>createHash('sha256').update(value).digest('hex');
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const run=(binary,args,options={})=>execFileSync(binary,args,{encoding:'utf8',maxBuffer:16*1024*1024,...options});
const docker=args=>run('docker',args);
const inspect=name=>JSON.parse(docker(['inspect',name]))[0];
export function requireSameBytes(actual,expected,message){if(stable(actual)!==stable(expected))throw new Error(message);}
export function safeStagePath(stage,base=localRoot){const path=resolve(stage);if(dirname(path)!==resolve(base,'staged')||!/^[a-f0-9]{40}-[a-f0-9-]{36}$/.test(relative(resolve(base,'staged'),path)))throw new Error('Unsafe staged artifact path.');return path;}
export async function requireStageProof(proof,inputs,{base=localRoot}={}){
 if(proof?.version!==1||proof.sourceSha!==inputs.sourceSha||proof.inputFingerprint!==inputs.inputFingerprint||!/^sha256:[a-f0-9]{64}$/.test(proof.builderImageId??'')||!/^v24\./.test(proof.nodeVersion??''))throw new Error('Staged build provenance does not match canonical inputs.');
 safeStagePath(proof.stageDir,base);requireSameBytes(JSON.parse(await readFile(resolve(proof.stageDir,'stage-provenance.json'),'utf8')),proof,'Staged pointer differs from the retained build manifest.');requireSameBytes(await directoryHashes(resolve(proof.stageDir,'dist')),proof.distHashes,'Staged artifact changed after build.');return proof;
}
export function composeFiles(raw,base=root){
 const labels=raw.Config.Labels??{};
 if(labels['com.docker.compose.project']!=='samvev-m1'||labels['com.docker.compose.service']!=='qa-app'||resolve(labels['com.docker.compose.project.working_dir']??'')!==resolve(base))throw new Error('QA Compose ownership changed.');
 const values=(labels['com.docker.compose.project.config_files']??'').split(',').filter(Boolean);
 if(values[0]!==resolve(base,'compose.yaml'))throw new Error('QA Compose base file changed.');
 const recoverStdin=values.includes('-');if(recoverStdin&&(values.length!==2||values[1]!=='-'))throw new Error('Unrecognized stdin Compose configuration.');
 const files=values.filter(path=>path!=='-').map(path=>resolve(base,path));
 if(!files.length||files.some(path=>relative(base,path).startsWith('..')||!existsSync(path)))throw new Error('QA Compose source files are missing or outside this repository.');
 return {files,recoverStdin};
}

export function activationOverride(raw){return {services:{'qa-app':{image:raw.Image,command:directApiCommand,hostname:raw.Config.Hostname}}};}
export function recoveredStdinOverride(raw,baseConfig){
 const c={...activationOverride(raw).services['qa-app'],environment:env(raw.Config.Env),user:raw.Config.User,working_dir:raw.Config.WorkingDir,entrypoint:raw.Config.Entrypoint,init:Boolean(raw.HostConfig.Init),restart:raw.HostConfig.RestartPolicy?.Name??'no',read_only:Boolean(raw.HostConfig.ReadonlyRootfs),privileged:Boolean(raw.HostConfig.Privileged)};
 c.labels=Object.fromEntries(Object.entries(raw.Config.Labels??{}).filter(([name])=>!name.startsWith('com.docker.compose.')));
 c.volumes=raw.Mounts.map(m=>{let source=m.Source;if(m.Type==='volume'){source=Object.keys(baseConfig.volumes??{}).find(key=>baseConfig.volumes[key].name===m.Name);if(!source)throw new Error('Active QA volume is not present in the resolved base configuration.');}if(!['bind','volume'].includes(m.Type))throw new Error('Unsupported recovered QA mount type.');return{type:m.Type,source,target:m.Destination,read_only:!m.RW};});
 c.ports=Object.entries(raw.HostConfig.PortBindings??{}).flatMap(([port,rows])=>rows.map(row=>{const[target,protocol]=port.split('/');return{target:Number(target),published:row.HostPort,host_ip:row.HostIp,protocol};}));
 for(const [field,key]of [['security_opt','SecurityOpt'],['cap_add','CapAdd'],['cap_drop','CapDrop']])if(raw.HostConfig[key]?.length)c[field]=raw.HostConfig[key];
 if(raw.HostConfig.Tmpfs&&Object.keys(raw.HostConfig.Tmpfs).length)c.tmpfs=Object.entries(raw.HostConfig.Tmpfs).map(([path,options])=>`${path}:${options}`);
 if(raw.Config.Healthcheck){const h=raw.Config.Healthcheck;c.healthcheck={test:h.Test,...Object.fromEntries([['interval','Interval'],['timeout','Timeout'],['start_period','StartPeriod'],['start_interval','StartInterval']].filter(([,key])=>h[key]!==undefined).map(([key,field])=>[key,`${h[field]}ns`])),...(h.Retries===undefined?{}:{retries:h.Retries})};}
 return{services:{'qa-app':c}};
}
function env(values=[]){return Object.fromEntries(values.map(value=>{const at=value.indexOf('=');return[value.slice(0,at),value.slice(at+1)];}));}
// Reject drift in the resolved Compose model before stopping/replacing anything.
export function requireComposeApp(config,raw,image){
 const appConfig=config.services?.['qa-app'];if(!appConfig)throw new Error('Resolved QA app missing.');
 const expectedEnv={...env(image.Config.Env),...(appConfig.environment??{})};
 requireSameBytes(expectedEnv,env(raw.Config.Env),'Resolved QA environment differs from active environment.');
 requireSameBytes(appConfig.command,directApiCommand,'Resolved QA command can build.');
 for(const [actual,expected,label] of [[appConfig.image,raw.Image,'image'],[String(appConfig.user??image.Config.User??''),String(raw.Config.User??''),'user'],[appConfig.hostname,raw.Config.Hostname,'hostname'],[appConfig.working_dir??image.Config.WorkingDir,raw.Config.WorkingDir,'working directory'],[Boolean(appConfig.read_only),Boolean(raw.HostConfig.ReadonlyRootfs),'read-only mode'],[Boolean(appConfig.privileged),Boolean(raw.HostConfig.Privileged),'privileged mode'],[Boolean(appConfig.init),Boolean(raw.HostConfig.Init),'init'],[appConfig.restart??'no',raw.HostConfig.RestartPolicy?.Name??'no','restart policy']])if(actual!==expected)throw new Error(`Resolved QA ${label} changed.`);
 requireSameBytes(appConfig.entrypoint??image.Config.Entrypoint??[],raw.Config.Entrypoint??[],'Resolved QA entrypoint changed.');
 const mounts=(appConfig.volumes??[]).map(m=>{if(typeof m!=='object')throw new Error('Unresolved short mount syntax.');return [m.type,m.type==='bind'?resolve(m.source):(config.volumes?.[m.source]?.name??m.source),m.target,!m.read_only];}).sort((a,b)=>a[2].localeCompare(b[2]));
 const actualMounts=raw.Mounts.map(m=>[m.Type,m.Type==='bind'?m.Source:m.Name,m.Destination,m.RW]).sort((a,b)=>a[2].localeCompare(b[2]));requireSameBytes(mounts,actualMounts,'Resolved QA mounts differ.');
 const ports=(appConfig.ports??[]).map(p=>[`${p.target}/${p.protocol??'tcp'}`,p.host_ip??'0.0.0.0',String(p.published)]).sort();const actualPorts=Object.entries(raw.HostConfig.PortBindings??{}).flatMap(([target,rows])=>rows.map(p=>[target,p.HostIp,p.HostPort])).sort();requireSameBytes(ports,actualPorts,'Resolved QA ports differ.');
 for(const [field,host] of [['security_opt','SecurityOpt'],['cap_add','CapAdd'],['cap_drop','CapDrop']])requireSameBytes([...(appConfig[field]??[])].sort(),[...(raw.HostConfig[host]??[])].sort(),`Resolved QA ${field} changed.`);
 if((appConfig.network_mode??null)!==null||stable(Object.keys(appConfig.networks??{}).map(name=>config.networks?.[name]?.name??name).sort())!==stable(Object.keys(raw.NetworkSettings.Networks).sort()))throw new Error('Resolved QA network attachment changed.');
}
const exchangeProgram="import ctypes,os,sys\na,b=map(os.fsencode,sys.argv[1:]);lib=ctypes.CDLL(None,use_errno=True);f=lib.renameat2;f.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];f.restype=ctypes.c_int\nif f(-100,a,-100,b,2)!=0: raise OSError(ctypes.get_errno(),os.strerror(ctypes.get_errno()))\n";
export function exchangeDirectories(a,b){run('python3',['-c',exchangeProgram,a,b]);}
export async function promoteArtifact({candidate,active,retained,exchange=exchangeDirectories,move=rename}){
 for(const path of [candidate,active]){const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Promotion requires real artifact directories.');}
 if(existsSync(retained))throw new Error('Previous artifact retention path already exists.');
 if((await stat(candidate)).dev!==(await stat(active)).dev)throw new Error('Artifact promotion requires one filesystem.');
 exchange(candidate,active);
 try{await move(candidate,retained);}catch(error){exchange(candidate,active);throw error;}
 return {active,retained};
}
async function atomicJson(path,value){const temporary=`${path}.${randomUUID()}.tmp`;await writeFile(temporary,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});await rename(temporary,path);}
async function verifySnapshot(source,inputs){for(const [path,digest]of Object.entries(inputs.inputFiles)){if(hash(await readFile(resolve(source,path)))!==digest)throw new Error(`Archived build input changed: ${path}`);}}
export function archivedBuildPaths(inputFiles){
 const paths=Object.keys(inputFiles??{});if(!paths.length)throw new Error('No verified build inputs to archive.');
 const roots=[...new Set(paths.map(path=>path.split('/')[0]))].sort();
 const allowed=new Set(['apps','packages','services','scripts','package.json','package-lock.json','.npmrc','.dockerignore','Dockerfile','compose.yaml','.env.example','tsconfig.json']);
 if(roots.some(path=>!allowed.has(path)))throw new Error('Unexpected build archive path.');
 return roots;
}
export function isolatedBuildArguments({source,dist,imageId,uid,gid,webDependencies=resolve(root,'apps/web/node_modules'),base=localRoot}){
 safeStagePath(dirname(resolve(source)),base);if(dirname(resolve(source))!==dirname(resolve(dist))||relative(dirname(source),source)!=='source'||relative(dirname(dist),dist)!=='dist'||!/^sha256:[a-f0-9]{64}$/.test(imageId)||relative(root,resolve(webDependencies)).startsWith('..')||![uid,gid].every(value=>Number.isInteger(value)&&value>=0))throw new Error('Unsafe isolated build plan.');
 return ['run','--rm','--network','none','--read-only','--security-opt','no-new-privileges','--cap-drop','ALL','--tmpfs','/tmp:rw,noexec,nosuid,size=256m','--label','com.docker.compose.project=samvev-m1','--label','com.samvev.component=design-review-builder','--user',`${uid}:${gid}`,'--workdir','/workspace','--mount',`type=bind,source=${source},target=/workspace,readonly`,'--mount','type=volume,source=samvev-m1-workspace-node-modules,target=/workspace/node_modules,readonly','--mount',`type=bind,source=${webDependencies},target=/workspace/apps/web/node_modules,readonly`,'--mount',`type=bind,source=${dist},target=/output`,'--entrypoint','node',imageId,'/workspace/apps/web/node_modules/vite/bin/vite.js','build','/workspace/apps/web','--config','/workspace/apps/web/vite.config.ts','--configLoader','native','--outDir','/output','--emptyOutDir'];
}
export async function buildStagedArtifact(){
 const inputs=await verifyInputs();if(run('git',['-C',clone,'status','--porcelain']).trim())throw new Error('Canonical publishing checkout must be clean.');
 const before=captureRuntimeState();const activeBefore=await distHashes();const raw=inspect(app);const image=JSON.parse(docker(['image','inspect',raw.Image]))[0];
 if(image.Config.Labels?.['com.docker.compose.project']!=='samvev-m1')throw new Error('Build image is outside samvev-m1.');
 const stageDir=resolve(localRoot,'staged',`${inputs.sourceSha}-${randomUUID()}`),source=resolve(stageDir,'source'),dist=resolve(stageDir,'dist');await mkdir(source,{recursive:true,mode:0o700});await mkdir(dist,{mode:0o700});
 run('git',['-C',clone,'archive','--format=tar','--output',resolve(stageDir,'source.tar'),inputs.sourceSha,...archivedBuildPaths(inputs.inputFiles)]);run('tar',['-xf',resolve(stageDir,'source.tar'),'-C',source]);await verifySnapshot(source,inputs);await mkdir(resolve(source,'node_modules'));await mkdir(resolve(source,'apps/web/node_modules'));
 const webDependencies=await realpath(resolve(root,'apps/web/node_modules'));if(relative(root,webDependencies).startsWith('..')||!(await stat(resolve(webDependencies,'vite/bin/vite.js'))).isFile())throw new Error('Verified scoped web dependencies are unavailable.');
 const nodeVersion=docker(['run','--rm','--network','none','--label','com.docker.compose.project=samvev-m1','--entrypoint','node',raw.Image,'--version']).trim();if(!/^v24\./.test(nodeVersion))throw new Error('Builder must use Node 24.');
 const args=isolatedBuildArguments({source,dist,imageId:raw.Image,uid:process.getuid(),gid:process.getgid(),webDependencies});
 run('docker',args,{stdio:['ignore','inherit','inherit']});
 await verifySnapshot(source,inputs);requireSameBytes(await verifyInputs(),inputs,'Canonical source changed during staged build.');requireSameBytes(captureRuntimeState(),before,'QA runtime changed during staged build.');requireSameBytes(await distHashes(),activeBefore,'Active LAN dist changed during staged build.');
 const proof={version:1,stageDir,sourceSha:inputs.sourceSha,inputFingerprint:inputs.inputFingerprint,inputFileHashes:inputs.inputFiles,builderImageId:raw.Image,nodeVersion,dependencies:{rootVolume:'samvev-m1-workspace-node-modules',webDependencies,webVitePackageSha256:hash(await readFile(resolve(webDependencies,'vite/package.json')))},builtAt:new Date().toISOString(),distHashes:await directoryHashes(dist),runtimeBefore:before,activeBefore};await atomicJson(resolve(stageDir,'stage-provenance.json'),proof);await atomicJson(pointer,proof);console.log(`Staged isolated web artifact for ${inputs.sourceSha}; LAN assets unchanged.`);return proof;
}
async function healthy(name){for(let attempt=0;attempt<60;attempt++){try{if(inspect(name).State?.Health?.Status==='healthy')return;}catch{}await new Promise(resolve=>setTimeout(resolve,2000));}throw new Error(`QA service unhealthy: ${name}`);}
export async function activateStagedArtifact(){
 const inputs=await verifyInputs(),proof=await requireStageProof(JSON.parse(await readFile(pointer,'utf8')),inputs);const before=captureRuntimeState();requireSameBytes(before,proof.runtimeBefore,'QA runtime changed since staged build.');requireSameBytes(await distHashes(),proof.activeBefore,'Active LAN dist changed since staged build.');
 const raw=inspect(app),image=JSON.parse(docker(['image','inspect',raw.Image]))[0],plan=composeFiles(raw);
 const baseCompose=['compose','--project-directory',root,'--env-file',resolve(root,'.env.example'),'-p','samvev-m1','--profile','qa',...plan.files.flatMap(file=>['-f',file])];
 const override=resolve(proof.stageDir,'qa-no-build.json');
 const baseConfig=plan.recoverStdin?JSON.parse(docker([...baseCompose,'config','--format','json'])):undefined;
 await atomicJson(override,plan.recoverStdin?recoveredStdinOverride(raw,baseConfig):activationOverride(raw));
 const compose=[...baseCompose,'-f',override];
 const resolved=JSON.parse(docker([...compose,'config','--format','json']));requireComposeApp(resolved,raw,image);
 await atomicJson(resolve(proof.stageDir,'resolved-compose.private.json'),resolved);
 // Check exchange support on private staging directories before quiescing LAN.
 const a=resolve(proof.stageDir,'exchange-a'),b=resolve(proof.stageDir,'exchange-b');await mkdir(a);await mkdir(b);exchangeDirectories(a,b);exchangeDirectories(a,b);
 await atomicJson(resolve(proof.stageDir,'activation-before.json'),{before,raw,override});
 let promoted=false;const active=resolve(root,'apps/web/dist'),candidate=resolve(proof.stageDir,'dist'),retained=resolve(proof.stageDir,'previous-dist');
 try{
  docker(['stop',worker]);docker(['exec',app,'npm','run','db:migrate']);docker(['stop',app]);
  await promoteArtifact({candidate,active,retained});promoted=true;
  requireSameBytes(await verifyInputs(),inputs,'Canonical inputs changed before QA recreation.');
  docker([...compose,'up','-d','--no-deps','--no-build','--pull','never','--force-recreate','qa-app']);await healthy(app);requireAppRecreation(raw,inspect(app));
  docker(['start',worker]);await healthy(worker);
  requireSameBytes(await distHashes(),proof.distHashes,'Activated bundle differs from staged artifact.');
  const served=JSON.parse(docker(['exec',app,'node','-e',`const c=require('node:crypto'),x=${JSON.stringify(proof.distHashes)};(async()=>{for(const[p,h]of Object.entries(x)){const r=await fetch('http://127.0.0.1:4173/'+p);if(r.status!==200||c.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex')!==h)throw Error('served asset mismatch');}console.log(JSON.stringify({assetsExact:true,count:Object.keys(x).length}));})().catch(()=>process.exit(1));`]));
  const activation={sourceSha:inputs.sourceSha,stageManifestSha256:hash(await readFile(resolve(proof.stageDir,'stage-provenance.json'))),previousDist:retained,served};
  await writeRuntimeProof({before,expectedSourceSha:inputs.sourceSha,appRecreated:true,activation});await writeProof({containerId:inspect(app).Id,nodeVersion:proof.nodeVersion,expectedSourceSha:inputs.sourceSha,stageBuild:proof});await atomicJson(resolve(proof.stageDir,'activation-complete.json'),activation);console.log(`Activated verified QA artifact for ${inputs.sourceSha}; app starts without build.`);
 }catch(error){
  // Never restore/reset a database or start the old build-on-start command.
  if(promoted){try{docker(['stop',app]);exchangeDirectories(active,retained);await atomicJson(resolve(proof.stageDir,'activation-failed.json'),{sourceSha:inputs.sourceSha,assetsRestored:true,forwardRuntimeRecoveryRequired:true});}catch{throw new Error('QA activation failed; preserve database and retained artifacts for forward recovery.',{cause:error});}}
  throw new Error('QA activation failed; previous assets retained, runtime proofs are invalid until forward recovery. No database restore was attempted.',{cause:error});
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(root!=='/home/administrator/apper/samvev')throw new Error('Review pipeline is restricted to the canonical repository.');
 if(process.argv[2]==='build')await buildStagedArtifact();else if(process.argv[2]==='activate')await activateStagedArtifact();else throw new Error('Expected build or activate.');
}
