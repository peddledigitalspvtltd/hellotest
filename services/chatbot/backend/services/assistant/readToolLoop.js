'use strict';

// Model-directed reads are available only for analytical project questions.
// Calls use MCP's published Zod contracts, run under the signed-in user's scope,
// and share a strict per-turn call/deadline budget. This loop cannot prepare or
// execute writes, choose a project, or use a prior decision as authority.
const ALLOWED_TOOLS = Object.freeze([
  'hellotest_graph_resolve', 'hellotest_graph_context', 'hellotest_graph_trace',
  'hellotest_database_query', 'hellotest_context_graph_list', 'hellotest_context_graph_explore'
]);
const ALLOWED_SET = new Set(ALLOWED_TOOLS);
const ANALYTICAL_INTENTS = new Set(['analytical', 'traceability', 'comparison', 'aggregate', 'investigation']);
const INTENT_CLASSES = new Set([...ANALYTICAL_INTENTS,'lookup','product_help','workflow']);
const array = value => Array.isArray(value) ? value : [];
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

function normalizeCalls(values, catalog = require('@hellotest/mcp/backend/server').tools) {
  const calls = [], seen = new Set();
  let rejected = 0;
  for (const candidate of array(values).slice(0, 6)) {
    const name = typeof candidate?.name === 'string' ? candidate.name : '';
    const tool = ALLOWED_SET.has(name) ? catalog[name] : null;
    if (!tool || tool.write === true || !tool.schema || !object(candidate.arguments)) { rejected += 1; continue; }
    const parsed = tool.schema.safeParse(candidate.arguments);
    if (!parsed.success) { rejected += 1; continue; }
    const key = `${name}:${JSON.stringify(parsed.data)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({ name, arguments: parsed.data });
    if (calls.length >= 3) break;
  }
  return { calls, rejected };
}

function classifyIntent(candidate,question) {
  const explicit=String(candidate?.intent_class||'').toLowerCase();
  if(INTENT_CLASSES.has(explicit))return explicit;
  const text=String(question||'');
  if(/\b(?:compare|comparison|difference|versus|vs\.?|trend|across)\b/i.test(text))return 'comparison';
  if(/\b(?:how many|number of|count of|total count|total number)\b/i.test(text))return 'aggregate';
  if(/\b(?:trace|traceability|related to|relationship|connected to|linked to|depends on|impact|impacted|which tests? cover|what tests? verify|coverage path)\b/i.test(text))return 'traceability';
  if(/\b(?:why did|why does|root cause|investigat(?:e|ion)|failure chain|what caused|what changed)\b/i.test(text))return 'investigation';
  return 'lookup';
}

function summarizeToolResult(name, value) {
  const data = object(value);
  if (name === 'hellotest_graph_resolve') return { project_id:data.project_id,nodes:array(data.nodes).slice(0,12).map(node=>({id:node.id,kind:node.kind,ref_id:node.ref_id,title:node.title})),ambiguous:data.ambiguous||[],gap:data.gap||null };
  if (name === 'hellotest_graph_context' || name === 'hellotest_graph_trace') return {
    nodes:array(data.nodes).slice(0,20).map(node=>({id:node.id,kind:node.kind,ref_id:node.ref_id,title:node.title})),
    edges:array(data.edges).slice(0,24).map(edge=>({id:edge.id,source:edge.source,target:edge.target,type:edge.type,provenance_type:edge.provenance_type})),
    evidence:array(data.evidence).slice(0,12).map(hit=>({evidence_id:hit.citation?.id||hit.evidence_id,source_id:hit.source_id,title:hit.title,content:String(hit.content||'').slice(0,700)})),
    limitations:data.limitations||data.gaps||null
  };
  if (name === 'hellotest_database_query') return {entity:data.entity,rows:array(data.rows||data.items).slice(0,12),count:data.count??data.total??array(data.rows||data.items).length,observed_at:data.observed_at||null};
  if (name === 'hellotest_context_graph_list') return {items:array(data.items).slice(0,12).map(item=>({trace_id:item.trace_id,feature_id:item.feature_id,recorded_at:item.recorded_at,evidence_count:item.evidence_count,status:item.status})),next_cursor:data.next_cursor||null};
  if (name === 'hellotest_context_graph_explore') return {
    trace:data.trace||null,nodes:array(data.nodes).slice(0,20).map(node=>({id:node.id,kind:node.kind,title:node.title,source_id:node.source_id,metadata:node.metadata})),
    edges:array(data.edges).slice(0,24).map(edge=>({id:edge.id,source:edge.source,target:edge.target,type:edge.type,evidence_ids:array(edge.evidence_ids).slice(0,12)})),
    timeline:array(data.timeline).slice(0,20).map(event=>({event_type:event.event_type,status:event.status,occurred_at:event.occurred_at}))
  };
  return {};
}

function evidenceFromResults(results) {
  const evidence = new Map(), relationships = new Map();
  for (const entry of results) {
    const data = object(entry.result);
    for (const hit of array(data.evidence)) {
      const citation = object(hit?.citation);
      const id = citation.id || hit?.evidence_id;
      if (typeof id !== 'string' || typeof hit?.content !== 'string' || typeof hit?.source_id !== 'string') continue;
      evidence.set(id, { ...hit, evidence_id:id, citation:{...citation,id} });
    }
    for (const edge of array(data.edges)) if (typeof edge?.id === 'string') relationships.set(edge.id,edge);
  }
  const evidenceIds = new Set(evidence.keys());
  return { evidence:[...evidence.values()],relationships:[...relationships.values()].filter(edge=>
    array(edge.evidence_ids).length && array(edge.evidence_ids).every(id=>evidenceIds.has(id))) };
}

function sourceIdsFromResults(results) {
  const ids = new Set();
  for (const entry of results) {
    const data = object(entry.result);
    for (const hit of array(data.evidence)) if (typeof hit?.source_id === 'string') ids.add(hit.source_id);
    for (const node of array(data.nodes)) {
      if (typeof node?.source_id === 'string') ids.add(node.source_id);
      else if (typeof node?.id === 'string' && node.id.length <= 255) ids.add(node.id);
    }
  }
  return [...ids].slice(0,20);
}

async function run({ intentClass, proposedCalls, maxCalls = 0, deadlineAt, signal, dispatch, continuePlan } = {}) {
  if (!ANALYTICAL_INTENTS.has(intentClass)) return { status:'skipped',reason:'non_analytical_intent',calls:[],results:[],tool_calls_used:0,planner_calls:0,rejected_calls:0 };
  const boundedCalls = Math.max(0,Math.min(6,Number(maxCalls)||0));
  if (!boundedCalls) return { status:'skipped',reason:'tool_budget',calls:[],results:[],tool_calls_used:0,planner_calls:0,rejected_calls:0 };
  let next = normalizeCalls(proposedCalls), rejected = next.rejected, toolCalls = 0, plannerCalls = 0;
  const results = [], calls = [];
  for (let round=0; round<2 && next.calls.length && toolCalls+plannerCalls<boundedCalls; round++) {
    signal?.throwIfAborted?.();
    const available = Math.min(3,boundedCalls-toolCalls-plannerCalls,next.calls.length);
    const current = next.calls.slice(0,available);
    const settled = await Promise.allSettled(current.map(async call=>{
      const remaining = Math.max(1,Number(deadlineAt||Date.now()+8000)-Date.now());
      return dispatch(call.name,call.arguments,{signal,timeoutMs:Math.min(10_000,remaining)});
    }));
    for (let index=0;index<current.length;index++) {
      const call=current[index], outcome=settled[index];toolCalls++;calls.push({name:call.name,status:outcome.status==='fulfilled'?'completed':'failed',
        ...(outcome.status==='rejected'?{error_code:String(outcome.reason?.code||'READ_TOOL_FAILED').slice(0,80)}:{})});
      if(outcome.status==='fulfilled')results.push({name:call.name,result:outcome.value,summary:summarizeToolResult(call.name,outcome.value)});
      else results.push({name:call.name,error_code:String(outcome.reason?.code||'READ_TOOL_FAILED').slice(0,80)});
    }
    const remaining = boundedCalls-toolCalls-plannerCalls;
    if(round===0&&remaining>=2&&results.some(item=>item.result)&&typeof continuePlan==='function'&&Date.now()<Number(deadlineAt||Infinity)){
      try {
        plannerCalls++;
        const continuation=await continuePlan(results.filter(item=>item.summary).map(item=>({name:item.name,result:item.summary})),{signal,
          timeoutMs:Math.min(8_000,Math.max(1,Number(deadlineAt||Date.now()+8_000)-Date.now()))});
        calls.push({name:'read_tool_planner',status:'completed'});
        next=normalizeCalls(continuation?.read_tools);
        rejected+=next.rejected;
      } catch(error) {
        signal?.throwIfAborted?.();calls.push({name:'read_tool_planner',status:'failed',error_code:String(error?.code||'READ_TOOL_PLAN_FAILED').slice(0,80)});next={calls:[],rejected:0};
      }
    } else next={calls:[],rejected:0};
  }
  const successCount=results.filter(item=>item.result).length;
  return {status:successCount===calls.filter(call=>call.name!=='read_tool_planner').length?'completed':successCount?'partial':'failed',
    calls,results,tool_calls_used:toolCalls,planner_calls:plannerCalls,rejected_calls:rejected,
    ...evidenceFromResults(results),source_ids:sourceIdsFromResults(results),
    gaps:calls.filter(call=>call.status==='failed').map(call=>`${call.name} did not return a verified read result.`)};
}

module.exports={ALLOWED_TOOLS,ANALYTICAL_INTENTS,INTENT_CLASSES,classifyIntent,normalizeCalls,run,evidenceFromResults,sourceIdsFromResults,summarizeToolResult};
