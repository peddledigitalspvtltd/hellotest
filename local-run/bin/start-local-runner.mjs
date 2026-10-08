import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const [command,...args]=process.argv.slice(2);
if(!command)throw Error('Supply the local runner executable.');
const environment={...process.env,TESTENGINE_QUEUE_REQUIRED:'false',HELLOTEST_API_BASE_URL:'',TESTENGINE_WORKER_CLASS:'',TESTENGINE_ENGINE_CLASS:''};
try {
 const contents=readFileSync(fileURLToPath(new URL('../../.hellotest/local.env',import.meta.url)),'utf8');
 for(const line of contents.split(/\r?\n/)) {
  const match=line.match(/^(HELLOTEST_TESTENGINE_SECRET|TESTENGINE_SHARED_SECRET|TESTENGINE_CALLBACK_SECRET)=(.*)$/);
  if(!match||environment[match[1]])continue;
  let value=match[2].trim();
  if(value.startsWith('"')&&value.endsWith('"'))value=JSON.parse(value);
  else if(value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1);
  environment[match[1]]=value;
 }
}catch(error){if(error.code!=='ENOENT')throw Error('The local runner credential configuration could not be read.');}
const child=spawn(command,args,{env:environment,stdio:'inherit'});
child.on('error',()=>{console.error('The local Playwright runner could not start.');process.exitCode=1;});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('exit',(code)=>{process.exitCode=code??1;});
