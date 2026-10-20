// Activity contains only correlation metadata. Payloads retain the central
// trace store's independent access policy and are never copied into events.
function modelTraceEvent(record,{name='AI agent',caseId}={}){
 const preflight=record.stage!=='provider_dispatch';
 const message=record.status==='running'?`${name} · ${preflight?'validating model request':'model request started'}.`:record.status==='succeeded'?`${name} · model response received.`:`${name} · ${preflight?'request was not dispatched':'model request '+record.status}${record.error_code?' ('+record.error_code+')':''}.`;
 return {phase:'model.call',level:['failed','cancelled','invalid'].includes(record.status)?'warning':'info',message,details:{name,...record,...(caseId?{test_case_id:caseId}:{})}};
}
module.exports={modelTraceEvent};
