// Code-owned transport fields. Agent objectives and task guidance remain in AI Controls.
const text = { type: 'string' };
const references = { type: 'array', maxItems: 36, items: { type: 'string', minLength: 1 } };
const texts = { type: 'array', maxItems: 20, items: text };
const schema = {
  type: 'object',
  required: ['response', 'findings', 'deliverables', 'artifacts', 'evidence_gaps', 'citation_ids'],
  properties: {
    headline: { type: 'string', maxLength: 300 }, executive_summary: text,
    response: { type: 'string', minLength: 1, maxLength: 32000 }, activity_summary: text,
    findings: { type: 'array', maxItems: 20, items: {
      type: 'object', required: ['id', 'title', 'detail', 'priority', 'citation_ids'],
      properties: { id: text, title: text, detail: text, priority: { enum: ['critical', 'high', 'medium', 'low', 'info'] },
        citation_ids: references, artifact_kind: { enum: ['story', 'test_case', 'defect', 'run', 'automation'] },
        requires_proposal: { type: 'boolean' }, observation: text, gap: text, impact: text, proposed_action: text, acceptance_check: text }
    } },
    deliverables: { type: 'array', maxItems: 20, items: { type: 'object', required: ['title', 'detail', 'citation_ids'],
      properties: { type: text, title: text, detail: text, citation_ids: references } } },
    artifacts: { type: 'array', maxItems: 8, items: { type: 'object', required: ['kind', 'title', 'description', 'priority', 'citation_ids', 'addressed_finding_ids'],
      properties: { kind: { enum: ['story', 'test_case', 'defect', 'run', 'automation'] }, title: text, description: text,
        priority: { enum: ['P1', 'P2', 'P3', 'P4', 'P5'] }, citation_ids: references, addressed_finding_ids: references,
        target_id: text, acceptance_criteria: texts, test_case_type: text, parameter_values: { type: 'object', additionalProperties: text },
        steps: { type: 'array', maxItems: 30, items: { type: 'object', required: ['action', 'expected_result'],
          properties: { action: text, expected_result: text, step_type: { enum: ['web', 'api', 'android', 'ios'] } } } },
        requirement_ids: references, reproduction_steps: texts, expected_result: text, actual_result: text,
        severity: { enum: ['critical', 'high', 'medium', 'low'] }, test_case_ids: references, exit_criteria: texts }
    } },
    recommendations: texts, assumptions: texts, evidence_gaps: texts, suggested_handoffs: texts, citation_ids: references,
    no_changes_required: { type: 'boolean' },
    evaluation: { type: 'object', properties: Object.fromEntries(['grounding', 'completeness', 'traceability', 'risk_control', 'maturity_score']
      .map(key => [key, { type: 'integer', minimum: 0, maximum: 100 }]).concat([['rationale', text]])) }
  }
};

function invalidOutput(issues = []) {
  const details = issues.slice(0, 8).map(issue => ({ path: String(issue.path || 'output').slice(0, 255), issue: String(issue.issue || issue.code || 'invalid_value').slice(0, 160) }));
  const message = `The model response did not satisfy the agent output contract${details.length ? ` (${details.slice(0, 3).map(issue => `${issue.path}: ${issue.issue}`).join('; ')})` : ''}. No fallback answer was produced.`;
  return Object.assign(new Error(message), { code: 'AGENT_OUTPUT_INVALID', statusCode: 422, publicMessage: message, validation_errors: details });
}

module.exports = { schema, invalidOutput };
