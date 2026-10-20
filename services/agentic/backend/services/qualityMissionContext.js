const C = require('./qualityAgentContracts');

const MAX_PRIOR_CHARS = 12000;
const MAX_PACKET_CHARS = 64000;

// Keep task data and current actionable subjects intact. Older pages are excerpts,
// explicitly marked as such; the authoritative observations remain in the run.
function missionContext(request, observed, previous = [], history = []) {
  const packet = {
    task_brief:C.taskBrief(request),goal:request.goal,kind:request.kind,
    origin:new URL(request.target_url).origin,
    allow_form_submission:request.options.mission.allow_form_submission,
    remaining_actions:Math.max(0,request.options.mission.max_actions-observed.sequence+1),
    observation:observed,prior_observations:[],
    history:history.slice(-12).map(({sequence,action,status,summary,url})=>({sequence,action,status,summary,url})),
    reviewed_context:request.smart_context?.reviewed_context||null,
    evidence_scope:request.evidence_scope||{},
    context_provenance:{reviewed_context:'user-reviewed task data',page_text:'observed browser evidence',action_receipts:'verified by browser observations'},
    context_manifest:{prior_observations_available:previous.length,prior_observations_included:0,prior_observations_excerpted:0,bounded:true}
  };
  let used = 0;
  for (const item of [...previous].reverse()) {
    const excerpt = {sequence:item.sequence,url:item.url,title:item.title,text:item.text.slice(0,2400),
      ...(item.text.length>2400?{excerpt_truncated:true}:{})};
    const size=JSON.stringify(excerpt).length;
    if(used+size>MAX_PRIOR_CHARS)continue;
    packet.prior_observations.unshift(excerpt);used+=size;
  }
  while(JSON.stringify(packet).length>MAX_PACKET_CHARS&&packet.prior_observations.length)packet.prior_observations.shift();
  if(JSON.stringify(packet).length>MAX_PACKET_CHARS) {
    // Link URLs are advisory; host element IDs, labels and action receipts remain.
    packet.observation={...observed,elements:observed.elements.map(({href,...element})=>({...element,...(href?{href_omitted:true}:{})}))};
    packet.context_manifest.element_hrefs_omitted=true;
    packet.history=packet.history.map(({url,...receipt})=>receipt);
  }
  packet.context_manifest.prior_observations_included=packet.prior_observations.length;
  packet.context_manifest.prior_observations_excerpted=packet.prior_observations.filter(item=>item.excerpt_truncated).length;
  if(JSON.stringify(packet).length>MAX_PACKET_CHARS)throw C.fail('The full task and current browser observation exceed the bounded decision context. Narrow the task or page scope before retrying.',422,'QUALITY_AGENT_CONTEXT_BUDGET');
  return packet;
}
module.exports={missionContext,MAX_PRIOR_CHARS,MAX_PACKET_CHARS};
