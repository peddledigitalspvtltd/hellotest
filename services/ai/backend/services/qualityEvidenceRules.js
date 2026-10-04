const { createHash } = require('crypto');
const VERSION = 'quality-evidence/1';
const list = value => Array.isArray(value) ? value : [];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ref = (kind, row) => `${kind}:${row.id}`;
const closed = value => /^(closed|done|resolved|accepted|complete|completed|fixed|verified)$/i.test(String(value || ''));
const unique = values => [...new Set(values)];
const coverageRules = require('./qualityCoverageRules');

function buildGraph(snapshot) {
  const nodes = [], edges = [], byKey = new Map();
  for (const [kind, rows] of Object.entries({ story: snapshot.stories, test: snapshot.tests, run: snapshot.runs, attempt: snapshot.attempts, defect: snapshot.defects })) {
    for (const row of list(rows)) {
      const node = { id: ref(kind, row), kind, entity_id: row.id, title: row.title || row.name || row.id, revision: hash(row), observed_at: snapshot.as_of };
      nodes.push(node); byKey.set(node.id, node);
    }
  }
  for (const story of list(snapshot.stories)) for (const [index, criterion] of coverageRules.criteria(story).entries()) {
    const id = `obligation:${coverageRules.obligationId(story,index)}`;
    const node = { id,kind:'obligation',entity_id:id,title:coverageRules.criterionText(criterion),revision:coverageRules.storyRevision(story),observed_at:snapshot.as_of };
    nodes.push(node);byKey.set(id,node);
  }
  for (const test of list(snapshot.tests)) for (const step of list(test.steps).filter(step=>step.expected_result?.trim())) {
    const id = `assertion:${test.id}:${step.id}`;
    const node = { id,kind:'assertion',entity_id:step.id,title:step.expected_result,revision:coverageRules.assertionHash(step),observed_at:snapshot.as_of };
    nodes.push(node);byKey.set(id,node);
  }
  const add = (source, target, relation, reviewId = null) => {
    if (!byKey.has(source) || !byKey.has(target)) return;
    edges.push({ id: hash([source, target, relation]), source, target, relation, source_revision: byKey.get(source).revision,
      target_revision: byKey.get(target).revision, origin: reviewId ? 'human_review' : 'recorded_relationship', evidence_ids: reviewId ? [reviewId] : [source,target], evidence_status: reviewId ? 'reviewed' : 'recorded', project_id: snapshot.project_id, observed_at: snapshot.as_of });
  };
  for (const story of list(snapshot.stories)) for (const [index] of coverageRules.criteria(story).entries()) add(ref('story',story),`obligation:${coverageRules.obligationId(story,index)}`,'defines');
  for (const test of list(snapshot.tests)) for (const step of list(test.steps)) add(ref('test',test),`assertion:${test.id}:${step.id}`,'contains_assertion');
  for (const row of coverageRules.coverage(snapshot).rows) for (const review of row.reviewed_assertions) add(`assertion:${review.test_case_id}:${review.step_id}`,`obligation:${row.obligation_id}`,'verifies',review.review_id);
  for (const story of list(snapshot.stories)) for (const id of list(story.test_case_ids)) add(ref('story', story), `test:${id}`, 'linked_to');
  for (const attempt of list(snapshot.attempts)) { add(`run:${attempt.execution_id}`, ref('attempt', attempt), 'contains_attempt'); add(`test:${attempt.test_case_id}`, ref('attempt', attempt), 'executed_as'); }
  for (const defect of list(snapshot.defects)) {
    for (const id of list(defect.requirement_ids)) add(`story:${id}`, ref('defect', defect), 'linked_defect');
    for (const id of list(defect.test_case_ids)) add(`test:${id}`, ref('defect', defect), 'linked_defect');
  }
  return { name: 'AI Quality Graph', nodes, edges: [...new Map(edges.map(edge => [edge.id, edge])).values()], complete: snapshot.complete,
    limitations: ['Recorded links establish traceability, not assertion adequacy or causation.', 'Relationships are indexed by immutable source revisions. Each assessment refreshes its authoritative scope; inferred relationships are not promoted automatically.'] };
}

