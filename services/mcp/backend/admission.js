'use strict';

// Admission control for the MCP endpoint.
//
// The endpoint used to count requests in flight for the whole process and nothing
// else, so one external host could occupy every slot and, in remote mode, starve
// the Chatbot, which calls the same endpoint for each turn. Admission now has
// three independent limits, checked in this order:
//
//   capacity   total requests in flight (all callers).
//   reserve    a share of that capacity only internal callers may use, so an
//              external burst can never leave a chat turn without a slot.
//   project    the share of the external capacity a single project may hold, so
//              one project cannot crowd out the others.
//   rate       a token bucket per credential: a steady rate with a burst, so one
//              credential cannot hammer the endpoint even when slots are free.
//
// A rejected request changes nothing: it takes no slot and spends no token.
// State is per process, like the counter it replaces. Running several API
// processes multiplies the limits by their number; sharing them across processes
// needs a shared store and is a separate decision.

const SECOND = 1000;
const IDLE_BUCKET_MS = 10 * 60 * SECOND;

// A blank or non-numeric setting is "not set", never zero.
const numeric = value => {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};
const clampInt = (value, min, max, fallback) => {
  const number = numeric(value);
  return number === undefined ? fallback : Math.min(max, Math.max(min, Math.floor(number)));
};
const clampNumber = (value, min, max, fallback) => {
  const number = numeric(value);
  return number === undefined ? fallback : Math.min(max, Math.max(min, number));
};

/** Limits from the environment. Invalid values fall back to the defaults rather than disabling a limit. */
const limitsFromEnv = (env = process.env) => {
  // Zero concurrency is meaningless, so (as before) 0 means the default.
  const capacity = clampInt(numeric(env.HELLOTEST_MCP_MAX_CONCURRENT) || undefined, 1, 64, 16);
  return {
    capacity,
    internalReserve: clampInt(env.HELLOTEST_MCP_INTERNAL_RESERVE, 0, capacity - 1, Math.floor(capacity / 4)),
    projectShare: clampNumber(env.HELLOTEST_MCP_PROJECT_SHARE, 0.1, 1, 0.5),
    ratePerSecond: clampNumber(env.HELLOTEST_MCP_RATE_PER_SECOND, 0.1, 1000, 10),
    burst: clampInt(env.HELLOTEST_MCP_RATE_BURST, 1, 10_000, 30),
    clientRatePerSecond: clampNumber(env.HELLOTEST_MCP_CLIENT_RATE_PER_SECOND,0.1,1000,10),
    clientBurst: clampInt(env.HELLOTEST_MCP_CLIENT_RATE_BURST,1,10_000,30)
  };
};

const REJECTIONS = Object.freeze({
  capacity: { code: 'MCP_CAPACITY', message: 'MCP capacity reached.' },
  reserved: { code: 'MCP_CAPACITY', message: 'MCP capacity reached.' },
  project: { code: 'MCP_PROJECT_BUSY', message: 'This project has too many MCP requests in flight. Retry shortly.' },
  rate: { code: 'MCP_RATE_LIMITED', message: 'This credential is sending requests too quickly. Retry after the indicated delay.' },
  client_rate: { code: 'MCP_CLIENT_RATE_LIMITED', message: 'This MCP client is sending requests too quickly. Retry after the indicated delay.' }
});

