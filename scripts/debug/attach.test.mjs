import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { once } from 'node:events';

const root = resolve(import.meta.dirname, '../..');
const waitFor = (child, pattern) => new Promise((resolveWait, reject) => {
  let output = '';
  const timer = setTimeout(() => reject(new Error(`Timed out: ${output}`)), 10000);
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  child.once('exit', code => { clearTimeout(timer); reject(new Error(`Exited ${code}: ${output}`)); });
  function collect(data) {
    output += data;
    const match = output.match(pattern);
    if (match) { clearTimeout(timer); resolveWait(match); }
  }
});

test('existing inspector HTTP and WebSocket traffic crosses the Docker exec tunnel without service startup', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hellotest-debug-'));
  const inspector = spawn(process.execPath, ['--inspect=127.0.0.1:0', '-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let tunnel;
  t.after(async () => {
    if (tunnel && tunnel.exitCode === null) { const ended = once(tunnel, 'exit'); tunnel.kill('SIGTERM'); await ended; }
    inspector.kill();
    await rm(directory, { recursive: true, force: true });
  });
  const match = await waitFor(inspector, /Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)/);
  const remotePort = Number(match[1]);
  const fakeDocker = `#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(directory, 'calls'))}, JSON.stringify(args) + '\\n');
if (args[0] === 'ps') console.log('fixture');
else if (args[0] === 'inspect') console.log(JSON.stringify([{Id:'fixture',Name:'/hellotest-local-api',Config:{Labels:{'com.docker.compose.project.config_files':${JSON.stringify(join(root, 'local-run/docker-compose.yml'))},'com.docker.compose.container-number':'1'}}}]));
else if (args[0] === 'exec') {
  const code = args[args.indexOf('-e') + 1].replaceAll('9229', '${remotePort}');
  const child = spawn(process.execPath, ['-e', code], {stdio:'inherit'});
  child.on('exit', code => process.exit(code || 0));
  process.on('SIGTERM', () => {child.kill(); process.exit(0);});
} else { console.error('Unexpected Docker mutation: ' + args); process.exit(1); }
`;
  await writeFile(join(directory, 'docker'), fakeDocker, { mode: 0o755 });
  tunnel = spawn(process.execPath, [join(root, 'scripts/debug/attach.mjs'), 'chatbot'], { env: { ...process.env, PATH: `${directory}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitFor(tunnel, /DEBUG READY/);
  const response = await fetch('http://127.0.0.1:9240/json/list', { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  const targets = await response.json();
  const url = new URL(targets[0].webSocketDebuggerUrl);
  url.port = '9240';
  // Node 22 supplies WebSocket; Node 20 still checks HTTP forwarding above.
  if (!globalThis.WebSocket) return;
  const socket = new WebSocket(url.href);
  t.after(() => socket.close());
  await new Promise((res, rej) => { socket.addEventListener('open', res, {once:true}); socket.addEventListener('error', rej, {once:true}); });
  const reply = new Promise(res => socket.addEventListener('message', e => res(JSON.parse(e.data)), {once:true}));
  socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'6 * 7',returnByValue:true}}));
  assert.equal((await reply).result.result.value, 42);
});

test('invalid replica fails before contacting Docker', async () => {
  const child = spawn(process.execPath, [join(root, 'scripts/debug/attach.mjs'), 'chatbot', '0']);
  let error = '';
  child.stderr.on('data', data => { error += data; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.match(error, /positive integer/);
});

test('MCP has an explicit target in the combined API and invalid targets fail early', async () => {
  const { resolveDebugTarget } = await import('./targets.mjs');
  assert.deepEqual(resolveDebugTarget('mcp'), { owner:'mcp', service:'api', replica:1, port:9240, entry:'src/server.js' });
  assert.equal(resolveDebugTarget('mobile-engine').port,9244);
  assert.equal(resolveDebugTarget('testengine-quality-worker').port,9245);
  assert.throws(()=>resolveDebugTarget('unknown'),/Unknown debug service/);
});

test('check mode is read-only and an occupied tunnel port never enables a debugger', async t => {
  const { createServer } = await import('node:net');
  const { readFile } = await import('node:fs/promises');
  const directory=await mkdtemp(join(tmpdir(),'hellotest-debug-check-'));
  const calls=join(directory,'calls');
  const blocker=createServer();await new Promise(resolve=>blocker.listen(9240,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>blocker.close(resolve));await rm(directory,{recursive:true,force:true});});
  const fake=`#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
if(args[0]==='ps')console.log('fixture');else if(args[0]==='inspect')console.log(JSON.stringify([{Id:'fixture',Name:'/fixture-api',Config:{Labels:{'com.docker.compose.project.config_files':${JSON.stringify(join(root,'local-run/docker-compose.yml'))},'com.docker.compose.container-number':'1'}}}]));else if(args[0]==='exec'){if(args.some(arg=>arg.includes('process.kill')))process.exit(42);process.exit(0);}else process.exit(43);
`;
  await writeFile(join(directory,'docker'),fake,{mode:0o755});
  const run=async flags=>{const child=spawn(process.execPath,[join(root,'scripts/debug/attach.mjs'),'mcp',...flags],{env:{...process.env,PATH:`${directory}:${process.env.PATH}`}});let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);const[code]=await once(child,'exit');return{code,stdout,stderr};};
  const check=await run(['--check']);assert.equal(check.code,0);assert.match(check.stdout,/"inspector_enabled":true/);
  const conflict=await run([]);assert.equal(conflict.code,1);assert.match(conflict.stderr,/Port 9240 is already in use/);
  const recorded=await readFile(calls,'utf8');assert.doesNotMatch(recorded,/process\.kill/,'No inspector activation on read-only checks or failed admission');
});
