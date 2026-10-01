// Preserve existing npm/Node entrypoints while sharing the Docker-only launcher.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync('sh', [fileURLToPath(new URL('./stack.sh', import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) console.error(`Monitoring launcher could not start: ${result.error.message}`);
process.exit(result.status ?? 1);
