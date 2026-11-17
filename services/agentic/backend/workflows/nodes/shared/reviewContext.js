const text=value=>typeof value==='string'?value.trim():'';
const array=value=>Array.isArray(value)?value:[];
function specialistPrompt(run, node, sources) {
  const data = node.data || {};
  // The saved node owns instructions, skills and guardrails. The assistant
  // receives connected data separately, with its original structure and
  // provenance; duplicating excerpts here made larger inputs look complete.
  return text(data.prompt) || text(data.intent) || text(data.agentSnapshot?.definition?.objective);
}

const collectReviews = (sources) => sources.flatMap(source => {
  if (array(source.iterations).length) return source.iterations.filter(item => item.status === 'completed').flatMap(item => collectReviews([item]).map(review => ({ ...review, iteration_path: item.iteration_path, batch_index: item.batch_index })));
  const out = source.output || {};
  return out.response ? [{ node_id: source.node_id, session_id: out.session_id, repository_run_id: out.repository_run_id, repository_agent_type: out.repository_agent_type, response: out.response, readiness: out.readiness, citation_ids: out.citation_ids }]
    : array(out.items).filter(item => item.session_id).map(item => ({ node_id: source.node_id, item_index: item.index, session_id: item.session_id, response: item.response, readiness: item.readiness, citation_ids: item.citation_ids })).concat(array(out.reviews));
}).filter((review, index, all) => all.findIndex(other => other.node_id === review.node_id && other.item_index === review.item_index && JSON.stringify(other.iteration_path) === JSON.stringify(review.iteration_path)) === index).slice(0, 1000);
const reviewSource = source => source.status === 'completed' || array(source.iterations).some(item => item.status === 'completed');

module.exports={specialistPrompt,collectReviews,reviewSource};
