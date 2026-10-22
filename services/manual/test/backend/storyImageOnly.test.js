const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');

process.env.NODE_ENV = 'test';

const catalog = require('../../../platform/shared/aiFeatureCatalog.json');
const profiles = new Map(catalog.map(profile => [profile.id, profile.defaults]));
const integration = {
  id: 'vision-model', name: 'Vision fixture', type: 'llm', is_active: true,
  model: 'vision-fixture', base_url: 'https://provider.invalid/v1'
};
const screenshot = {
  name: 'Sign-in.png',
  url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
};

function expandInstructions(text) {
  return String(text).replace(/⟦HELLOTEST_AI:([^:⟧]+):([^⟧]+)⟧/g, (_, feature, key) => {
    const instruction = profiles.get(feature)?.instruction_blocks?.[key];
    assert.equal(typeof instruction, 'string', `Missing configured instruction ${feature}:${key}`);
    return instruction;
  });
}

function userText(body) {
  const content = body.messages.find(message => message.role === 'user').content;
  return expandInstructions(Array.isArray(content) ? content.filter(part => part.type === 'text').map(part => part.text).join('\n') : content);
}

function fixture(reply) {
  const calls = [];
  let knowledgeCalls = 0;
  const overrides = {
    db: { prepare: () => ({}) },
    'aiLlmSelection.service': { resolveLlmIntegrationForUsage: async () => integration },
    'aiKnowledge.service': { buildKnowledgeContextPackage: async () => { knowledgeCalls++; return { knowledge: [] }; } },
    llmHttpClient: {
      fetchLlmWithRetry: async (url, options, policy) => {
        const call = { url, body: JSON.parse(options.body), policy };
        calls.push(call);
        const result = typeof reply === 'function' ? await reply(call) : reply;
        if (result instanceof Error) throw result;
        if (result instanceof Response) return result;
        return new Response(JSON.stringify({ choices: [{ message: { content: typeof result === 'string' ? result : JSON.stringify(result) } }] }));
      }
    }
  };
  const filename = path.resolve(__dirname, '../../backend/services/requirement.service.js');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(id => {
    const identity = path.basename(id).replace(/\.js$/, '');
    return Object.hasOwn(overrides, identity) ? overrides[identity] : localRequire(id);
  }, module, module.exports);
  return { service: module.exports, calls, get knowledgeCalls() { return knowledgeCalls; } };
}

function imageDraft(call, overrides = {}) {
  const ref = userText(call.body).match(/"ref":"(reference-image:[a-f0-9]+)"/)?.[1];
  assert.ok(ref, 'The prompt must expose the exact permitted image citation');
  return { requirements: [{
    title: 'Sign in with an email and password',
    description: 'A user can enter an email and password in the supplied sign-in screen.',
    priority: 3, status: 'open', acceptance_criteria: ['The sign-in screen provides email and password inputs.'],
    evidence_refs: [ref], field_evidence: { title: [ref], description: [ref], acceptance_criteria: [ref] },
    ...overrides
  }] };
}

