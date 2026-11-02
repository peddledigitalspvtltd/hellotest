const {sanitizeAiText}=require('@hellotest/platform/backend/src/security/aiTextPolicy');
const FIELDS=new Set(['id','title','name','description','evidence','method','path','expected_status','steps','assumptions','review_reasons',
  'case_kind','parameters','body','body_schema','content_type','body_media_type_established','declared_statuses','declared_responses','contract_id','origin',
  'screen_name','record_type','page_url','page_key','locator_intent','locator','locator_kind','confidence','source','object_name','object_role',
  'review_required','content','source_uri','component_id','assertions']);
const METADATA=new Set(['kind','source_files','content_hash','repository_file','repository_line','record_kind','screen_name','validation_status',
  'fallback_locators','stability_score','url_pattern_type','url_pattern_value','required','input_type','start_line','end_line','truncated','symbols','language']);
const SECRET_KEY=/^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|private[_-]?key|client[_-]?secret)$/i;
function redactSourceText(value) {
  return sanitizeAiText(value
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,'[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[REDACTED]@')
    .replace(/([?&](?:access_token|refresh_token|api_key|token|secret|password)=)[^\s&#"']+/gi,'$1[REDACTED]')
    .replace(/((?:["']?)(?:api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|client[_-]?secret|password|passwd|secret|token|authorization|proxy-authorization|cookie|set-cookie)(?:["']?)\s*[:=]\s*)(["'])([^\r\n]*?)\2/gi,
      (_match,prefix,quote)=>`${prefix}${quote}[REDACTED]${quote}`)).text;
}
function projectFinding(finding) {
  let redacted=false;
  const safe=(value,key='',depth=0,sensitive=false)=>{
    if(depth>25)throw new Error('A repository finding exceeds the source review structure limit.');
    if(typeof value==='string'){
      const next=SECRET_KEY.test(key)||sensitive&&['enum','default','example','value'].includes(key)?'[REDACTED]':redactSourceText(value);redacted ||=next!==value;return next;
    }
    if(Array.isArray(value))return value.map(item=>safe(item,key,depth+1,sensitive||SECRET_KEY.test(key)));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,safe(item,name,depth+1,sensitive||SECRET_KEY.test(key))]));
    return value;
  };
  const projected=Object.fromEntries(Object.entries(finding).filter(([key])=>FIELDS.has(key)));
  if(finding.metadata&&typeof finding.metadata==='object'&&!Array.isArray(finding.metadata))projected.metadata=Object.fromEntries(Object.entries(finding.metadata).filter(([key])=>METADATA.has(key)));
  const result=safe(projected);if(redacted)result.review_redacted=true;return result;
}
// Domain evidence is the review input: dropping content, locators, parameters or
// response schemas leaves the model unable to assess the extracted draft.
function reviewBatches(findings, maxBytes = 12000) {
  const batches = []; let batch = [], bytes = 2;
  for (const finding of findings) {
    const item = projectFinding(finding);
    item.title ||= finding.name;
    let size = Buffer.byteLength(JSON.stringify(item));
    if (size > maxBytes - 2) {
      item.title = String(item.title || '').slice(0,255);
      item.description = String(item.description || '').slice(0,2000);
      if(typeof item.content==='string'&&item.content.length>4000){item.content=item.content.slice(0,4000);item.content_excerpt=true;}
      item.steps = (item.steps || []).slice(0,8).map(step => ({ action: String(step.action || '').slice(0,200), expected_result: String(step.expected_result || '').slice(0,200) }));
      item.evidence = (item.evidence || []).slice(0,6).map(e => ({ path: e.path, line: e.line }));
      item.assumptions = (item.assumptions || []).slice(0,5).map(s => String(s).slice(0,200));
      item.review_reasons = (item.review_reasons || []).slice(0,5).map(s => String(s).slice(0,200));
      item.review_excerpt = true;
      size = Buffer.byteLength(JSON.stringify(item));
    }
    if (size > maxBytes - 2) throw new Error('A repository finding cannot fit its source review budget.');
    if (bytes + size + 1 > maxBytes && batch.length) { batches.push(batch); batch = []; bytes = 2; }
    batch.push(item); bytes += size + 1;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
module.exports = { reviewBatches, projectFinding };
