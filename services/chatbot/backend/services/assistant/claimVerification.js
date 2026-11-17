"use strict";

// Claim verification for assistant answers.
//
// The answer contract used to validate that each claim cites retrieved evidence
// and nothing more, while the stage was announced as "validation". These checks
// say plainly what they establish.
//
//   specificsVerifier   synchronous and free. It does NOT establish that the
//                       evidence entails a claim. It rejects a claim that names
//                       an identifier or quotes text that is not in the evidence
//                       it cites (a fabricated reference) and annotates a figure
//                       the cited evidence does not contain.
//   verifyWithModel     optional second pass through the registered
//                       "Answer grounding verification" feature, which audits the
//                       draft against the evidence and removes or corrects
//                       unsupported statements. Off unless enabled, because it
//                       costs another model call.

const { IDENTIFIER_PATTERN } = require("@hellotest/knowledge/backend/services/knowledgeLexicalQuery");
const { normalizeClaimText } = require("@hellotest/knowledge/backend/services/knowledgeGrounding.service");

const squash = (value) => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
const withoutCitations = (statement) => String(statement || "").replace(/\[[A-Za-z0-9][A-Za-z0-9_.:-]*\]/g, " ");

const quotedStrings = (statement) => [...String(statement).matchAll(/"([^"\n]{3,200})"|“([^”\n]{3,200})”|`([^`\n]{3,200})`/g)]
  .map((match) => match[1] || match[2] || match[3]).filter(Boolean);
const identifiers = (statement) => [...new Set((String(statement).match(new RegExp(IDENTIFIER_PATTERN.source, "gi")) || []).map((value) => value.toLowerCase()))];
// Figures with at least two digits, or a decimal / percentage, so "step 2" is not flagged.
const figures = (statement) => [...new Set((String(statement).match(/\b\d{2,}(?:[.,]\d+)?%?|\b\d+[.,]\d+%?|\b\d+%/g) || []).map((value) => value.replace(/,/g, "")))];

/**
 * @param {{statement: string, evidence: Array<{content?: string, title?: string}>}} claim
 * @returns {false | {status: "unverified", method: string, notes?: string[]}}
 */
const specificsVerifier = ({ statement, evidence }) => {
  const corpus = squash((evidence || []).map((item) => `${item.title || ""}\n${item.content || ""}`).join("\n"));
  const text = withoutCitations(statement);
  const missingIdentifiers = identifiers(text).filter((identifier) => !corpus.includes(identifier));
  const missingQuotes = quotedStrings(text).filter((quote) => !corpus.includes(squash(quote)));
  // A reference or quotation that the cited evidence does not contain is not an
  // interpretation of it: it is invented. The claim is removed.
  if (missingIdentifiers.length || missingQuotes.length) return false;
  const notes = figures(text).filter((figure) => !corpus.replace(/,/g, "").includes(figure))
    .map((figure) => `The figure ${figure} does not appear in the cited evidence.`).slice(0, 5);
  return { status: "unverified", method: "specifics_check", ...(notes.length ? { notes } : {}) };
};

const verificationMode = (env = process.env) => String(env.KNOWLEDGE_ANSWER_VERIFICATION || "off").trim().toLowerCase() === "model" ? "model" : "off";

/**
 * Audit a drafted answer with a second model pass. Claims the auditor kept
 * (matched by normalised statement) become verified; claims it dropped are
 * removed; its corrected text replaces the draft. The result is validated by the
 * same citation contract as any model answer, so the auditor cannot cite
 * evidence that was not retrieved.
 *
 * `deps`: { requestVerification, normalizeModelAnswer }
 */
const verifyWithModel = async ({ deps, integration, question, hits, draftOutcome, projectScope, reviewedContext, contextPacket }) => {
  const draft = {
    status: draftOutcome.status,
    executive_summary: draftOutcome.answer_structure?.summary || draftOutcome.content,
    findings: draftOutcome.answer_structure?.findings || [],
    recommendations: draftOutcome.answer_structure?.recommendations || [],
    evidence_gaps: draftOutcome.answer_structure?.evidence_gaps || [],
    supported_claims: draftOutcome.answer_structure?.supported_claims || [],
    citation_ids: (draftOutcome.citations || []).map((citation) => citation.id)
  };
  const candidate = await deps.requestVerification({ integration, question, hits, draft, projectScope, reviewedContext, contextPacket });
  const audited = deps.normalizeModelAnswer(candidate, hits);
  if (audited.safety?.invented_citations_rejected || audited.safety?.citation_required) {
    throw Object.assign(new Error("The verification pass did not satisfy the evidence citation contract."), { code: "MODEL_INVALID_RESPONSE" });
  }
  const kept = new Set((audited.answer_structure?.supported_claims || []).map((claim) => normalizeClaimText(claim.statement)));
  const dropped = draft.supported_claims.filter((claim) => !kept.has(normalizeClaimText(claim.statement))).length;
  return { outcome: audited, dropped_claim_count: dropped, kept_statements: kept };
};

/** A claim verifier for buildAnswerContract that credits claims the model audit kept. */
const auditedClaimVerifier = (keptStatements, fallback = specificsVerifier) => (claim) => {
  const specifics = fallback(claim);
  if (specifics === false) return false;
  if (keptStatements?.has(normalizeClaimText(claim.statement))) return { status: "supported", method: "model_audit", ...(specifics.notes ? { notes: specifics.notes } : {}) };
  return specifics;
};

module.exports = { auditedClaimVerifier, specificsVerifier, verificationMode, verifyWithModel, _internals: { figures, identifiers, quotedStrings } };