function traverse(graph, roots, { maxDepth = 4, maxNodes = 200 } = {}) {
  const available = new Set(graph.nodes.map(node => node.id));
  const adjacency = new Map();
  for (const edge of graph.edges) { if (!adjacency.has(edge.source)) adjacency.set(edge.source, []); adjacency.get(edge.source).push(edge); }
  const visited = new Set(), paths = [], queue = unique(roots).filter(id => available.has(id)).map(id => ({ id, path: [], depth: 0 }));
  let truncated = false;
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current.id)) continue;
    if (visited.size >= maxNodes) { truncated = true; break; }
    visited.add(current.id);
    paths.push({ node_id: current.id, edge_ids: current.path });
    const outgoing = adjacency.get(current.id) || [];
    if (current.depth >= maxDepth) { if (outgoing.some(edge => !visited.has(edge.target))) truncated = true; continue; }
    for (const edge of outgoing) if (!visited.has(edge.target)) queue.push({ id: edge.target, path: [...current.path, edge.id], depth: current.depth + 1 });
  }
  return { paths, complete: graph.complete && !truncated && roots.every(id => available.has(id)), truncated, max_depth: maxDepth, max_nodes: maxNodes,
    missing_roots: roots.filter(id => !available.has(id)) };
}

const { coverage } = require('./qualityCoverageRules');

function readiness(snapshot, coverageReport) {
  const complete = snapshot.complete === true;
  const exactScope = Boolean(snapshot.scope.release_id && snapshot.scope.build && snapshot.scope.environment_id);
  const openBlockers = list(snapshot.defects).filter(row => !closed(row.status) && /^(critical|blocker|1|s1)$/i.test(String(row.severity || '')));
  const failures = list(snapshot.attempts).filter(row => ['failed', 'blocked'].includes(row.status));
  const pending = list(snapshot.attempts).filter(row => !['passed', 'failed', 'blocked'].includes(row.status));
  const gates = [
    { id: 'exact-scope', label: 'Release, build and environment', status: exactScope ? 'pass' : 'unknown', evidence: [], detail: exactScope ? 'Evidence filtered to the selected scope.' : 'Select an exact release, build and environment.' },
    { id: 'source-completeness', label: 'Accessible evidence is complete', status: complete ? 'pass' : 'unknown', evidence: [], detail: complete ? 'Every requested query completed within its limit.' : 'A source is unavailable or exceeds the evidence limit.' },
    { id: 'blocking-defects', label: 'No recorded critical Defects', status: openBlockers.length ? 'fail' : complete ? 'pass' : 'unknown', evidence: openBlockers.map(row => ref('defect', row)), detail: `${openBlockers.length} recorded open critical or blocker Defects.` },
    { id: 'execution-outcomes', label: 'Required execution outcomes', status: failures.length ? 'fail' : exactScope && complete && snapshot.attempts.length && !pending.length ? 'pass' : 'unknown', evidence: failures.map(row => ref('attempt', row)), detail: `${failures.length} failed or blocked attempts; ${pending.length} unfinished outcomes. Passing retries never erase an observed failure.` },
    { id: 'obligation-coverage', label: 'Verified acceptance coverage', status: coverageReport.rows.some(row => row.observed === 'failed') ? 'fail' : coverageReport.unknown_weight || !coverageReport.denominator_complete ? 'unknown' : 'pass', evidence: [], detail: 'Criterion-level assertions and exact-build execution must be verified.' },
    { id: 'approved-policy', label: 'Organization release policy', status: 'unknown', evidence: [], detail: 'These baseline checks do not establish an approved release policy or waivers.' }
  ];
  const authority = require('./qualityReleasePolicyRules').apply(snapshot,gates);
  return { status: gates.some(gate => gate.status === 'fail') ? 'not_ready' : gates.some(gate => gate.status === 'unknown') ? 'unknown' : 'ready',
    ...authority, deployment_authorized: false };
}

