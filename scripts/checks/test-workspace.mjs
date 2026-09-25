#!/usr/bin/env node
import { readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const layer=process.argv[2];
if(!['frontend','backend'].includes(layer))throw new Error('Expected frontend or backend');
const runtime=layer==='backend'?'services/platform/backend':'services/platform/frontend';
const owners=readdirSync(resolve(root,'services'),{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name);
const directories=[`${runtime}/test`,...owners.map(owner=>`services/${owner}/test/${layer}`)];
const files=directories.flatMap(directory=>existsSync(resolve(root,directory))?readdirSync(resolve(root,directory)).filter(file=>file.endsWith(layer==='backend'?'.test.js':'.test.mjs')).map(file=>resolve(root,directory,file)):[]);
const result=spawnSync(process.execPath,['--test',...files],{cwd:resolve(root,runtime),stdio:'inherit'});
if(result.error)throw result.error;
process.exit(result.status??1);
