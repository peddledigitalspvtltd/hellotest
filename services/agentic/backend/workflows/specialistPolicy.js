const profiles = require("../../shared/workflowSpecialists.json");
const tools = new Set(["project_evidence", "knowledge_search"]);
const scopes = new Set(["stories", "test-cases", "runs", "bugs", "automation", "knowledge"]);
const fail = message => Object.assign(new Error(message), { statusCode: 422, publicMessage: message });
function policy(data = {}) {
  const profile = profiles[data.agentId] || profiles["quality-evaluator"];
  const configuredSkills = data.skills === undefined ? profile.skills : data.skills;
  if (!Array.isArray(configuredSkills) || configuredSkills.length > 8 || configuredSkills.some(skill => !skill || typeof skill.id !== "string" || !skill.id.trim() || typeof skill.name !== "string" || !skill.name.trim() || skill.name.length > 160 || typeof skill.instructions !== "string" || !skill.instructions.trim() || skill.instructions.length > 5000 || (skill.enabled !== undefined && typeof skill.enabled !== "boolean"))) throw fail("Choose up to eight named skills with instructions (up to 5,000 characters per skill).");
  if (new Set(configuredSkills.map(skill => skill.id)).size !== configuredSkills.length) throw fail("Each selected skill must be unique.");
  const skills = configuredSkills.filter(skill => skill.enabled !== false);
  const allowedTools = data.allowedTools === undefined ? profile.allowedTools : data.allowedTools;
  if (!Array.isArray(allowedTools) || allowedTools.some(tool => !tools.has(tool))) throw fail("Choose supported specialist tools: Project evidence or Knowledge search.");
  const aliases = { requirements: "stories", "test-runs": "runs", "object-repository": "automation" };
  const selectedScopes = data.knowledgeScope === undefined ? profile.scopes : String(data.knowledgeScope).split(",").map(scope => aliases[scope.trim()] || scope.trim()).filter(Boolean);
  if (selectedScopes.some(scope => !scopes.has(scope))) throw fail("Choose supported evidence scopes: stories, test-cases, runs, bugs, automation, knowledge.");
  const guardrails = String(data.guardrails || "");
  const context = String(data.contextInstructions || "");
  const guidance = [data.prompt || data.intent || "", data.instructions || "", ...skills.map(skill => `${skill.name}: ${skill.instructions}`), guardrails];
  if (guidance.join("\n").length > 5000 || context.length > 4000) throw fail("Keep task, instructions, skills and guardrails within 5,000 characters, and context within 4,000 characters.");
  return { skills, allowed_tools: [...new Set(allowedTools)], context_scopes: [...new Set(selectedScopes)], guardrails, context };
}
module.exports = { policy, profiles };
