#!/usr/bin/env node
// Attach to an existing local-stack process. No compose up/restart or host API.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

import { debugRoot as root, debugOwners, resolveDebugTarget } from './targets.mjs';
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const positionals = args.filter(arg => arg !== '--check');
let target;
try {
  if (positionals.length > 2) throw new Error(`Usage: node scripts/debug/attach.mjs <${debugOwners.join('|')}> [replica-number] [--check]`);
  target = resolveDebugTarget(positionals[0], positionals[1] || 1);
} catch (error) { console.error(error.message); process.exit(1); }
const { owner, service, replica, port } = target;
let debugServer;
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 10_000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.trim() || 'Docker command failed.');
  return result.stdout.trim();
}

// Node enables its loopback inspector on SIGUSR1, including an already running
// server. Find the application process rather than assuming npm's PID is Node.
const enableInspector = String.raw`
const fs = require('node:fs');
const expected = process.argv[1];
const matches = fs.readdirSync('/proc').filter(p => /^\d+$/.test(p)).filter(p => {
  try {
    const args = fs.readFileSync('/proc/' + p + '/cmdline', 'utf8').split('\0');
    return Number(p) !== process.pid && /(^|\/)node$/.test(args[0]) && args.includes(expected);
  } catch { return false; }
});
if (matches.length !== 1) throw new Error('Expected exactly one application Node process; found ' + matches.length);
process.kill(Number(matches[0]), 'SIGUSR1');
`;
const probeInspector = String.raw`
fetch('http://127.0.0.1:9229/json/list', { signal: AbortSignal.timeout(1500) })
  .then(r => r.json()).then(targets => {
    if (!targets.some(t => t.webSocketDebuggerUrl)) throw new Error('Inspector target missing');
  }).catch(e => { console.error(e.message); process.exitCode = 1; });
`;
const bridge = String.raw`
const socket = require('node:net').connect(9229, '127.0.0.1');
socket.on('connect', () => { process.stdin.pipe(socket); socket.pipe(process.stdout); });
socket.on('error', e => { console.error(e.message); process.exitCode = 1; process.stdin.destroy(); });
socket.on('close', () => { process.stdin.destroy(); });
process.stdin.on('error', () => socket.destroy());
`;

try {
  if (!checkOnly) console.log(`DEBUG STARTING ${owner}`);
  const ids = docker(['ps', '--filter', `label=com.docker.compose.service=${service}`, '--format', '{{.ID}}']).split('\n').filter(Boolean);
  if (!ids.length) throw new Error(`No running ${service} container. Start your normal ./hellotest.sh up --stack local command first.`);
  const containers = JSON.parse(docker(['inspect', ...ids])).filter(c => {
    const files = c.Config.Labels?.['com.docker.compose.project.config_files'] || '';
    return files.split(',').includes(resolve(root, 'local-run/docker-compose.yml'));
  }).sort((a, b) => Number(a.Config.Labels['com.docker.compose.container-number'] || 1) - Number(b.Config.Labels['com.docker.compose.container-number'] || 1));
  const container = containers.find(c => Number(c.Config.Labels['com.docker.compose.container-number'] || 1) === replica);
  if (!container) throw new Error(`Local ${service} replica ${replica} is not running.`);
  const id = container.Id;
  if (checkOnly) {
    const inspector = spawnSync('docker', ['exec', id, 'node', '-e', probeInspector], { encoding: 'utf8', timeout: 5000 });
    console.log(JSON.stringify({ owner, service, replica, container: container.Name.slice(1), inspector_enabled: !inspector.error && inspector.status === 0, host_inspector_port: port, entry: target.entry, status: 'running' }));
    process.exit(0);
  }
  const children = new Set();
  const sockets = new Set();
  // Docker exec transports inspector HTTP/WebSocket bytes. No published debug
  // port, additional container, application restart, or Docker-specific IP.
  const server = debugServer = createServer(socket => {
    sockets.add(socket);
    const child = spawn('docker', ['exec', '-i', id, 'node', '-e', bridge], { stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(child);
    socket.pipe(child.stdin);
    child.stdout.pipe(socket);
    child.stderr.on('data', data => process.stderr.write(data));
    child.stdin.on('error', () => socket.destroy());
    child.stdout.on('error', () => socket.destroy());
    child.on('error', error => { console.error(error.message); socket.destroy(); });
    child.on('exit', () => { children.delete(child); socket.destroy(); });
    socket.on('error', () => child.kill());
    socket.on('close', () => { sockets.delete(socket); child.kill(); });
  });
  // Reserve the host port before enabling the application inspector.
  await new Promise((ready, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', ready);
  }).catch(error => { throw new Error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the previous debug tunnel task before attaching again.` : error.message); });
  server.on('error', error => { console.error(error.message); server.close(); process.exitCode = 1; });
  // Do not repeatedly signal a process which already has an active inspector.
  const check = spawnSync('docker', ['exec', id, 'node', '-e', probeInspector], { encoding: 'utf8', timeout: 5000 });
  if (check.error || check.status !== 0) {
    docker(['exec', id, 'node', '-e', enableInspector, target.entry]);
    let ready = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise(r => setTimeout(r, 200));
      const result = spawnSync('docker', ['exec', id, 'node', '-e', probeInspector], { encoding: 'utf8', timeout: 5000 });
      if (!result.error && result.status === 0) { ready = true; break; }
    }
    if (!ready) throw new Error('Node inspector did not become ready on container port 9229. Check docker logs.');
  }
  console.log(`DEBUG READY ${owner}: 127.0.0.1:${port} -> ${container.Name.slice(1)}:9229 (existing process)`);
  const stop = () => {
    for (const socket of sockets) socket.destroy();
    for (const child of children) child.kill();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (error) {
  debugServer?.close();
  console.error(error.message);
  process.exitCode = 1;
}
