#!/usr/bin/env node
// Standard npm exports and dependencies are the source of package contracts.
// No file-by-file exception registry is maintained.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectSourceImports, resolveSourceImport } from '../lib/source-imports.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ts=createRequire(resolve(root, 'services/platform/frontend/package.json'))('typescript');
const packages=Object.fromEntries(readdirSync(resolve(root, 'services'), {withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>[entry.name, JSON.parse(readFileSync(resolve(root, 'services', entry.name, 'package.json'), 'utf8'))]));
const failures=[]; let imports=0;
const ownerOf=file=>relative(root,file).match(/^services\/([^/]+)\/(backend|frontend)\//);
function scan(directory) {
 for(const entry of readdirSync(directory, {withFileTypes:true})) {
  if(['node_modules','dist','dist-admin','instance-setup-data','vendor','test','tests','artifacts'].includes(entry.name))continue;
  const file=resolve(directory,entry.name);
  if(entry.isDirectory()){scan(file);continue;}
  if(!/\.(?:[cm]?js|tsx?)$/.test(file)||file.endsWith('.d.ts'))continue;
  const source=readFileSync(file,'utf8'); const from=ownerOf(file);
  for(const specifier of inspectSourceImports(ts,file,source).imports) {
   const target=resolveSourceImport(root,file,specifier);
   if(target===undefined){failures.push(`${relative(root,file)}: unresolved ${specifier}`);continue;}
   if(!target)continue;
   const to=ownerOf(target);
   if(from&&to&&from[1]!==to[1]) {
    imports++;
    if(!specifier.startsWith(`@hellotest/${to[1]}/`))failures.push(`${relative(root,file)}: use the declared npm export for ${specifier}`);
    if(!packages[from[1]].dependencies?.[`@hellotest/${to[1]}`])failures.push(`${from[1]} has no declared dependency on ${to[1]}`);
    if(from[2]==='backend'&&to[2]==='frontend')failures.push(`${relative(root,file)} imports a browser module`);
   }
  }
 }
}
for(const dir of ['services'])scan(resolve(root,dir));
console.log(JSON.stringify({ok:failures.length===0, packages:Object.keys(packages).length, declared_cross_package_imports:imports, failures},null,2));
if(failures.length)process.exitCode=1;
