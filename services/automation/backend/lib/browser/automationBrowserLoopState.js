const {isDeepStrictEqual} = require('node:util');
function discoveredMode(schema,args,depth=0){
  if(!schema||typeof schema!=='object'||depth>12)return {};
  const selected={};
  for(const [key,rule]of Object.entries(schema.properties||{}))if(rule&&typeof rule==='object'&&typeof args?.[key]==='string'&&args[key].length<=80&&(Object.hasOwn(rule,'const')&&isDeepStrictEqual(rule.const,args[key])||Array.isArray(rule.enum)&&rule.enum.some(item=>isDeepStrictEqual(item,args[key]))))selected[key]=args[key];
  for(const keyword of ['oneOf','anyOf','allOf'])for(const rule of schema[keyword]||[])Object.assign(selected,discoveredMode(rule,args,depth+1));
  return selected;
}

const ACTIVE = ['observing', 'planning', 'validating', 'acting', 'verifying', 'publishing', 'recovering'];
const TRANSITIONS = {
  created: ['observing'], observing: ['planning', 'acting', 'verifying', 'publishing', 'validating', 'recovering'],
  planning: ['validating', 'observing', 'recovering', 'verifying'],
  validating: ['planning', 'acting', 'observing', 'verifying', 'publishing', 'recovering'],
  acting: ['observing'], verifying: ['validating', 'observing', 'publishing', 'recovering', 'planning'],
  publishing: ['observing', 'planning', 'validating', 'verifying', 'recovering'], recovering: ['planning', 'observing', 'verifying', 'validating']
};
const deadlineFailure = stepId => Object.assign(new Error('The automation section time allowance ended. No further browser action or instruction save was started; previously saved sections remain in Plan.'), {
  code: 'AUTOMATION_BUILD_DEADLINE', statusCode: 422, nonRetryable: true, ...(stepId ? { details: { step_id: stepId } } : {})
});

class BrowserLoopState {
  constructor({ signal, deadlineMs, stepId } = {}) {
    this.signal = signal; this.deadline = Math.min(Number.isFinite(deadlineMs) ? deadlineMs : Infinity, Date.now() + 240000);
    this.stepId = stepId; this.state = 'created'; this.transitions = [];
  }
  assertActive() {
    this.signal?.throwIfAborted();
    if (Date.now() >= this.deadline) throw deadlineFailure(this.stepId);
    if (!ACTIVE.includes(this.state)) throw Object.assign(new Error('The browser loop has finished.'), { code: 'AUTOMATION_BROWSER_LOOP_CLOSED', nonRetryable: true });
  }
  enter(next) {
    if (next === this.state) return;
    if (!(TRANSITIONS[this.state] || []).includes(next)) throw Object.assign(new Error(`Invalid browser loop transition: ${this.state} → ${next}.`), { code: 'AUTOMATION_BROWSER_LOOP_TRANSITION_INVALID', nonRetryable: true });
    this.transitions.push({ from: this.state, to: next }); if (this.transitions.length > 50) this.transitions.shift(); this.state = next;
  }
  async run(execute) {
    this.enter('observing');
    try { this.assertActive(); const result = await execute(); this.assertActive(); this.state = 'completed'; return result; }
    catch (error) { this.state = this.signal?.aborted || error?.name === 'AbortError' || /CANCELLED/.test(error?.code || '') ? 'cancelled' : 'failed'; throw error; }
  }
}
module.exports = { BrowserLoopState, deadlineFailure, discoveredMode, TRANSITIONS };
