"use strict";

// Follow-up questions ("and its failed cases?", "what about those?") carry their
// subject in an earlier turn. Until now a follow-up carried message text only, and
// the helper that resolved such references was exported but never called, so
// resolution depended entirely on an optional planning model.

const { extractIdentifiers } = require("./knowledgeLexicalQuery");

const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The question, plus (for a short question that leans on an earlier one) the
 * question joined to the user's previous question so retrieval can find its
 * subject. At most two queries.
 */
const buildSeedQueries = (question, history = []) => {
  const current = clean(question, 4_000);
  const queries = current ? [current] : [];
  const lastUserMessage = [...(Array.isArray(history) ? history : [])].reverse().find((message) => message?.role === "user" && clean(message.content, 2_000));
  const wordCount = current.split(/\s+/).filter(Boolean).length;
  const looksLikeFollowUp = wordCount <= 20
    && /^(?:and|also|then|so|what about|how about|why|which|where|when)|\b(?:it|its|that|those|them|this|these|same)\b/i.test(current);
  if (lastUserMessage && looksLikeFollowUp) {
    queries.push(clean(`Previous project question: ${lastUserMessage.content}\nCurrent follow-up: ${current}`, 4_000));
  }
  return [...new Map(queries.filter(Boolean).map((query) => [query.toLowerCase(), query])).values()].slice(0, 2);
};

/** Whether the question probably refers back to an earlier turn. */
const isFollowUp = (question, history = []) => buildSeedQueries(question, history).length > 1;

/**
 * Entities (display IDs such as STORY-12) named in the most recent turns, newest
 * first. A follow-up that names nothing itself inherits these as graph anchors.
 */
const recentIdentifiers = (history = [], { turns = 4, limit = 3 } = {}) => {
  const recent = (Array.isArray(history) ? history : []).slice(-turns).reverse();
  const found = [];
  for (const message of recent) {
    for (const identifier of extractIdentifiers(clean(message?.content, 2_000), limit)) if (!found.includes(identifier)) found.push(identifier);
    if (found.length >= limit) break;
  }
  return found.slice(0, limit);
};

module.exports = { buildSeedQueries, isFollowUp, recentIdentifiers };
