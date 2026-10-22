import {spawn} from 'node:child_process';
import {createLocalRunnerEnvironment} from '../lib/runner-environment.mjs';
const [command,...args]=process.argv.slice(2);
if(!command)throw Error('Supply the local runner executable.');
const environment=createLocalRunnerEnvironment();
const child=spawn(command,args,{env:environment,stdio:'inherit'});
child.on('error',()=>{console.error('The local Playwright runner could not start.');process.exitCode=1;});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('exit',(code)=>{process.exitCode=code??1;});
