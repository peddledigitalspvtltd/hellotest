const test = require("node:test");
const assert = require("node:assert/strict");
const evaluation = require("../support/knowledgeRetrievalEvaluation");
const golden = require("../golden/retrieval.golden.json");
const launchpadCurated = require("../golden/retrieval.launchpad-curated.json");

const rel = (map) => new Map(Object.entries(map));

test("recall, precision and reciprocal rank are computed on distinct sources", () => {
  const relevant = rel({ a: 3, b: 1 });
  assert.equal(evaluation.recallAtK(["x", "a", "y", "b"], relevant, 2), 0.5);
  assert.equal(evaluation.recallAtK(["x", "a", "y", "b"], relevant, 4), 1);
  assert.equal(evaluation.recallAtK(["x"], new Map(), 5), null, "a question with nothing relevant has no recall");
  assert.equal(evaluation.reciprocalRank(["x", "y", "a"], relevant), 1 / 3);
  assert.equal(evaluation.reciprocalRank(["x", "y"], relevant), 0);
  assert.equal(evaluation.precisionAtK(["a", "x", "b", "y", "z"], relevant, 5), 0.4);
});

test("nDCG rewards putting the highest-graded source first and ignores repeats", () => {
  const relevant = rel({ best: 3, related: 1 });
  const ideal = evaluation.ndcgAtK(["best", "related"], relevant, 10);
  const swapped = evaluation.ndcgAtK(["related", "best"], relevant, 10);
  assert.equal(Number(ideal.toFixed(9)), 1);
  assert.ok(swapped < ideal);
  assert.equal(evaluation.ndcgAtK(["best", "best"], relevant, 10), evaluation.ndcgAtK(["best"], relevant, 10), "a repeated source earns its gain once");
  assert.equal(evaluation.ndcgAtK(["x", "y"], relevant, 10), 0);
});

test("citation precision is the share of cited sources that were relevant", () => {
  assert.equal(evaluation.citationPrecision(["a", "x", "a"], rel({ a: 3 })), 0.5);
  assert.equal(evaluation.citationPrecision([], rel({ a: 3 })), null);
});

test("answer faithfulness uses only explicitly reviewed claims", () => {
  assert.equal(evaluation.answerFaithfulness([{ supported: true }, { supported: false }, { text: "unreviewed" }]), 0.5);
  assert.equal(evaluation.answerFaithfulness([{ supported: true }]), 1);
  assert.equal(evaluation.answerFaithfulness([{ text: "a citation alone is not a judgment" }]), null);
});

test("evaluate reports overall and per-class results and names the questions it missed", async () => {
  const set = { questions: [
    { id: "q1", class: "natural", question: "one", relevant: { a: 3 } },
    { id: "q2", class: "natural", question: "two", relevant: { b: 3 } },
    { id: "q3", class: "short", question: "three", relevant: { c: 2 } }
  ] };
  const answers = { one: ["a", "x"], two: ["x", "y"], three: ["z", "c"] };
  const report = await evaluation.evaluate({ golden: set, search: async (text) => answers[text], k: 2 });
  assert.equal(report.overall.questions, 3);
  assert.equal(report.overall.recall_at_2, 0.6667);
  assert.deepEqual(report.overall.missed, ["q2"]);
  assert.equal(report.by_class.natural.recall_at_2, 0.5);
  assert.equal(report.by_class.short.mrr, 0.5);
  assert.match(evaluation.formatReport(report), /missed: q2/);
});

test("evaluate can collect answer citations and reviewed claims without inferring faithfulness", async () => {
  const set = { questions: [
    { id: "q1", class: "natural", question: "one", relevant: { a: 3 } },
    { id: "q2", class: "natural", question: "two", relevant: { b: 3 } }
  ] };
  const report = await evaluation.evaluate({
    golden: set,
    search: async (text) => ({ retrieved: text === "one" ? ["a", "x"] : ["b"], answer: { cited_source_keys: text === "one" ? ["a", "x"] : ["b"], claims: text === "one" ? [{ supported: true }, { supported: false }] : [{ text: "not reviewed" }] } }),
    k: 2
  });
  assert.equal(report.overall.citation_questions, 2);
  assert.equal(report.overall.citation_precision, 0.75);
  assert.equal(report.overall.reviewed_answers, 1);
  assert.equal(report.overall.answer_faithfulness, 0.5);
  assert.equal(report.scores[1].answer_faithfulness, null);
  assert.match(evaluation.formatReport(report), /faithfulness 0.5/);
});

