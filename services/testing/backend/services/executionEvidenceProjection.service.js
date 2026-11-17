const db = require('@hellotest/platform/backend/src/db');
const { buildExecutionReportModel } = require('./executionReportModel');
const { hasPermission } = require('@hellotest/platform/backend/services/permission.service');

// Read canonical executed identities only. Linked-manual result projections are
// lineage unless the manual case itself is in the immutable run selection.
async function loadRunEvidence(executionIds, { database = db } = {}) {
  if (!executionIds.length) return new Map();
  const [cases, results, stories] = await Promise.all([
    database.prepare(`SELECT execution_id, test_case_id, requirement_snapshots, test_data_set_snapshot->>'mode' AS data_mode,
      CASE WHEN jsonb_typeof(test_data_set_snapshot->'rows') = 'array' THEN jsonb_array_length(test_data_set_snapshot->'rows') ELSE 0 END AS data_rows
      FROM execution_case_snapshots WHERE execution_id IN (SELECT jsonb_array_elements_text(?::jsonb))`).all(executionIds),
    database.prepare(`SELECT result.id, result.execution_id, result.test_case_id, result.status, result.created_at,
      result.data_set_iteration_index, result.data_set_iteration_key, result.derived, result.covers_entire_case
      FROM test_case_effective_results result
      WHERE result.execution_id IN (SELECT jsonb_array_elements_text(?::jsonb))
        AND (EXISTS (SELECT 1 FROM execution_case_snapshots selected WHERE selected.execution_id=result.execution_id AND selected.test_case_id=result.test_case_id)
          OR (NOT result.derived AND NOT EXISTS (SELECT 1 FROM execution_case_snapshots any_case WHERE any_case.execution_id=result.execution_id)))`).all(executionIds),
    database.prepare(`WITH selected AS (
      SELECT execution_id, test_case_id, requirement_snapshots FROM execution_case_snapshots WHERE execution_id IN (SELECT jsonb_array_elements_text(?::jsonb))
    ), live_links AS (
      SELECT selected.execution_id, selected.test_case_id, mapping.requirement_id FROM selected
      JOIN requirement_test_cases mapping ON mapping.test_case_id=selected.test_case_id WHERE selected.requirement_snapshots IS NULL
      UNION SELECT selected.execution_id, selected.test_case_id, test_cases.requirement_id FROM selected
      JOIN test_cases ON test_cases.id=selected.test_case_id WHERE selected.requirement_snapshots IS NULL AND test_cases.requirement_id IS NOT NULL
    ), links AS (
      SELECT selected.execution_id,selected.test_case_id,frozen.value->>'id' AS requirement_id,frozen.value->>'display_id' AS display_id,frozen.value->>'title' AS title
      FROM selected CROSS JOIN LATERAL jsonb_array_elements(COALESCE(selected.requirement_snapshots,'[]'::jsonb)) frozen(value)
      UNION SELECT live_links.execution_id,live_links.test_case_id,story.id,story.display_id,story.title FROM live_links
      JOIN executions run ON run.id=live_links.execution_id JOIN requirements story ON story.id=live_links.requirement_id AND story.project_id=run.project_id
    ) SELECT DISTINCT * FROM links ORDER BY execution_id,requirement_id,test_case_id`).all(executionIds)
  ]);
  return new Map(executionIds.map(id => {
    const caseRows = cases.filter(row => row.execution_id === id).map(row => ({test_case_id:row.test_case_id,
      ...(row.data_rows ? {test_data_set_snapshot:{mode:row.data_mode,rows:Array.from({length:Number(row.data_rows)},()=>({}))}} : {})}));
    const rows = results.filter(row => row.execution_id === id);
    const covered = new Set(rows.filter(row=>row.derived&&row.covers_entire_case).map(row=>row.test_case_id));
    const report = buildExecutionReportModel({id,case_snapshots:caseRows}, rows.filter(row=>row.derived||row.status!=='pending'||!covered.has(row.test_case_id)));
    const failed = new Set(report.cases.filter(row=>['failed','blocked'].includes(row.status)).map(row=>row.id));
    const byStory = new Map();
    for (const row of stories.filter(row=>row.execution_id===id)) {
      if (!byStory.has(row.requirement_id)) byStory.set(row.requirement_id,{id:row.requirement_id,display_id:row.display_id,title:row.title,test_case_ids:[]});
      byStory.get(row.requirement_id).test_case_ids.push(row.test_case_id);
    }
    const scopeStories = [...byStory.values()].map(story=>({...story,failed_test_case_ids:story.test_case_ids.filter(caseId=>failed.has(caseId))}));
    return [id,{instance_summary:report.summary,frozen_scope_evidence:{availability:caseRows.length||!rows.length?'available':'unavailable',population:'frozen_run_cases',story_links_frozen:cases.filter(row=>row.execution_id===id).every(row=>Array.isArray(row.requirement_snapshots)),story_link_provenance:cases.filter(row=>row.execution_id===id).every(row=>Array.isArray(row.requirement_snapshots))?'frozen_snapshot':'legacy_current_links',failure_statuses:['failed','blocked'],total_stories:scopeStories.length,
      impacted_stories:scopeStories.filter(story=>story.test_case_ids.some(caseId=>failed.has(caseId))),stories:scopeStories}}];
  }));
}

