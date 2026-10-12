// Preserve identity/source lines in every batch. Full domain drafts stay in the
// compiler result; the model receives compact evidence rather than duplicate exports.
function reviewBatches(findings, maxBytes = 12000) {
  const batches = []; let batch = [], bytes = 2;
  for (const finding of findings) {
    const item = { id: finding.id, title: finding.title || finding.name, description: finding.description,
      evidence: finding.evidence, method: finding.method, path: finding.path, expected_status: finding.expected_status,
      steps: finding.steps, assumptions: finding.assumptions, review_reasons: finding.review_reasons };
    let size = Buffer.byteLength(JSON.stringify(item));
    if (size > maxBytes - 2) {
      item.title = String(item.title || '').slice(0,255);
      item.description = String(item.description || '').slice(0,2000);
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
module.exports = { reviewBatches };
