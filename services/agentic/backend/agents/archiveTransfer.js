const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createHash } = require('node:crypto');
const { LIMITS, error } = require('./catalog');

// Disk-backed, backpressure-aware transfer. Never concatenate the compressed
// archive in Node memory. Temp paths originate here, never in client input.
async function spoolArchive(stream, { signal, filename = 'source.zip' } = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'qaira-source-'));
  const archivePath = path.join(directory, 'source.zip');
  let bytes = 0, signature = Buffer.alloc(0);
  const hash = createHash('sha256');
  const meter = new Transform({ transform(chunk, encoding, done) {
    bytes += chunk.length;
    if (bytes > LIMITS.max_archive_bytes) return done(error('The archive exceeds the configured repository storage quota.', 413));
    if (signature.length < 4) signature = Buffer.concat([signature, chunk.subarray(0, 4 - signature.length)]);
    hash.update(chunk); done(null, chunk);
  } });
  try {
    await pipeline(stream, meter, fs.createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }), ...(signal ? [{ signal }] : []));
    if (signature.length !== 4 || ![0x04034b50,0x06054b50].includes(signature.readUInt32LE(0))) throw error('Upload a valid ZIP source archive.');
    return { archivePath, filename, size: bytes, digest: hash.digest('hex'), dispose: () => fsp.rm(directory, { recursive: true, force: true }) };
  } catch (failure) { await fsp.rm(directory, { recursive: true, force: true }); throw failure; }
}
module.exports = { spoolArchive };
