const crypto = require('node:crypto');
const fail = (message, statusCode=422) => Object.assign(new Error(message), { statusCode, publicMessage:message });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const EVENTS = Object.freeze(['story.created','story.updated','test_case.created','test_case.updated','bug.created','bug.updated','run.created','run.updated','release.created','release.updated']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function config(workflow) {
  const kind = workflow.trigger_kind || 'manual', value = workflow.settings?.trigger || {};
  if (!['manual','schedule','webhook','release','event'].includes(kind)) throw fail('Choose a supported workflow trigger.');
  if (!object(value)) throw fail('Workflow trigger settings must be an object.');
  if (value.secret || value.token || value.signing_secret) throw fail('Use Rotate signing secret; never save webhook credentials in workflow settings.');
  const input = value.input_payload || {};
  if (!object(input) || Buffer.byteLength(JSON.stringify(input)) > 14*1024) throw fail('Trigger input must be a JSON object no larger than 14 KB.');
  if (kind === 'schedule') {
    const minutes = Number(value.interval_minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) throw fail('Set the schedule interval between 1 and 10,080 minutes.');
    if (value.starts_at && !Number.isFinite(Date.parse(value.starts_at))) throw fail('Choose a valid UTC schedule start.');
  }
  if (kind === 'event' && !EVENTS.includes(value.event_name)) throw fail('Choose a supported project event.');
  if (kind === 'release' && value.state && !['planned','in_progress','released'].includes(value.state)) throw fail('Choose a supported release state.');
  if (value.release_id !== undefined && (typeof value.release_id !== 'string' || value.release_id.length>255)) throw fail('Choose a valid release ID.');
  return { ...value, input_payload:input };
}
function scheduleSlot(workflow, now=Date.now()) {
  const value=config(workflow), period=Number(value.interval_minutes)*60000;
  const anchor=Date.parse(value.starts_at || workflow.updated_at || workflow.created_at);
  if (!Number.isFinite(anchor) || now < anchor) return null;
  // Missed intervals coalesce to the latest due slot, avoiding restart storms.
  return new Date(anchor + Math.floor((now-anchor)/period)*period).toISOString();
}
function signature(secret,timestamp,eventId,body) { return crypto.createHmac('sha256',secret).update(`${timestamp}\n${eventId}\n${JSON.stringify(canonical(body))}`).digest('hex'); }
function verifySignature(secret,headers,body,now=Date.now()) {
  const timestamp=String(headers['x-hellotest-timestamp']||''), eventId=String(headers['x-hellotest-event-id']||''), supplied=String(headers['x-hellotest-signature']||'').replace(/^sha256=/,'');
  if (!/^\d{10}$/.test(timestamp)||Math.abs(now-Number(timestamp)*1000)>300000||! /^[A-Za-z0-9_-]{8,128}$/.test(eventId)||! /^[a-f0-9]{64}$/.test(supplied)) throw fail('Invalid or expired workflow signature.',401);
  if (!crypto.timingSafeEqual(Buffer.from(signature(secret,timestamp,eventId,body),'hex'),Buffer.from(supplied,'hex'))) throw fail('Invalid or expired workflow signature.',401);
  return eventId;
}
const definitionHash = workflow => digest({id:workflow.id,actor_id:workflow.updated_by||workflow.created_by,status:workflow.status,project_id:workflow.project_id,app_type_id:workflow.app_type_id,trigger_kind:workflow.trigger_kind,nodes:workflow.nodes,edges:workflow.edges,settings:workflow.settings});
module.exports={ config,EVENTS,digest,canonical,definitionHash,scheduleSlot,signature,verifySignature,fail };
