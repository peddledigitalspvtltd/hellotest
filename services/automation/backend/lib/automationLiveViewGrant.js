const { createHmac } = require('node:crypto');

function createLiveViewGrant({ engineRunId, provider, secret, now = Date.now() }) {
  const payload = Buffer.from(JSON.stringify({ v: 1, purpose: 'testengine-live-view', run_id: engineRunId,
    provider: provider === 'selenium' ? 'selenium' : 'playwright', exp: Math.floor(now / 1000) + 300 })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

module.exports = { createLiveViewGrant };
