"use strict";

// End-to-end retrieval evaluation: what does SEARCH find for real questions?
//
// knowledgeEvaluation.service.js scores how well the context PACKER keeps
// evidence it was handed. That says nothing about whether retrieval found the
// right sources to begin with, which is where a lexical defect (every sentence
// question returning the newest chunks) hid unnoticed. This module measures the
// other half: it takes a golden set of questions with the sources a good answer
// must draw from, runs a search function over them, and reports recall@k, MRR,
// nDCG@k, precision@k and citation precision, overall and per question class.
//
// A golden set is JSON:
//   { "version": 1,
//     "corpus":   [{ "key": "checkout-cards", "title": "...", "content": "..." }],
//     "filler":   { "count": 200, "seed": 7 },           // optional deterministic noise
//     "questions":[{ "id": "n1", "class": "natural", "question": "...",
//                    "relevant": { "checkout-cards": 3, "refund-policy": 1 } }] }
// `relevant` maps a corpus key to a grade: 3 = the answer is in it, 2 = strongly
// supports it, 1 = related context. Any positive grade counts as relevant for
// recall; the grade weights nDCG.

const round = (value, places = 4) => Number(Number(value).toFixed(places));

const relevantMap = (question) => new Map(Object.entries(question.relevant || {}).filter(([, grade]) => Number(grade) > 0).map(([key, grade]) => [key, Number(grade)]));

/** Fraction of the relevant sources found in the top k (distinct sources). */
const recallAtK = (retrieved, relevant, k) => {
  if (!relevant.size) return null;
  const top = new Set(retrieved.slice(0, k));
  return [...relevant.keys()].filter((key) => top.has(key)).length / relevant.size;
};

/** Reciprocal rank of the first relevant source, 0 when none is retrieved. */
const reciprocalRank = (retrieved, relevant) => {
  const index = retrieved.findIndex((key) => relevant.has(key));
  return index < 0 ? 0 : 1 / (index + 1);
};

/** Fraction of the top k that is relevant. */
const precisionAtK = (retrieved, relevant, k) => {
  const top = retrieved.slice(0, k);
  return top.length ? top.filter((key) => relevant.has(key)).length / k : 0;
};

/** Graded nDCG: a grade-3 source above a grade-1 source scores higher than the reverse. */
const ndcgAtK = (retrieved, relevant, k) => {
  if (!relevant.size) return null;
  const gain = (grade) => 2 ** grade - 1;
  const seen = new Set();
  const dcg = retrieved.slice(0, k).reduce((sum, key, index) => {
    if (seen.has(key) || !relevant.has(key)) return sum;
    seen.add(key);
    return sum + gain(relevant.get(key)) / Math.log2(index + 2);
  }, 0);
  const ideal = [...relevant.values()].sort((left, right) => right - left).slice(0, k)
    .reduce((sum, grade, index) => sum + gain(grade) / Math.log2(index + 2), 0);
  return ideal ? dcg / ideal : 0;
};

/** Of the sources an answer cited, the fraction that are relevant. */
const citationPrecision = (cited, relevant) => {
  const unique = [...new Set(cited)];
  return unique.length ? unique.filter((key) => relevant.has(key)).length / unique.length : null;
};

// `supported` is the result of the answer review for one factual claim. Real
// evaluation data should be human-adjudicated or produced by the same grounded
// claim validator used by the assistant, never inferred from citation presence.
const answerFaithfulness = (claims = []) => {
  const reviewed = claims.filter((claim) => claim && typeof claim.supported === "boolean");
  return reviewed.length ? reviewed.filter((claim) => claim.supported).length / reviewed.length : null;
};

