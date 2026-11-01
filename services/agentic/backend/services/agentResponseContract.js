// Code-owned transport fields. Agent objectives and task guidance remain in AI Controls.
const text = { type: 'string' };
const references = { type: 'array', maxItems: 36, items: { type: 'string', minLength: 1 } };
const texts = { type: 'array', maxItems: 20, items: text };
const nonempty = maxLength => ({ type: 'string', minLength: 1, maxLength });
const cited = { title: nonempty(300), citation_ids: { ...references, minItems: 1 } };
const requiredForKind = (kind, required, properties = {}) => ({
  if: { properties: { kind: { const: kind } }, required: ['kind'] },
  then: { required, properties }
});
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
        priority: { enum: ['P1', 'P2', 'P3', 'P4', 'P5'] }, citation_ids: references, addressed_finding_ids: { ...references, maxItems: 20 },
        target_id: text, acceptance_criteria: { ...texts, maxItems: 30 }, test_case_type: nonempty(120), parameter_values: { type: 'object', maxProperties: 40, additionalProperties: { type: 'string', maxLength: 4000 } },
        prerequisites: texts, test_data: texts, cleanup: texts,
        authoring_mode: { enum: ['structured', 'gherkin'] }, gherkin_document: { type: ['string', 'null'], maxLength: 16000 },
        start_url: { type: ['string', 'null'], maxLength: 2048 }, manual_test_case_ids: { ...references, maxItems: 16 },
        steps: { type: 'array', maxItems: 30, items: { type: 'object', required: ['action', 'expected_result'],
          properties: { action: text, expected_result: text, step_type: { enum: ['web', 'api', 'android', 'ios'] } } } },
        requirement_ids: { ...references, maxItems: 16 }, reproduction_steps: texts, expected_result: text, actual_result: text,
        severity: { enum: ['critical', 'high', 'medium', 'low'] }, test_case_ids: { ...references, maxItems: 50 }, exit_criteria: texts },
      allOf: [
        requiredForKind('story', ['acceptance_criteria'], { acceptance_criteria: { minItems: 1 } }),
        requiredForKind('defect', ['reproduction_steps', 'expected_result', 'actual_result', 'severity'], { reproduction_steps: { minItems: 1 } }),
        requiredForKind('run', ['test_case_ids', 'exit_criteria'], { test_case_ids: { minItems: 1 }, exit_criteria: { minItems: 1 } }),
        ...['test_case', 'automation'].map(kind => requiredForKind(kind, ['test_case_type', 'parameter_values'])),
        { if: { properties: { kind: { enum: ['test_case', 'automation'] } }, required: ['kind'] }, then: {
          if: { properties: { authoring_mode: { const: 'gherkin' } }, required: ['authoring_mode'] },
          then: { required: ['gherkin_document'], properties: { gherkin_document: nonempty(16000) } },
          else: { required: ['steps'], properties: { steps: { minItems: 1 } } }
        } },
        requiredForKind('automation', ['start_url'], { authoring_mode: { const: 'structured' } })
      ]
    } },
    sections: { type: 'array', maxItems: 8, items: { type: 'object', required: ['title', 'body', 'citation_ids'], properties: { ...cited, body: nonempty(8000) } } },
    tables: { type: 'array', maxItems: 8, items: { type: 'object', required: ['title', 'columns', 'rows', 'citation_ids'], properties: {
      ...cited, columns: { type: 'array', minItems: 1, maxItems: 8, items: nonempty(160) },
      rows: { type: 'array', maxItems: 50, items: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', maxLength: 2000 } } }
    } } },
    charts: { type: 'array', maxItems: 8, items: { type: 'object', required: ['title', 'type', 'unit', 'series', 'citation_ids'], properties: {
      ...cited, type: { const: 'bar' }, unit: nonempty(80), series: { type: 'array', minItems: 1, maxItems: 20, items: {
        type: 'object', required: ['label', 'value'], properties: { label: nonempty(160), value: { type: 'number' } }
      } }
    } } },
    automation_repair: { oneOf: [{ type: 'null' }, ...['replace_locator', 'replace_instructions'].map(kind => ({
      type: 'object', additionalProperties: false, required: ['kind', 'step_id', 'rationale', kind === 'replace_locator' ? 'new_locator' : 'automation_code'],
      properties: { kind: { const: kind }, step_id: nonempty(255), rationale: { type: 'string', minLength: 20, maxLength: 2000 },
        ...(kind === 'replace_locator' ? { new_locator: nonempty(1024) } : { automation_code: nonempty(32000) }) }
    }))] },
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