const createAdmission = ({ capacity = 16, internalReserve, projectShare = 0.5, ratePerSecond = 10, burst = 30,
  clientRatePerSecond = ratePerSecond, clientBurst = burst, clock = Date.now, maxBuckets = 4096 } = {}) => {
  const limit = clampInt(capacity, 1, 1024, 16);
  const reserve = clampInt(internalReserve ?? Math.floor(limit / 4), 0, limit - 1, 0);
  const externalLimit = limit - reserve;
  const projectLimit = Math.max(1, Math.ceil(externalLimit * clampNumber(projectShare, 0.01, 1, 0.5)));
  const rate = clampNumber(ratePerSecond, 0.001, 100_000, 10);
  const capacityOfBucket = clampInt(burst, 1, 100_000, 30);
  const clientRate = clampNumber(clientRatePerSecond,0.001,100_000,rate),clientCapacity=clampInt(clientBurst,1,100_000,capacityOfBucket);
  const buckets = new Map();
  const clientBuckets = new Map();
  const projects = new Map();
  let inFlight = 0;
  let externalInFlight = 0;

  const refill = (bucket,ratePerToken,capacityTokens) => {
    const at = clock();
    bucket.tokens = Math.min(capacityTokens, bucket.tokens + Math.max(0, at - bucket.at) / SECOND * ratePerToken);
    bucket.at = at;
    return bucket;
  };
  // Seconds until one token is available; 0 means a token was available and was spent.
  const take = (map,id,ratePerToken,capacityTokens) => {
    let bucket = map.get(id);
    if (bucket) { map.delete(id); refill(bucket,ratePerToken,capacityTokens); } else bucket = { tokens: capacityTokens, at: clock() };
    map.set(id, bucket); // insertion order is recency order
    if (bucket.tokens >= 1) { bucket.tokens -= 1; return 0; }
    return Math.max(1, Math.ceil((1 - bucket.tokens) / ratePerToken));
  };
  const peek = (map,id,ratePerToken,capacityTokens) => {
    const bucket = map.get(id);
    if (!bucket) return 0;
    const tokens = Math.min(capacityTokens, bucket.tokens + Math.max(0, clock() - bucket.at) / SECOND * ratePerToken);
    return tokens >= 1 ? 0 : Math.max(1, Math.ceil((1 - tokens) / ratePerToken));
  };
  const prune = () => {
    if (buckets.size <= maxBuckets && clientBuckets.size <= maxBuckets) return;
    const cutoff = clock() - IDLE_BUCKET_MS;
    for (const [map,limit] of [[buckets,maxBuckets],[clientBuckets,maxBuckets]])for (const [id,bucket] of map) {
      if (map.size <= limit && bucket.at >= cutoff) break;
      map.delete(id);
    }
  };

  const reject = (reason, retryAfter = 1) => ({ ok: false, status: 429, reason, retryAfter, ...REJECTIONS[reason] });

  /**
   * @param {{credentialId: string, projectId: string, internal?: boolean}} caller a verified credential
   * @returns {{ok: true, release: () => void} | {ok: false, status: 429, reason: string, retryAfter: number, code: string, message: string}}
   */
  const admit = ({ credentialId, clientId = credentialId, projectId, internal = false }) => {
    if (inFlight >= limit) return reject('capacity');
    if (!internal) {
      if (externalInFlight >= externalLimit) return reject('reserved');
      if ((projects.get(projectId) || 0) >= projectLimit) return reject('project');
      // The bucket is read without spending first so a request refused for another
      // reason costs nothing, then spent once the request is certain to proceed.
      const wait = peek(buckets,credentialId,rate,capacityOfBucket);
      if (wait > 0) return reject('rate', wait);
      const clientWait=peek(clientBuckets,clientId,clientRate,clientCapacity);
      if(clientWait>0)return reject('client_rate',clientWait);
      take(buckets,credentialId,rate,capacityOfBucket);take(clientBuckets,clientId,clientRate,clientCapacity);
      prune();
    }
    inFlight += 1;
    if (!internal) { externalInFlight += 1; projects.set(projectId, (projects.get(projectId) || 0) + 1); }
    let released = false;
    return {
      ok: true,
      release() {
        if (released) return;
        released = true;
        inFlight -= 1;
        if (internal) return;
        externalInFlight -= 1;
        const remaining = (projects.get(projectId) || 1) - 1;
        if (remaining > 0) projects.set(projectId, remaining); else projects.delete(projectId);
      }
    };
  };

  const snapshot = () => ({ in_flight: inFlight, capacity: limit, internal_reserve: reserve, external_limit: externalLimit, project_limit: projectLimit, tracked_credentials: buckets.size,tracked_clients:clientBuckets.size });
  return { admit, snapshot };
};

module.exports = { REJECTIONS, createAdmission, limitsFromEnv };