test('image-only Story creation sends actual image content and accepts its exact field evidence', async () => {
  const f = fixture(imageDraft);
  const result = await f.service.previewRequirementCreation({ project_id: 'project', images: [screenshot], max_requirements: 1 });

  assert.equal(f.calls.length, 1);
  assert.equal(f.knowledgeCalls, 0, 'An absent written brief must not trigger an unrelated knowledge search');
  assert.equal(result.generated, 1);
  assert.equal(result.fallback_used, false);
  assert.equal(result.preview_only, true);
  assert.match(f.calls[0].body.messages[0].content, /^⟦HELLOTEST_AI:ai\.requirement\.creation:/, 'Story creation must use its own Admin instructions');
  const imageEvidence = result.evidence.find(item => item.type === 'reference-image');
  assert.equal(imageEvidence.citation_allowed, true);
  assert.deepEqual(result.requirements[0].field_evidence.title, [imageEvidence.ref]);
  assert.deepEqual(result.requirements[0].field_evidence.description, [imageEvidence.ref]);
  assert.deepEqual(result.requirements[0].evidence_refs, [imageEvidence.ref]);

  const content = f.calls[0].body.messages.find(message => message.role === 'user').content;
  assert.ok(Array.isArray(content));
  assert.deepEqual(content.filter(part => part.type === 'image_url'), [{ type: 'image_url', image_url: { url: screenshot.url, detail: 'low' } }]);
  const prompt = userText(f.calls[0].body);
  const fallbackPrompt = expandInstructions(f.calls[0].policy.contextFallbackContent);
  const imageGuidance = profiles.get('ai.requirement.creation').instruction_blocks['requirement.imageOnlyContext'];
  assert.equal(typeof imageGuidance, 'string');
  for (const text of [prompt, fallbackPrompt]) {
    assert.ok(text.includes(imageGuidance), 'Both full and reduced prompts must support images without a written brief');
    assert.doesNotMatch(text, /Return an empty requirements array instead of inventing a Story\./);
    assert.doesNotMatch(text, /data:image\//, 'Image bytes belong in vision content, not prompt text');
  }
});

test('the configured Story creation example is valid JSON with one complete requirement', async () => {
  const f = fixture(imageDraft);
  await f.service.previewRequirementCreation({ project_id: 'project', images: [screenshot] });
  const prompt = userText(f.calls[0].body);
  const example = prompt.match(/(?:^|\n)(\{[\s\S]*?\n\})(?=\n)/)?.[1];
  assert.ok(example, 'A complete example object must be included in the prompt');
  const parsed = JSON.parse(example);
  assert.equal(parsed.requirements.length, 1);
  assert.equal(typeof parsed.requirements[0].title, 'string');
  assert.equal(typeof parsed.requirements[0].description, 'string');
  assert.ok(Array.isArray(parsed.requirements[0].acceptance_criteria));
  assert.ok(Array.isArray(parsed.requirements[0].evidence_refs));
  assert.ok(parsed.requirements[0].field_evidence);
});

for (const [name, reply] of [
  ['empty output', { requirements: [] }],
  ['forged image citations', call => imageDraft(call, { evidence_refs: ['reference-image:forged'], field_evidence: { title: ['reference-image:forged'], description: ['reference-image:forged'] } })]
]) {
  test(`image-only Story creation rejects ${name} with useful guidance and no fabricated fallback`, async () => {
    const f = fixture(reply);
    await assert.rejects(f.service.previewRequirementCreation({ project_id: 'project', images: [screenshot] }), error => {
      assert.equal(error.code, 'AI_STORY_EVIDENCE_REQUIRED');
      assert.equal(error.statusCode, 422);
      assert.match(error.publicMessage || error.message, /image|screenshot|brief|outcome/i);
      assert.doesNotMatch(error.message, /Retry or select another configured LLM\.$/);
      return true;
    });
    assert.equal(f.calls.length, 1);
  });
}

for (const [name, reply] of [['invalid JSON', '{PRIVATE_MALFORMED_RESPONSE'], ['missing draft array', { message: 'PRIVATE_MALFORMED_RESPONSE' }]]) {
  test(`Story creation classifies ${name} without exposing raw provider output`, async () => {
    const f = fixture(reply);
    await assert.rejects(f.service.previewRequirementCreation({ project_id: 'project', images: [screenshot] }), error => {
      assert.equal(error.code, 'AI_STORY_RESPONSE_INVALID');
      assert.equal(error.statusCode, 502);
      assert.doesNotMatch(error.publicMessage || error.message, /PRIVATE_MALFORMED_RESPONSE/);
      return true;
    });
    assert.equal(f.calls.length, 1);
  });
}

test('Story creation does not invent a Story without image or written product evidence', async () => {
  const f = fixture({ requirements: [] });
  await assert.rejects(f.service.previewRequirementCreation({ project_id: 'project' }), error => {
    assert.equal(error.code, 'AI_STORY_EVIDENCE_REQUIRED');
    assert.equal(error.statusCode, 422);
    return true;
  });
  assert.equal(f.calls.length, 0, 'Missing product evidence must be explained before spending a model request');
});

for (const [status, detail, code, expectedStatus] of [
  [401, '{"error":{"message":"PRIVATE_PROVIDER_DETAIL"}}', 'LLM_AUTHENTICATION_FAILED', 502],
  [429, '{"error":{"code":"insufficient_quota","message":"PRIVATE_PROVIDER_DETAIL"}}', 'LLM_QUOTA_EXCEEDED', 429],
  [413, '{"error":{"message":"PRIVATE_PROVIDER_DETAIL"}}', 'LLM_REQUEST_TOO_LARGE', 413]
]) {
  test(`Story creation preserves classified provider error ${code}`, async () => {
    const f = fixture(new Response(detail, { status }));
    await assert.rejects(f.service.previewRequirementCreation({ project_id: 'project', images: [screenshot] }), error => {
      assert.equal(error.code, code);
      assert.equal(error.statusCode, expectedStatus);
      assert.doesNotMatch(error.publicMessage || error.message, /PRIVATE_PROVIDER_DETAIL/);
      return true;
    });
    assert.equal(f.calls.length, 1);
  });
}

test('Story creation preserves the vision-support error without substituting a text-only request', async () => {
  const f = fixture(Object.assign(new Error('Select a vision-capable integration.'), { code: 'AI_VISION_UNSUPPORTED', statusCode: 422 }));
  await assert.rejects(f.service.previewRequirementCreation({ project_id: 'project', images: [screenshot] }), { code: 'AI_VISION_UNSUPPORTED', statusCode: 422 });
  assert.equal(f.calls.length, 1);
});

test('an empty result rejected by the shared native contract retains image-specific guidance', async () => {
  const f = fixture(Object.assign(new Error('The model omitted required artifact fields.'), { code:'AI_NATIVE_CONTRACT_INVALID', statusCode:502, validation_errors:[{field:'requirements',issue:'required_or_invalid'}] }));
  await assert.rejects(f.service.previewRequirementCreation({project_id:'project',images:[screenshot]}), {code:'AI_STORY_EVIDENCE_REQUIRED',statusCode:422});
});

test('durable Story jobs receive only the sanitized public error message', async () => {
  const f = fixture(Object.assign(new Error('PRIVATE_PROVIDER_DETAIL'), {publicMessage:'The configured model request timed out. Please retry.',code:'UPSTREAM_TIMEOUT',statusCode:504}));
  await assert.rejects(f.service.previewRequirementCreation({project_id:'project',images:[screenshot]}), error=>{
    assert.equal(error.message,error.publicMessage);assert.equal(error.code,'UPSTREAM_TIMEOUT');assert.doesNotMatch(error.message,/PRIVATE_PROVIDER_DETAIL/);return true;
  });
});