test("floors name every metric that regressed", () => {
  const report = { overall: { recall_at_10: 0.5, mrr: 0.9 } };
  assert.deepEqual(evaluation.checkFloors(report, { mrr: 0.8 }), []);
  assert.deepEqual(evaluation.checkFloors(report, { recall_at_10: 0.9, mrr: 0.95 }), ["recall_at_10 0.5 is below the floor 0.9", "mrr 0.9 is below the floor 0.95"]);
  assert.equal(evaluation.checkFloors(report, { missing_metric: 0.1 }).length, 1);
});

test("quality gates report overall and per-class regressions", () => {
  const report = { overall: { recall_at_10: 0.8 }, by_class: { triage: { recall_at_10: 0.7 } } };
  assert.deepEqual(evaluation.checkFloors(report, { recall_at_10: 0.75 }, { triage: { recall_at_10: 0.9 } }),
    ["class triage recall_at_10 0.7 is below the floor 0.9"]);
});

test("filler is deterministic, bounded and reuses the vocabulary that floods OR queries", () => {
  const first = evaluation.generateFiller({ count: 5, seed: 7 }), again = evaluation.generateFiller({ count: 5, seed: 7 });
  assert.deepEqual(first, again);
  assert.notDeepEqual(first, evaluation.generateFiller({ count: 5, seed: 8 }));
  assert.equal(evaluation.generateFiller({ count: 999_999 }).length, 5_000);
  assert.ok(first.every((doc) => /\b(?:test|case|run|story|release|defect)\b/.test(doc.content)));
});

test("a golden set is validated before it is trusted", () => {
  assert.throws(() => evaluation.loadGolden({ corpus: [{ key: "a" }, { key: "a" }], questions: [] }), /unique/);
  assert.throws(() => evaluation.loadGolden({ corpus: [{ key: "a" }], questions: [{ id: "q", question: "x", relevant: { b: 1 } }] }), /unknown corpus keys/);
  assert.throws(() => evaluation.loadGolden({ corpus: [{ key: "a" }], questions: [{ id: "q", question: "x", relevant: { a: 0 } }] }), /no relevant source/);
  assert.throws(() => evaluation.loadGolden({}), /corpus and questions/);
});

test("the bundled golden set is well formed, varied and sized for a meaningful recall@10", () => {
  const loaded = evaluation.loadGolden(golden);
  assert.ok(loaded.corpus.length >= 3_000, "enough filler that recall@10 over the corpus is not trivial");
  assert.ok(golden.questions.length >= 30);
  assert.deepEqual([...new Set(golden.questions.map((item) => item.class))].sort(), ["distractor", "identifier", "natural", "short", "stemming", "title"]);
  assert.match(golden.description, /SYNTHETIC/, "the seed set says plainly that it is not real traffic");
});

test("the Launchpad project benchmark is curated, source-labelled and never presented as real traffic", () => {
  const loaded = evaluation.loadGolden(launchpadCurated);
  assert.equal(launchpadCurated.provenance.real_traffic, false);
  assert.equal(launchpadCurated.provenance.question_origin, "authored_project_based");
  assert.match(launchpadCurated.description, /not historical user traffic/i);
  assert.equal(launchpadCurated.questions.length, 120);
  assert.equal(loaded.corpus.length, 317);
  assert.deepEqual([...new Set(launchpadCurated.questions.map(item => item.class))].sort(),
    ["story_behavior", "symptom", "test_behavior", "traceability", "triage"]);
  const corpusKeys = new Set(launchpadCurated.corpus.map(doc => doc.key));
  for (const question of launchpadCurated.questions) {
    assert.ok(question.class, `${question.id} has a class`);
    assert.ok(Object.values(question.relevant).some(grade => grade === 3), `${question.id} has a direct answer source`);
    for (const [source, grade] of Object.entries(question.relevant)) {
      assert.ok(corpusKeys.has(source), `${question.id} references ${source}`);
      assert.ok([1, 2, 3].includes(grade), `${question.id} uses a valid source grade`);
    }
  }
  assert.equal(launchpadCurated.corpus.find(doc => doc.key === "bug:sample-v6-ht-defect-answer").display_id, "HT6-B4");
  assert.equal(launchpadCurated.corpus.find(doc => doc.key === "test_case:sample-v6-ht-case-assistant").display_id, "HT6-T5");
  assert.equal(launchpadCurated.questions.filter(question => question.class === "traceability" && Object.keys(question.relevant).length === 1
    && Object.keys(question.relevant)[0].startsWith("bug:")).length, 27);
  assert.match(launchpadCurated.description, /answer claims have not been reviewed/i);
});
