'use strict';

const { sanitizeAiText } = require('@hellotest/platform/backend/src/security/aiTextPolicy');

const MIN_ACTORS = 5;
const QUERY_CLASSES = new Set(['tool_help','project_analysis','bug_triage','test_design','story_delivery','test_execution','run_analysis','workflow_execution']);
const safeClass = value => QUERY_CLASSES.has(value) ? value : 'other';
const safeStatus = value => ['COMPLETE','PARTIAL','FAILED'].includes(value) ? value : 'UNKNOWN';
const refKey = (traceId, evidenceId) => `${traceId}\u001f${evidenceId}`;
const newBucket = () => ({ actors:new Set(), traceIds:new Set(), selected:0, submitted:0, cited:0, statuses:{COMPLETE:0,PARTIAL:0,FAILED:0,UNKNOWN:0} });

function aggregateContextHealth({ projectId, rows, events, visibleEvidence, sourceDetails, days, truncated, generatedAt = new Date() }) {
  const queryBuckets = new Map(), sourceBuckets = new Map(), eventMap = new Map();
  for (const event of events) {
    const list=eventMap.get(event.trace_id)||[];list.push(event);eventMap.set(event.trace_id,list);
  }
  const overall = newBucket();
  for (const row of rows) {
    overall.actors.add(row.actor_id);overall.traceIds.add(row.id);
    const status=safeStatus(row.coverage?.retrieval_status),category=safeClass(row.selection?.query_category);
    const query=queryBuckets.get(category)||newBucket();query.actors.add(row.actor_id);query.traceIds.add(row.id);query.statuses[status]++;overall.statuses[status]++;
    const refs=Array.isArray(row.evidence_refs)?row.evidence_refs:[],visibleRefs=refs.filter(ref=>visibleEvidence.has(refKey(row.id,ref.evidence_id)));
    query.selected+=visibleRefs.length;overall.selected+=visibleRefs.length;
    const evidenceEvents=(eventMap.get(row.id)||[]).flatMap(event=>Array.isArray(event.metadata?.evidence_ids)
      ?event.metadata.evidence_ids.map(id=>({type:event.event_type,status:event.status,id})):[]);
    const submitted=new Set(evidenceEvents.filter(item=>item.type==='CONTEXT_SENT'&&item.status==='submitted').map(item=>item.id));
    const cited=new Set(evidenceEvents.filter(item=>item.type==='CITATIONS_RECORDED').map(item=>item.id));
    for(const ref of visibleRefs){
      const wasSubmitted=submitted.has(ref.evidence_id),wasCited=cited.has(ref.evidence_id);
      if(wasSubmitted){query.submitted++;overall.submitted++;}
      if(wasCited){query.cited++;overall.cited++;}
      let sourceId=null,title='Live project snapshot',kind=ref.source_kind;
      if(ref.source_kind!=='live_project'&&ref.source_kind!=='product_help'){
        const source=sourceDetails.get(ref.source_id);if(!source)continue;
        sourceId=source.id;title=sanitizeAiText(source.title||'Knowledge source').text;
      } else if(ref.source_kind==='product_help') { sourceId='hellotest-product-help';title='HelloTest product guide'; }
      const key=sourceId||`kind:${kind}`;const source=sourceBuckets.get(key)||newBucket();
      source.actors.add(row.actor_id);source.traceIds.add(row.id);source.selected++;
      if(wasSubmitted)source.submitted++;if(wasCited)source.cited++;
      source.title=title;source.source_id=sourceId;source.source_kind=kind;sourceBuckets.set(key,source);
    }
    queryBuckets.set(category,query);
  }
  const actors=overall.actors.size,cohortAvailable=actors>=MIN_ACTORS;
  const metrics=(bucket)=>({trace_count:bucket.traceIds.size,selected_evidence_count:bucket.selected,submitted_evidence_count:bucket.submitted,
    cited_evidence_count:bucket.cited,citation_observation_rate:bucket.submitted?Number((bucket.cited/bucket.submitted).toFixed(4)):null,
    retrieval_status:bucket.statuses});
  const queryClasses=cohortAvailable?[...queryBuckets].filter(([,bucket])=>bucket.actors.size>=MIN_ACTORS).map(([queryClass,bucket])=>({query_class:queryClass,...metrics(bucket)})).sort((a,b)=>a.query_class.localeCompare(b.query_class)):[];
  const sources=cohortAvailable?[...sourceBuckets.values()].filter(bucket=>bucket.actors.size>=MIN_ACTORS).map(bucket=>({source_id:bucket.source_id,
    source_title:bucket.title,source_kind:bucket.source_kind,...metrics(bucket)})).sort((a,b)=>a.source_title.localeCompare(b.source_title)):[];
  return {schema_version:'context-health/1',project_id:projectId,generated_at:generatedAt.toISOString(),window_days:days,
    observations:{...(cohortAvailable?metrics(overall):{}),cohort_available:cohortAvailable,partial:truncated===true},
    query_classes:queryClasses,sources,
    privacy:{minimum_distinct_actors:MIN_ACTORS,metrics_suppressed:!cohortAvailable||queryClasses.length<queryBuckets.size||sources.length<sourceBuckets.size,
      rule:'Only aggregates with at least five distinct actors are returned. Actor IDs, questions, prompts, and passage text are never included.'},
    limitations:[...(truncated?['The bounded trace scan reached its limit; counts describe the newest observed traces in this window.']:[]),
      'Evidence counts include only sources that remain visible under current permissions. Submitted and cited counts record application events and do not prove provider receipt, entailment, answer correctness, or causality.',
      'The service samples some non-chat features. Counts describe observed traces and are not extrapolated to unsampled traffic.']};
}

module.exports={MIN_ACTORS,QUERY_CLASSES,refKey,aggregateContextHealth};
