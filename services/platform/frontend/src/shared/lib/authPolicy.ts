import policy from '../../../../shared/authPolicy.json';
export {policy};
export const passwordPolicyHint = `At least ${policy.newPasswordMinLength} characters; up to ${policy.passwordMaxLength}.`;
export const isValidEmail = (email: string) => email.length <= 254 && new RegExp(policy.emailPattern).test(email.trim());
export function validatePasswordPair(draft: {password: string; confirmPassword: string}, required: boolean) {
  if ((required || draft.password) && draft.password.length < policy.newPasswordMinLength) return `Password must be at least ${policy.newPasswordMinLength} characters.`;
  if (draft.password.length > policy.passwordMaxLength) return `Password must be no more than ${policy.passwordMaxLength} characters.`;
  return draft.password !== draft.confirmPassword ? 'Passwords do not match.' : '';
}
