function verificationId(draft) {
  const id = draft?.verification?.verification_id;
  if (draft?.verification_status === 'verified' && draft.verification?.status === 'passed'
    && draft.live_validation?.status !== 'blocked'
    && typeof id === 'string' && id.trim()) return id;
}

function preservesSections(authored, generated) {
  if (!Array.isArray(generated) || generated.length !== authored.length) return false;
  const text = value => String(value ?? '');
  return authored.every((step, index) => {
    const section = generated[index];
    return section && ((!step.id && !section.id) || section.id === (step.id || `draft-step-${index + 1}`))
      && (section.step_order == null || section.step_order === index + 1)
      && text(section.action) === text(step.action) && text(section.expected_result) === text(step.expected_result);
  });
}

function executionEvidence(draft, { inspect_browser, allow_browser_actions, verification_mode, requestedVerification }) {
  const grounding = draft.live_validation?.status === 'blocked' ? 'blocked'
    : allow_browser_actions && draft.live_validation?.status === 'observed' ? 'observed'
      : inspect_browser && !allow_browser_actions ? 'entry_inspected' : 'not_established';
  let verification = 'not_requested';
  if (grounding === 'blocked') verification = 'live_validation_blocked';
  else if (verificationId(draft)) verification = 'passed';
  else if (draft.verification?.status === 'failed') verification = 'failed';
  else if (draft.verification?.status === 'blocked') verification = 'blocked';
  else if (draft.verification_status === 'verified' || ['verify', 'verify_repair'].includes(verification_mode)) verification = 'receipt_missing';
  else if (['verify', 'verify_repair'].includes(requestedVerification)) verification = 'unsupported';
  return { grounding, verification };
}

function needsExecutionReview(draft) {
  if (draft.execution_evidence) return draft.execution_evidence.verification === 'passed' ? !verificationId(draft)
    : draft.execution_evidence.verification !== 'not_requested';
  return draft.live_validation?.status === 'blocked' || (draft.verification_status === 'verified' && !verificationId(draft))
    || ['failed', 'blocked', 'running'].includes(draft.verification?.status);
}

module.exports = { verificationId, preservesSections, executionEvidence, needsExecutionReview };
