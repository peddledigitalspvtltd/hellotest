const policy = require('../../shared/authPolicy.json');

const invalid = message => Object.assign(new Error(message), { statusCode: 400, code: 'AUTH_INPUT_INVALID' });
function validateEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || !new RegExp(policy.emailPattern).test(value.trim())) {
    throw invalid('Please enter a valid email address.');
  }
  return value.trim().toLowerCase();
}
function validateNewPassword(value) {
  if (typeof value !== 'string' || value.length < policy.newPasswordMinLength) {
    throw invalid(`Password must be at least ${policy.newPasswordMinLength} characters.`);
  }
  if (value.length > policy.passwordMaxLength) throw invalid(`Password must be no more than ${policy.passwordMaxLength} characters.`);
  return value;
}
module.exports = { policy, validateEmail, validateNewPassword };