function flaky(snapshot) {
  const runs = new Map(list(snapshot.runs).map(run => [run.id, run]));
  const groups = new Map(); let incomparable = 0;
  for (const attempt of list(snapshot.attempts)) {
    const run = runs.get(attempt.execution_id);
    if (!run?.build || !run.test_environment_id || !run.configuration_hash || !attempt.case_revision || !attempt.data_hash || !['passed', 'failed'].includes(attempt.status)) { incomparable++; continue; }
    const key = hash([attempt.test_case_id, attempt.case_revision, run.build, run.test_environment_id, run.configuration_hash, attempt.data_hash]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(attempt);
  }
  const rows = [...groups].map(([comparison_key, attempts]) => {
    const n = attempts.length, failed = attempts.filter(row => row.status === 'failed').length, rate = failed / n, z = 1.96, denominator = 1 + z * z / n;
    const middle = (rate + z * z / (2 * n)) / denominator, spread = z * Math.sqrt(rate * (1 - rate) / n + z * z / (4 * n * n)) / denominator;
    return { comparison_key, test_case_id: attempts[0].test_case_id, sample_size: n, failed, failure_rate: rate,
      wilson_95_interval: [Math.max(0, middle - spread), Math.min(1, middle + spread)], status: failed > 0 && failed < n ? 'suspect' : n < 5 ? 'insufficient_sample' : 'no_mixed_outcomes_observed',
      evidence: attempts.map(row => ref('attempt', row)), limitation: 'Descriptive interval assumes independent trials; retries and overwritten histories may violate this. No automatic quarantine or flakiness confirmation.' };
  });
  return { rows, incomparable_attempt_count: incomparable, complete: snapshot.complete, confirmed_flaky_count: null };
}

function assess(snapshot, feature, input = {}) {
  const graph = buildGraph(snapshot), coverageReport = coverage(snapshot), release = readiness(snapshot, coverageReport);
  const roots = input.story_id ? [`story:${input.story_id}`] : input.test_case_id ? [`test:${input.test_case_id}`] : graph.nodes.filter(node => node.kind === 'story').slice(0, 20).map(node => node.id);
  const risk = { band: release.gates.some(gate => gate.status === 'fail') ? 'high' : !snapshot.complete || !snapshot.stories.length ? 'unknown' : 'review_required', probability: null,
    method: 'Uncalibrated rule-based indicators', indicators: release.gates.filter(gate => gate.status !== 'pass').map(gate => ({ id: gate.id, status: gate.status, detail: gate.detail })) };
  const simulation = { actual_status: release.status, hypothetical: true, scenarios: release.gates.filter(gate => !['pass','waived'].includes(gate.status)).map(gate => {
    const remaining = release.gates.filter(item => item.id !== gate.id);
    return { assumption: `Verified evidence satisfies ${gate.label}`, gate_id: gate.id, projected_status: remaining.some(item => item.status === 'fail') ? 'not_ready' : remaining.some(item => item.status === 'unknown') ? 'unknown' : 'ready', required_evidence: gate.detail };
  }), changes_applied: false };
  const data = feature === 'F11' ? release : feature === 'F12' ? { ...traverse(graph, roots), graph } : feature === 'F13' ? coverageReport : feature === 'F14' ? risk : feature === 'F15' ? flaky(snapshot) : feature === 'F16' ? simulation : graph;
  return { feature_id: feature, verifier_version: VERSION, snapshot_hash: hash(snapshot), as_of: snapshot.as_of, scope: snapshot.scope,
    execution_status: 'completed', publication_status: 'proposal', readiness: feature === 'F11' ? release.status : 'review_required',
    evidence_complete: snapshot.complete, limitations: snapshot.limitations, data };
}
module.exports = { assess, buildGraph, traverse, coverage, readiness, flaky, hash, VERSION };
