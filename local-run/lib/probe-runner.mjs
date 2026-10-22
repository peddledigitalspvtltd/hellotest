// A successful HTTP response alone may belong to another app or to the
// inspection-only service. Only reuse a ready execution-capable runner.
try {
  const base = new URL(process.argv[2]);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.protocol !== 'http:') throw new Error();
  const response = await fetch(new URL('/health', base), { redirect: 'error', signal: AbortSignal.timeout(1500) });
  const health = await response.json();
  process.exitCode = response.ok && health.supported_web_engines?.includes('playwright')
    && health.ready !== false && health.capabilities?.local_execution !== false ? 0 : 1;
} catch { process.exitCode = 1; }