async function loadRunDefects(executionIds, { database = db } = {}) {
  if (!executionIds.length) return new Map();
  const rows = await database.prepare(`WITH runs AS (
    SELECT id, project_id FROM executions WHERE id IN (SELECT jsonb_array_elements_text(?::jsonb))
  ), result_refs AS (
    SELECT result.execution_id, result.test_case_id, result.id AS result_id, NULL::text AS step_id, ref.value AS reference, 'result'::text AS source
    FROM execution_results result JOIN runs ON runs.id=result.execution_id
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(result.defects,'[]'::jsonb)||COALESCE(result.case_defects,'[]'::jsonb)) ref(value)
    UNION ALL
    SELECT result.execution_id, result.test_case_id, result.id, steps.key, ref.value, 'step'
    FROM execution_results result JOIN runs ON runs.id=result.execution_id
    CROSS JOIN LATERAL jsonb_each(COALESCE(result.step_defects,'{}'::jsonb)) steps
    CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(steps.value)='array' THEN steps.value ELSE '[]'::jsonb END) ref(value)
  ), links AS (
    SELECT runs.id AS execution_id, defect.id, NULL::text AS test_case_id, defect.linked_execution_result_id AS result_id,
      defect.linked_step_id AS step_id, 'run'::text AS source
    FROM runs JOIN feedback defect ON defect.linked_test_run_id=runs.id AND defect.project_id=runs.project_id
    UNION ALL
    SELECT refs.execution_id, defect.id, refs.test_case_id, refs.result_id, refs.step_id, refs.source
    FROM result_refs refs JOIN runs ON runs.id=refs.execution_id
    JOIN feedback defect ON (defect.id=refs.reference OR defect.display_id=refs.reference) AND defect.project_id=runs.project_id
  ) SELECT links.*, defect.display_id, defect.title, defect.status, defect.linked_test_case_ids
    FROM links JOIN feedback defect ON defect.id=links.id ORDER BY execution_id, id, source, result_id, step_id`).all(executionIds);
  return new Map(executionIds.map(id => {
    const byId=new Map();
    for(const row of rows.filter(row=>row.execution_id===id)) {
      if(!byId.has(row.id))byId.set(row.id,{id:row.id,display_id:row.display_id,title:row.title,status:row.status,test_case_ids:row.linked_test_case_ids||[],provenance:[]});
      const defect=byId.get(row.id);
      if(row.test_case_id&&!defect.test_case_ids.includes(row.test_case_id))defect.test_case_ids.push(row.test_case_id);
      defect.provenance.push({source:row.source,result_id:row.result_id,step_id:row.step_id,test_case_id:row.test_case_id});
    }
    return [id,[...byId.values()]];
  }));
}

async function forUser(execution, user) {
  const allowed=await hasPermission(user,'feedback.view',execution.project_id);
  const defects=allowed?(await loadRunDefects([execution.id])).get(execution.id):[];
  const projected={...execution,linked_defects:allowed?defects:undefined,defects_available:allowed,
    metrics:{...execution.metrics,defect_count:allowed?defects.length:null},
    instance_summary:execution.instance_summary?{...execution.instance_summary,defect_count:allowed?defects.length:null}:undefined};
  if (Array.isArray(execution.case_snapshots)) projected.failure_evidence = await require('./executionFailureEvidence.service').loadFailureEvidence(projected, {
    resultAccess: await hasPermission(user,'result.view',execution.project_id), defectAccess: allowed
  });
  return projected;
}

// An exact origin is optional; when supplied it must identify one real frozen
// run/case/step. Never fan a new defect out into historical result attempts.
async function assertOrigin({projectId,runId,resultId,stepId,testCaseIds=[]}) {
  if(!runId&&!resultId&&!stepId)return;
  const fail=message=>Object.assign(new Error(message),{statusCode:422,code:'DEFECT_ORIGIN_INVALID'});
  const run=runId?await db.prepare('SELECT id FROM executions WHERE id=? AND project_id=?').get(runId,projectId):null;
  if(!run)throw fail('Select a run in the defect project before linking execution evidence.');
  if(stepId&&!resultId)throw fail('A step origin requires an exact execution result.');
  if(!resultId)return;
  const result=await db.prepare('SELECT id,test_case_id FROM execution_results WHERE id=? AND execution_id=?').get(resultId,runId);
  if(!result||!testCaseIds.includes(result.test_case_id))throw fail('The result must belong to the selected run and linked test case.');
  if(stepId&&!await db.prepare('SELECT snapshot_step_id FROM execution_step_snapshots WHERE execution_id=? AND test_case_id=? AND snapshot_step_id=?').get(runId,result.test_case_id,stepId))throw fail('The step must belong to the exact frozen result case.');
}
module.exports={loadRunEvidence,loadRunDefects,forUser,assertOrigin};
