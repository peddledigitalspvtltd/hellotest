const test = require('node:test');
const assert = require('node:assert/strict');
const skills = require('../../backend/services/qualityAgentSkills');
const C = require('../../backend/services/qualityAgentContracts');

test('all five executable Quality agents have distinct versioned default skills and reviewed primary references', () => {
  assert.deepEqual(C.AGENTS.map(agent => agent.id).sort(), ['accessibility', 'performance', 'security', 'visual', 'web']);
  const identifiers = new Set();
  for (const agent of C.AGENTS) {
    const profile = skills.profile(agent.id), metadata = skills.metadata(agent.id);
    identifiers.add(profile.id);
    assert.equal(metadata.id, profile.id);
    assert.equal(metadata.version, skills.version);
    assert.match(metadata.reviewed_at, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(agent.default_goal, profile.default_goal);
    assert.ok(profile.methods.length >= 3);
    assert.ok(profile.evidence_rules.length >= 2);
    assert.ok(metadata.references.length >= 1);
    assert.equal(new Set(metadata.references.map(reference => reference.id)).size, metadata.references.length);
    for (const reference of metadata.references) {
      for (const address of [reference.url, reference.guide_url]) {
        const url = new URL(address);
        assert.equal(url.protocol, 'https:');
        assert.ok(['github.com', 'playwright.dev', 'www.w3.org', 'www.zaproxy.org', 'developer.chrome.com', 'grafana.com'].includes(url.hostname));
      }
      assert.equal(reference.methodology_only, true, 'A reference must not be advertised as an installed/executed tool.');
      assert.ok(reference.use.length > 20);
    }
  }
  assert.equal(identifiers.size, 5);
});

test('agent defaults preserve each specialist intent and its actual execution evidence boundary', () => {
  const contracts = {
    web: [/observed element IDs/, /visible postcondition/, /destructive/],
    security: [/passive/i, /ASVS/, /Do not generate attack traffic/, /ZAP ran/],
    performance: [/navigation/i, /LCP/, /INP/, /not implicit installed tools/],
    accessibility: [/axe-core/, /DOM fallback/, /not WCAG conformance/],
    visual: [/approved baseline/, /manifest-only/, /channel-delta/, /pixelmatch/],
  };
  for (const [kind, expectations] of Object.entries(contracts)) {
    const instructions = skills.instructionBlock(kind);
    expectations.forEach(expected => assert.match(instructions, expected, kind));
    assert.match(instructions, /untrusted data/);
    assert.match(instructions, /Only the supplied tools are executable/);
    assert.match(instructions, /time and model budgets/);
    assert.match(instructions, /raw hidden reasoning/);
    assert.ok(Buffer.byteLength(instructions) < 6000, `${kind} defaults exceeded their bounded instruction budget.`);
  }
});

test('planning, live decisions and assessment use separate compact output instructions', () => {
  assert.match(skills.instructionBlock('web', { phase: 'planning' }), /Planning does not establish a browser observation/);
  assert.match(skills.instructionBlock('web', { phase: 'decision' }), /Wait for each tool result/);
  const assessment = skills.assessmentInstructions('security');
  assert.match(assessment, /supplied finding IDs and permitted artifact IDs/);
  assert.match(assessment, /only supplied metric keys and values/);
  assert.match(assessment, /Never replace engine outcome/);
  assert.match(assessment, /only supplied skill reference IDs/);
  assert.equal(assessment, skills.instructionBlock('security', { phase: 'assessment' }));
});

test('task context identifies the pinned skill without repeating reference instructions or the user goal', () => {
  for (const kind of C.KINDS) {
    const task = C.taskBrief({ kind, target_url: 'https://qa.example.test/', goal: 'Verify a unique requested behavior', options: { max_pages: 2, timeout_ms: 60000 } });
    assert.deepEqual(task.skill_profile, { id: skills.profile(kind).id, version: skills.version });
    assert.equal(JSON.stringify(task).match(/Verify a unique requested behavior/g).length, 1);
    assert.doesNotMatch(JSON.stringify(task.skill_profile), /github\.com|<method>|references/);
  }
});

test('caller metadata mutation cannot alter subsequent agent policy or reference evidence', () => {
  const before = skills.instructionBlock('visual');
  const metadata = skills.metadata('visual');
  metadata.references[0].url = 'https://untrusted.example.test/policy';
  metadata.references.push({ id: 'fabricated' });
  assert.equal(skills.instructionBlock('visual'), before);
  assert.notEqual(skills.metadata('visual').references[0].url, metadata.references[0].url);
  assert.ok(Object.isFrozen(skills.profile('visual')));
  assert.ok(Object.isFrozen(skills.profile('visual').methods));
});

test('unknown profiles and unsupported prompt phases fail before model dispatch', () => {
  for (const kind of ['invented', '__proto__', 'constructor']) assert.throws(() => skills.profile(kind), { code: 'QUALITY_AGENT_SKILL_INVALID' });
  assert.throws(() => skills.instructionBlock('web', { phase: 'execute unapproved tool' }), { code: 'QUALITY_AGENT_SKILL_PHASE_INVALID' });
});
