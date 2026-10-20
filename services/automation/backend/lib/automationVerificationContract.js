const { createHash } = require('node:crypto');
const fingerprint = sections => createHash('sha256').update(JSON.stringify(sections.map(section => ({ step_id: section.step_id, automation_code: section.automation_code, action: section.action || '', expected_result: section.expected_result || '', step_type: section.step_type || 'web', step_order: section.step_order ?? null, group_id: section.group_id ?? null, group_kind: section.group_kind ?? null, group_name: section.group_name ?? null, reusable_group_id: section.reusable_group_id ?? null })))).digest('hex');
const verificationFailure = (code, message) => Object.assign(new Error(message), { code, statusCode: 422, nonRetryable: true });
const isVerificationRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isInteractiveOperation = operation => !['browser_navigate', 'browser_assert'].includes(operation.name);
module.exports = { fingerprint, verificationFailure, isVerificationRecord, isInteractiveOperation };
