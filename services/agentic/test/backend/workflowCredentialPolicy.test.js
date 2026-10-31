const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../../backend/workflows/workflowCredentialPolicy');

test('legacy workflow and exported node credentials are removed from read snapshots without altering managed references', () => {
 const workflow = { settings: { processing_mode: 'sequential', agenticCredentials: [{ id: 'legacy-id', name: 'Old connection', secret: 'plaintext', secretPreview: 'private-preview', password: 'password', privateUnknownField: 'private-value' }] }, nodes: [{ id: 'http', data: { kind: 'apiTool', connectionId: 'managed-id', apiAuth: 'Bearer plaintext', credential: { secret: 'private' }, apiBody: '{"title":"Release"}' } }], n8n_payload: { nodes: [{ parameters: { connectionId: 'managed-id', credentials: { password: 'plaintext' } } }] } };
 const safe = policy.safeDefinition(workflow);
 assert.deepEqual(safe.settings.agenticCredentials, [{ id: 'legacy-id', name: 'Old connection' }]);
 assert.equal(safe.nodes[0].data.connectionId, 'managed-id');
 assert.equal(safe.nodes[0].data.apiBody, '{"title":"Release"}');
 assert.equal(safe.n8n_payload.nodes[0].parameters.connectionId, 'managed-id');
 assert.doesNotMatch(JSON.stringify(safe), /plaintext|private|password|apiAuth/);
 assert.equal(workflow.settings.agenticCredentials[0].secret, 'plaintext', 'Read sanitization must not mutate shared persisted objects.');
 assert.equal(workflow.nodes[0].data.apiAuth, 'Bearer plaintext');
});

test('saving or executing inline credential material is rejected before persistence or dispatch', () => {
 for (const workflow of [
  { settings: { agenticCredentials: [{ secretPreview: 'private' }] } },
  { settings: { agenticCredentials: [{ refresh_token: 'private' }] } },
  { nodes: [{ data: { apiAuth: 'Bearer private' } }] },
  { nodes: [{ data: { credential: { secret: 'private' } } }] },
  { n8n_payload: { nodes: [{ parameters: { credentials: { token: 'private' } } }] } }
 ]) assert.throws(() => policy.assertDefinition(workflow), { code: 'WORKFLOW_INLINE_CREDENTIAL', statusCode: 400 });
 assert.doesNotThrow(() => policy.assertDefinition({ settings: { agenticCredentials: [{ id: 'legacy', secret: '' }] }, nodes: [{ data: { connectionId: 'managed-id', automationCredentialId: 'managed-browser', apiAuth: '' } }] }));
});
