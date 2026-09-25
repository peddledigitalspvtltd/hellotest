const { createHash } = require('crypto');

const FIELD = '_story_readiness';
const DEFINITIONS = {
  backlog: [
    ['persona_value', 'Persona and Business Value'],
    ['acceptance_criteria', 'Defined Acceptance Criteria'],
    ['wireframe', 'Attached Wireframe'],
    ['dependencies', 'Resolved Dependencies'],
    ['story_points', 'Team Agreed Story Points']
  ],
  release: [
    ['acceptance_tests', 'All Acceptance Criteria Tested and Passed'],
    ['code_review', 'Code Review Approved and Merged'],
    ['automated_tests', 'Automated Unit and Integration Tests Passing'],
    ['critical_defects', 'No Open Blocker or High Defects'],
    ['product_owner', 'Product Owner Sign-off']
  ]
};
const KEYS = new Set(Object.values(DEFINITIONS).flat().map(([key]) => key));
const text = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|#160);/g, ' ').replace(/\s+/g, ' ').trim();
const object = value => {
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
};
const contentHash = story => createHash('sha256').update(JSON.stringify([
  story.title || '', story.description || '', story.gherkin_scenarios || [],
  story.specification_format || '', story.specification_content || '',
  object(story.additional_fields).acceptance_criteria || story.acceptance_criteria || []
])).digest('hex');

function deriveStoryReadiness(story, facts = {}) {
  const mode = facts.assigned || facts.release_scoped || story.iteration_id || text(story.sprint) || text(story.release) || text(story.fix_version) ? 'release' : 'backlog';
  const saved = object(object(story.additional_fields)[FIELD]);
  const hash = contentHash(story);
  const checks = DEFINITIONS[mode].map(([key, label]) => {
    const review = object(object(saved.checks)[key]);
    const currentReview = review.content_hash === hash && Boolean(review.verified_by && review.verified_at);
    const check = { key, label, status:'unverified', source:'unverified', evidence:'No verified evidence recorded.' };
    if (currentReview && ['met', 'not_met'].includes(review.status)) Object.assign(check, {
      status:review.status, source:'review', evidence:text(review.evidence),
      verified_by:review.verified_by, verified_at:review.verified_at,
      ...(review.attachment_id ? { attachment_id:review.attachment_id } : {})
    });
    else if (review.verified_at && !currentReview) check.evidence = 'Story content changed after the last review; verify this check again.';
    const placeholder = value => /\[[^\]]+\]|\b(?:TBD|TODO)\b/i.test(text(value));
    if (key === 'persona_value' && check.source !== 'review' && !placeholder(story.description) && /\bas an?\b.+\bi want\b.+\bso that\b.+/i.test(text(story.description))) {
      Object.assign(check, { status:'met', source:'record', evidence:'Saved description names a persona, requested outcome, and business value.' });
    }
    const scenarios = Array.isArray(story.gherkin_scenarios) ? story.gherkin_scenarios : [];
    const criteria = object(story.additional_fields).acceptance_criteria || story.acceptance_criteria;
    const acceptanceBehavior = Array.isArray(criteria) && criteria.length ? criteria : scenarios;
    if (key === 'acceptance_criteria' && check.source !== 'review' && acceptanceBehavior.length > 0 && acceptanceBehavior.every(value => !placeholder(value) && /\bgiven\b.+\bwhen\b.+\bthen\b.+/i.test(text(value)))) {
      Object.assign(check, { status:'met', source:'record', evidence:Array.isArray(criteria) && criteria.length ? 'Every saved acceptance criterion contains explicit Given, When, and Then behavior.' : 'Every saved Gherkin scenario contains explicit Given, When, and Then acceptance behavior.' });
    }
    if (key === 'wireframe' && check.status === 'met' && !(facts.attachment_ids || []).includes(review.attachment_id)) {
      Object.assign(check, { status:'unverified', evidence:'The reviewed wireframe attachment is no longer attached to this Story.' });
    }
    if (key === 'acceptance_tests' && check.status === 'met') {
      if (!facts.execution_complete) Object.assign(check, { status:'unverified', evidence:'Acceptance coverage was reviewed, but execution evidence is unavailable with the current access.' });
      else if (!facts.linked_cases || facts.executed_cases !== facts.linked_cases || facts.passed_cases !== facts.linked_cases) {
        Object.assign(check, { status:'not_met', evidence:`Acceptance coverage was reviewed; ${facts.passed_cases || 0} of ${facts.linked_cases || 0} linked cases have a latest finalized passing outcome.` });
      }
    }
    if (key === 'critical_defects' && Number.isInteger(facts.open_priority_bugs)) {
      Object.assign(check, { status:facts.open_priority_bugs === 0 ? 'met' : 'not_met', source:'record', evidence:`${facts.open_priority_bugs} linked open blocker, critical, or high priority/severity defects in this project.` });
    }
    return check;
  });
  const met = checks.filter(check => check.status === 'met').length;
  const known = checks.filter(check => check.status !== 'unverified').length;
  return { mode, label:mode === 'backlog' ? 'Story Readiness' : 'Story Release Readiness', score:known ? met * 20 : null, met, known, total:5, checks };
}

// Generic imports, clones and Jira field saves may carry this reserved key.
// Only the revision-checked readiness endpoint can create or replace reviews.
function preserveReadinessFields(incoming, existing) {
  const fields = { ...object(incoming) };
  delete fields[FIELD];
  const previous = object(existing)[FIELD];
  if (previous) fields[FIELD] = previous;
  return fields;
}

module.exports = { FIELD, KEYS, DEFINITIONS, contentHash, deriveStoryReadiness, preserveReadinessFields, object };
