"use strict";

// Scope gate that runs before any retrieval or model call.
//
// Two different questions are asked here and they need different tools:
//   * Is the user asking the assistant to disclose something it must never
//     disclose (prompts, credentials, personal data)? That is a security
//     boundary, so it stays a deterministic pattern check.
//   * Is the question about something other than the project? That is a
//     judgement. A phrase list alone cannot make it ("recipe for" refuses a
//     question about "a recipe for a stable regression suite", while anything
//     not on the list passes), so an off-topic phrase refuses only when the
//     question carries no sign of being about the project at all. Anything the
//     phrase list does not catch is left to the intent planner's in_scope field.

const SENSITIVE_DISCLOSURE_ACTION = /\b(?:reveal|expose|dump|print|return|extract|leak|bypass|repeat|display|list all|show(?: me)?|give(?: me)?|send(?: me)?|provide(?: me)?|tell me)\b/i;
const SENSITIVE_DISCLOSURE_TARGET = /\b(?:system prompt|developer message|hidden instructions?|chain[- ]of[- ]thought|private reasoning|api keys?|access tokens?|passwords?|secrets?|credentials?|personal data|pii|users table|user profiles?|e-?mail(?: addresses?)?|phone(?: numbers?)?|addresses?|date of birth|dob|passports?|aadhaar|aadhar|national ids?|usernames?|login ids?|ip addresses?|person names?|full names?|author names?|owner names?|reviewer names?|assignee names?|reporter names?)\b/i;
const POLICY_OR_REQUIREMENT_CONTEXT = /\b(?:policy|policies|requirement|requirements|retention|rotation|masking|redaction|encryption|handling|classification|control|controls|test|testing|acceptance criteria)\b/i;
const ACTUAL_VALUE_CONTEXT = /\b(?:actual|stored|raw|unredacted|current|real|value|values|contents?|verbatim)\b/i;

const requestsSensitiveDisclosure = (value) => {
  const text = String(value || "");
  if (!SENSITIVE_DISCLOSURE_ACTION.test(text) || !SENSITIVE_DISCLOSURE_TARGET.test(text)) return false;
  if (POLICY_OR_REQUIREMENT_CONTEXT.test(text) && !ACTUAL_VALUE_CONTEXT.test(text)) return false;
  return true;
};

const OFF_TOPIC_PHRASES = /\b(?:weather forecast|sports score|stock price|crypto price|investment advice|medical diagnosis|write malware|phishing email|celebrity gossip|recipe for|dating advice)\b/i;

// Vocabulary of the product's own domain. One of these in the question is enough
// to keep a phrase-list hit from refusing a legitimate project question.
const PROJECT_SIGNAL = /\b(?:tests?|testing|tested|regression|suites?|stor(?:y|ies)|requirements?|defects?|bugs?|runs?|releases?|sprints?|automation|automated|cases?|qa|quality|coverage|e2e|selenium|playwright|cypress|pipelines?|builds?|deploy(?:s|ed|ment|ments)?|projects?|hellotest|flaky|assertions?|locators?|selectors?|environments?|acceptance|gherkin|scenarios?|checkout|login|api|ui|backlog|kanban|jira|ticket|tickets|knowledge|repository|traceability|failing|failures?|failed)\b/i;

const hasProjectSignal = (value) => PROJECT_SIGNAL.test(String(value || ""));

// Whether free text (a question or a drafted answer) is off-topic: it uses an
// off-topic phrase and shows no sign of being about the project.
const isOutsideDomain = (value) => OFF_TOPIC_PHRASES.test(String(value || "")) && !hasProjectSignal(value);

const REFUSALS = Object.freeze({
  sensitive_disclosure: "I cannot expose credentials, personal information, hidden prompts, private reasoning, or security controls. I can help with authorized HelloTest project and quality information.",
  out_of_domain: "I can only help with HelloTest and information grounded in the selected HelloTest project."
});

/**
 * @returns {{allowed: boolean, category: null|"sensitive_disclosure"|"out_of_domain", reason: string|null}}
 */
const classifyScope = (question) => {
  const text = String(question || "");
  if (requestsSensitiveDisclosure(text)) return { allowed: false, category: "sensitive_disclosure", reason: REFUSALS.sensitive_disclosure };
  if (isOutsideDomain(text)) return { allowed: false, category: "out_of_domain", reason: REFUSALS.out_of_domain };
  return { allowed: true, category: null, reason: null };
};

// The planner may report that a question is not about the project. It can only
// tighten the gate, and only when the question shows no project signal, so a
// mistaken model verdict cannot refuse a question that is plainly about QA work.
const plannerScopeRefusal = (plan, question) => {
  if (plan?.in_scope !== false) return null;
  return hasProjectSignal(question) ? null : { allowed: false, category: "out_of_domain", reason: REFUSALS.out_of_domain };
};

module.exports = { OFF_TOPIC_PHRASES, REFUSALS, classifyScope, hasProjectSignal, isOutsideDomain, plannerScopeRefusal, requestsSensitiveDisclosure };
