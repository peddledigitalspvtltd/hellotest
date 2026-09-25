#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const file=resolve(root,'services/capabilities.json');
const current=JSON.parse(readFileSync(file,'utf8'));
const names=readdirSync(resolve(root,'services'),{withFileTypes:true}).filter(item=>item.isDirectory()).map(item=>item.name);
const ordered=[...Object.keys(current.dependencies).filter(name=>names.includes(name)),...names.filter(name=>!Object.hasOwn(current.dependencies,name)).sort()];
const next={version:1,generated_from:'services/*/package.json#hellotest',dependencies:{},feature_owners:{}};
for(const name of ordered) {
 const pkg=JSON.parse(readFileSync(resolve(root,'services',name,'package.json'),'utf8'));
 if(pkg.name!==`@hellotest/${name}`||pkg.hellotest?.id!==name)throw new Error(`Invalid capability package: ${name}`);
 next.dependencies[name]=pkg.hellotest.requires;
 for(const dependency of next.dependencies[name])if(!names.includes(dependency))throw new Error(`Unknown required capability: ${dependency}`);
 for(const feature of pkg.hellotest.features) {
  if(next.feature_owners[feature])throw new Error(`Duplicate feature owner: ${feature}`);
  next.feature_owners[feature]=name;
 }
}
// Keep feature ordering stable for compatibility artifacts and readable changes.
next.feature_owners=Object.fromEntries(Object.keys(next.feature_owners).sort().map(key=>[key,next.feature_owners[key]]));
const output=JSON.stringify(next,null,2)+'\n';
if(process.argv.includes('--check')) {
 if(readFileSync(file,'utf8')!==output)throw new Error('Capability metadata is stale. Run npm run generate:capabilities.');
 console.log('Capability deployment/feature metadata matches package declarations.');
} else {writeFileSync(file,output);console.log('Updated generated capability metadata.');}
