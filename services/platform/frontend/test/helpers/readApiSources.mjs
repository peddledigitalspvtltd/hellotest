import { readFile } from 'node:fs/promises';
const profiles = ['platform', 'testing', 'manual', 'dashboard', 'automation', 'agentic', 'ai', 'knowledge', 'chatbot', 'integration', 'trace'];
// Source contracts follow the public facade into the capability-owned clients.
export const readApiSources = () => Promise.all([
  readFile(new URL('../../src/lib/httpClient.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../src/lib/aiHttpClient.ts', import.meta.url), 'utf8'),
  ...profiles.map(profile => readFile(new URL(`../../../../${profile}/frontend/api.client.ts`, import.meta.url), 'utf8'))
]).then(parts => parts.join('\n'));
