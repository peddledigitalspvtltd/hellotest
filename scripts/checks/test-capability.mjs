#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const owner=process.argv[2];
const manifest=JSON.parse(readFileSync(resolve(root,'services',owner,'package.json'),'utf8'));
if(manifest.hellotest?.id!==owner)throw new Error('Invalid capability');
let ran=0;
for(const [directory,extension] of [['services/platform/backend','test.js'],['services/platform/frontend','test.mjs']]) {
 const tests=readdirSync(resolve(root,directory,'test')).filter(name=>name.endsWith(extension)).filter(name=>{
  const source=readFileSync(resolve(root,directory,'test',name),'utf8');
  return source.includes(`services/${owner}/`)||source.includes(`@hellotest/${owner}/`);
 });
 const own = resolve(root, 'services', owner, 'test', directory.endsWith('/frontend') ? 'frontend' : 'backend');
 const ownTests = existsSync(own) ? readdirSync(own).filter(name => name.endsWith(extension)).map(name => resolve(own, name)) : [];
 ran+=tests.length+ownTests.length;
 if(!tests.length && !ownTests.length) continue;
 const result=spawnSync(process.execPath,['--test',...tests.map(name=>`test/${name}`), ...ownTests],{cwd:resolve(root,directory),stdio:'inherit'});
 if(result.status!==0)process.exit(result.status||1);
}
if(!ran)throw new Error(`No capability contract tests found for ${owner}`);