const mean = (values) => {
  const usable = values.filter((value) => value != null && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
};

const scoreQuestion = ({ retrieved, question, cited = [], claims = [], k = 10 }) => {
  const relevant = relevantMap(question);
  return {
    id: question.id, class: question.class || "unclassified",
    recall: recallAtK(retrieved, relevant, k), rr: reciprocalRank(retrieved, relevant),
    ndcg: ndcgAtK(retrieved, relevant, k), precision: precisionAtK(retrieved, relevant, Math.min(5, k)),
    citation_precision: citationPrecision(cited, relevant), answer_faithfulness: answerFaithfulness(claims),
    first_relevant_rank: (() => { const index = retrieved.findIndex((key) => relevant.has(key)); return index < 0 ? null : index + 1; })()
  };
};

const summarize = (scores, k) => ({
  questions: scores.length,
  [`recall_at_${k}`]: round(mean(scores.map((score) => score.recall))),
  mrr: round(mean(scores.map((score) => score.rr))),
  [`ndcg_at_${k}`]: round(mean(scores.map((score) => score.ndcg))),
  precision_at_5: round(mean(scores.map((score) => score.precision))),
  citation_precision: round(mean(scores.map((score) => score.citation_precision))),
  answer_faithfulness: round(mean(scores.map((score) => score.answer_faithfulness))),
  citation_questions: scores.filter((score) => score.citation_precision != null).length,
  reviewed_answers: scores.filter((score) => score.answer_faithfulness != null).length,
  found_in_top_k: scores.filter((score) => score.first_relevant_rank != null && score.first_relevant_rank <= k).length,
  missed: scores.filter((score) => score.first_relevant_rank == null || score.first_relevant_rank > k).map((score) => score.id)
});

/**
 * @param {{golden: object, search: (question: string) => Promise<string[]>, k?: number}} input
 *   `search` returns corpus keys, best first (one per distinct source).
 */
const evaluate = async ({ golden, search, answer, k = 10 }) => {
  const scores = [];
  for (const question of golden.questions) {
    const searchResult = await search(question.question, question);
    const retrievedRaw = Array.isArray(searchResult) ? searchResult : searchResult?.retrieved;
    const retrieved = [...new Set(Array.isArray(retrievedRaw) ? retrievedRaw : [])];
    const answerResult = answer ? await answer(question.question, question, retrieved, searchResult) : searchResult?.answer;
    const cited = Array.isArray(answerResult?.cited_source_keys) ? answerResult.cited_source_keys : [];
    const claims = Array.isArray(answerResult?.claims) ? answerResult.claims : [];
    scores.push(scoreQuestion({ retrieved, question, cited, claims, k }));
  }
  const classes = [...new Set(scores.map((score) => score.class))].sort();
  return { k, overall: summarize(scores, k), by_class: Object.fromEntries(classes.map((name) => [name, summarize(scores.filter((score) => score.class === name), k)])), scores };
};

/** The failure messages for every metric that falls below its floor. Empty means the gate passes. */
const checkFloors = (report, floors = {}, classFloors = {}) => {
  const check = (summary, configured, prefix = "") => Object.entries(configured).flatMap(([metric, floor]) => {
    const actual = summary?.[metric];
    return actual == null || actual < floor ? [`${prefix}${metric} ${actual} is below the floor ${floor}`] : [];
  });
  return [
    ...check(report.overall, floors),
    ...Object.entries(classFloors).flatMap(([name, configured]) => check(report.by_class?.[name], configured, `class ${name} `))
  ];
};

// --- deterministic filler -----------------------------------------------------------

// A small seeded generator (mulberry32) so a golden set is reproducible without
// storing hundreds of near-identical documents.
const random = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Filler deliberately reuses the vocabulary every QA corpus is full of ("test",
// "case", "run", "story", "release", "defect"), because that is what floods a naive
// OR query and buries the document that actually answers the question.
const FILLER_WORDS = ["test", "case", "run", "story", "release", "defect", "build", "suite", "result", "status", "update", "review", "note", "item", "task", "step", "check"];
const generateFiller = ({ count = 0, seed = 1 } = {}) => {
  const next = random(seed);
  const pick = (list) => list[Math.floor(next() * list.length)];
  return Array.from({ length: Math.max(0, Math.min(5_000, count)) }, (_, index) => ({
    key: `filler-${index + 1}`,
    title: `${pick(FILLER_WORDS)} ${pick(FILLER_WORDS)} ${index + 1}`,
    content: `The ${pick(FILLER_WORDS)} ${index + 1} for story ${Math.floor(next() * 900) + 100} had a ${pick(FILLER_WORDS)} update on the ${pick(FILLER_WORDS)} run. `
      + `Release candidate ${Math.floor(next() * 90) + 10} includes ${pick(FILLER_WORDS)} notes about the ${pick(FILLER_WORDS)} case and one ${pick(FILLER_WORDS)} review.`
  }));
};

const loadGolden = (golden) => {
  if (!golden || !Array.isArray(golden.corpus) || !Array.isArray(golden.questions)) throw new Error("A golden set needs corpus and questions arrays.");
  const keys = new Set(golden.corpus.map((doc) => doc.key));
  if (keys.size !== golden.corpus.length) throw new Error("Golden set corpus keys must be unique.");
  for (const question of golden.questions) {
    if (!question.id || !question.question) throw new Error("Every golden question needs an id and a question.");
    const missing = Object.keys(question.relevant || {}).filter((key) => !keys.has(key));
    if (missing.length) throw new Error(`Question ${question.id} refers to unknown corpus keys: ${missing.join(", ")}.`);
    if (!relevantMap(question).size) throw new Error(`Question ${question.id} has no relevant source.`);
  }
  return { ...golden, corpus: [...golden.corpus, ...generateFiller(golden.filler)] };
};

/** A readable table for CI logs and the CLI. */
const formatReport = (report, { label = "retrieval" } = {}) => {
  const k = report.k;
  const row = (name, summary) => `${name.padEnd(14)} n=${String(summary.questions).padStart(3)}  recall@${k} ${summary[`recall_at_${k}`]}  MRR ${summary.mrr}  nDCG@${k} ${summary[`ndcg_at_${k}`]}  P@5 ${summary.precision_at_5}`
    + (summary.citation_questions ? `  citation P ${summary.citation_precision}` : "")
    + (summary.reviewed_answers ? `  faithfulness ${summary.answer_faithfulness}` : "");
  return [`${label} evaluation`, row("overall", report.overall), ...Object.entries(report.by_class).map(([name, summary]) => row(name, summary)),
    ...(report.overall.missed.length ? [`missed: ${report.overall.missed.join(", ")}`] : [])].join("\n");
};

module.exports = { answerFaithfulness, checkFloors, citationPrecision, evaluate, formatReport, generateFiller, loadGolden, ndcgAtK, precisionAtK, recallAtK, reciprocalRank, scoreQuestion, summarize };
