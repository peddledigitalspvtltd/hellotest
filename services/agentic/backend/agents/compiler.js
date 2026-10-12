const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { LIMITS, FINDING_KEYS, error } = require('./catalog');

const compilerRoot = path.resolve(__dirname, '../runtime/semantic_compiler');
const python = process.env.REPOSITORY_AGENT_PYTHON || 'python3';
let runtimeCache, versionPromise;
const compilerVersion = () => versionPromise ||= (async () => {
  const digest = createHash('sha256');
  const visit = async directory => {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '__pycache__' || entry.name.startsWith('.')) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && entry.name.endsWith('.py')) digest.update(path.relative(compilerRoot, file)).update(await fs.readFile(file));
    }
  };
  await visit(compilerRoot);
  return digest.digest('hex');
})();
async function runtimeStatus() {
  if (runtimeCache && Date.now() - runtimeCache.checked < 60_000) return runtimeCache.value;
  let value;
  try {
    await fs.access(path.join(compilerRoot, 'compile.py'));
    await promisify(execFile)(python, ['-c', 'import sys; assert sys.version_info >= (3,9)'], { timeout: 3000, maxBuffer: 1024 });
    value = { available: true, detail: 'Repository analysis is ready. Source code is analyzed without running repository commands.' };
  } catch { value = { available: false, detail: 'The repository analysis runtime is unavailable. Install Python 3.9 or later and deploy the agents package.' }; }
  runtimeCache = { checked: Date.now(), value };
  return value;
}
function validateResult(result, agentType) {
  if (!result || result.schema_version !== 1 || result.agent_type !== agentType || !result.findings || !Array.isArray(result.findings[FINDING_KEYS[agentType]]) || !Array.isArray(result.stages) || !Array.isArray(result.warnings) || !Array.isArray(result.artifacts)) throw error('The compiler returned an incomplete result. Retry analysis after checking the runtime.', 502);
  const ids = new Set();
  for (const item of result.findings[FINDING_KEYS[agentType]]) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || !Array.isArray(item.evidence) || !item.evidence.length || !item.evidence.every(e => typeof e.path === 'string' && Number.isInteger(e.line) && e.line > 0)) throw error('A generated finding did not include unique identity and source evidence.', 502);
    ids.add(item.id);
    item.review_required = true;
  }
  const names = new Set();
  for (const artifact of result.artifacts) {
    if (!artifact || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,159}$/.test(artifact.name) || names.has(artifact.name) || typeof artifact.content !== 'string') throw error('A generated artifact did not pass validation.', 502);
    names.add(artifact.name);
  }
  return result;
}
async function compileArchive({ buffer, archivePath, agentType, signal, onStage }) {
  if (signal?.aborted) throw error('Analysis was cancelled.', 409);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hellotest-agent-'));
  const archive = path.join(directory, 'source.zip'), input = path.join(directory, 'input.json'), output = path.join(directory, 'result.json');
  try {
    if (archivePath) await fs.copyFile(archivePath, archive);
    else await fs.writeFile(archive, buffer, { mode: 0o600 });
    await fs.writeFile(input, JSON.stringify({ agent_type: agentType, archive_path: archive }), { mode: 0o600 });
    await new Promise((resolve, reject) => {
      let pending = '', stderr = '', compilerError = '', bytes = 0, aborted = false, settled = false, escalation;
      const child = spawn(python, [path.join(compilerRoot, 'compile.py'), '--input', input, '--output', output], {
        cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], shell: false,
        env: { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', REPOSITORY_ARCHIVE_QUOTA_BYTES: String(LIMITS.max_archive_bytes), PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1', LANG: 'C.UTF-8' }
      });
      const stop = () => { aborted = true; child.kill('SIGTERM'); escalation = setTimeout(() => child.kill('SIGKILL'), 750); escalation.unref?.(); };
      const timer = setTimeout(stop, LIMITS.worker_timeout_ms);
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) stop();
      const finish = failure => {
        if (settled) return; settled = true;
        clearTimeout(timer); clearTimeout(escalation); signal?.removeEventListener('abort', stop);
        if (failure) reject(failure); else resolve();
      };
      // Only the adapter's structured, constant validation messages are public.
      // Tracebacks, arbitrary stderr and repository output are discarded.
      child.stderr.on('data', chunk => {
        bytes += chunk.length; if (bytes > 128 * 1024) { stop(); return; }
        stderr += chunk.toString('utf8');
        let newline;
        while ((newline = stderr.indexOf('\n')) >= 0) {
          const line = stderr.slice(0, newline); stderr = stderr.slice(newline + 1);
          try { const event = JSON.parse(line); if (event.event === 'error' && typeof event.error === 'string' && event.error.length <= 500) compilerError = event.error; } catch { /* Ignore non-protocol output. */ }
        }
      });
      child.stdout.on('data', chunk => {
        bytes += chunk.length; if (bytes > 128 * 1024) { stop(); return; }
        pending += chunk.toString('utf8');
        let newline;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
          try { const event = JSON.parse(line); if (event.event === 'stage' && event.stage) onStage?.(event.stage); } catch { /* Non-protocol output is discarded. */ }
        }
      });
      child.on('error', () => finish(error('The repository compiler could not start. Check its Python runtime.', 503)));
      child.on('close', code => finish(aborted ? error(signal?.aborted ? 'Analysis was cancelled.' : 'Repository analysis exceeded its time or output limit. Review the analysis scope or increase the configured worker budget.', 409) : code !== 0 ? error(compilerError || 'The repository compiler could not analyze this archive. Check that it contains supported source files and retry.', 422) : null));
    });
    const stat = await fs.stat(output);
    if (stat.size > LIMITS.max_result_bytes) throw error('Generated results exceeded the review limit. Analyze a smaller repository scope.', 413);
    return validateResult(JSON.parse(await fs.readFile(output, 'utf8')), agentType);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
module.exports = { compileArchive, compilerVersion, runtimeStatus, validateResult };
