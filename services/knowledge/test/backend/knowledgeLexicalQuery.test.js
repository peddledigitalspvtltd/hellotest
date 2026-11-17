const test = require("node:test");
const assert = require("node:assert/strict");
const lexical = require("../../backend/services/knowledgeLexicalQuery");

const placeholders = (sql) => (sql.match(/\?/g) || []).length;

test("a sentence-length question is reduced to distinctive key terms", () => {
  const { terms, dropped } = lexical.extractKeyTerms("How does the checkout flow handle expired credit cards for returning customers?");
  assert.deepEqual(terms, ["checkout", "flow", "handle", "expired", "credit", "cards", "returning", "customers"]);
  assert.ok(!terms.includes("how") && !terms.includes("does") && !terms.includes("the") && !terms.includes("for"));
  assert.deepEqual(dropped, []);
});

test("exact identifiers stay whole", () => {
  const { terms, identifiers } = lexical.extractKeyTerms("What is the status of STORY-12 and TC-0045 after the release?");
  assert.deepEqual(identifiers, ["story-12", "tc-0045"]);
  assert.ok(terms.includes("story-12") && terms.includes("tc-0045"));
  assert.ok(!terms.includes("story") && !terms.includes("12"), "identifiers are not split into common fragments");
});

test("HelloTest display IDs with an alphanumeric suffix are exact identifiers", () => {
  const { terms, identifiers } = lexical.extractKeyTerms("For defect HT6-B4, which Story and Test Case are linked?");
  assert.deepEqual(identifiers, ["ht6-b4"]);
  assert.ok(terms.includes("ht6-b4"));
});

test("identifiers survive truncation when the question has more words than the term budget", () => {
  const filler = Array.from({ length: 20 }, (_, index) => `distinctive${index}word`).join(" ");
  const { terms, identifiers } = lexical.extractKeyTerms(`${filler} STORY-12`, { maxTerms: 3 });
  assert.equal(terms.length, 3);
  assert.deepEqual(identifiers, ["story-12"]);
  assert.ok(terms.includes("story-12"), "an exact identifier outranks any amount of prose");
});

test("retrieval-text artifacts and command words never become match terms", () => {
  const { terms } = lexical.extractKeyTerms("Please show the document section content about idempotency keys");
  assert.deepEqual(terms, ["idempotency", "keys"]);
});

test("short words are dropped unless they carry a digit", () => {
  const { terms } = lexical.extractKeyTerms("is p95 of a UI e2e run ok");
  assert.ok(terms.includes("p95") && terms.includes("e2e") && terms.includes("run"));
  assert.ok(!terms.includes("ui") && !terms.includes("ok") && !terms.includes("is"));
});

test("very common lexemes are dropped when a distinctive term remains", () => {
  const commonLexemes = new Map([["test", 0.8], ["case", 0.7], ["idempotency", 0.001]]);
  const { terms, dropped } = lexical.extractKeyTerms("test case idempotency", { commonLexemes });
  assert.deepEqual(terms, ["idempotency"]);
  assert.deepEqual(dropped, ["test", "case"]);
});

test("a common lexeme that is part of an identifier is never dropped", () => {
  const commonLexemes = new Map([["story-12", 0.9]]);
  const { terms } = lexical.extractKeyTerms("STORY-12 idempotency", { commonLexemes });
  assert.ok(terms.includes("story-12") && terms.includes("idempotency"));
});

test("when every word is common the two least common are kept rather than searching for nothing", () => {
  const commonLexemes = new Map([["test", 0.9], ["case", 0.8], ["run", 0.7]]);
  const { terms } = lexical.extractKeyTerms("test case run", { commonLexemes });
  assert.deepEqual(terms, ["case", "run"]);
});

test("term count is bounded", () => {
  const text = Array.from({ length: 40 }, (_, index) => `distinctive${index}word`).join(" ");
  assert.equal(lexical.extractKeyTerms(text).terms.length, lexical.MAX_TERMS);
  assert.equal(lexical.extractKeyTerms(text, { maxTerms: 4 }).terms.length, 4);
});

test("the lexical SQL has a match predicate and a bounded rank", () => {
  const built = lexical.buildLexicalSql("expired credit cards at checkout");
  assert.match(built.match, /chunks\.search_vector @@ /);
  assert.match(built.match, /chunks\.search_vector_prose @@ /);
  assert.match(built.rank, /ts_rank_cd\('\{0\.3,0\.4,0\.7,1\.0\}', chunks\.search_vector,/);
  assert.match(built.rank, /, 32\)/, "rank is normalised to (0, 1)");
  assert.equal(placeholders(built.rank), built.rankParams.length);
  assert.equal(placeholders(built.match), built.matchParams.length);
  assert.deepEqual(built.matchParams.slice(0, 4), ["expired", "credit", "cards", "checkout"]);
});

test("each term is its own plainto_tsquery so punctuation cannot inject query syntax", () => {
  const hostile = "foo' ) | !bar & (baz:*  ; DROP TABLE chunks;--";
  const built = lexical.buildLexicalSql(hostile);
  assert.ok(!built.rank.includes("DROP") && !built.match.includes("DROP") && !built.match.includes("bar"));
  assert.equal(placeholders(built.match), built.matchParams.length);
  for (const param of built.matchParams) assert.ok(typeof param === "string" && !/[|&!()':*;]/.test(param), `unsafe term ${param}`);
});

test("without the prose column only the simple vector is searched", () => {
  const built = lexical.buildLexicalSql("expired cards", { prosePresent: false });
  assert.ok(!built.match.includes("search_vector_prose") && !built.rank.includes("search_vector_prose"));
});

test("identifiers add a bounded exact-match boost", () => {
  const built = lexical.buildLexicalSql("status of STORY-12");
  assert.match(built.rank, /^LEAST\(1\.0, /);
  assert.equal(placeholders(built.rank), built.rankParams.length);
  assert.ok(built.rankParams.includes("story-12"));
});

test("a question of only stop words still gets a match predicate", () => {
  const built = lexical.buildLexicalSql("what is this");
  assert.equal(built.fallback, "strict_and");
  assert.match(built.match, /search_vector @@ plainto_tsquery\('simple', \?\)/);
  assert.equal(placeholders(built.match), built.matchParams.length);
});

test("an empty question yields a query that matches nothing instead of everything", () => {
  const built = lexical.buildLexicalSql("   ");
  assert.equal(built.empty, true);
  assert.equal(built.match, "FALSE");
});

test("unsupported text search configurations are rejected before reaching SQL", () => {
  assert.throws(() => lexical.weightedVectorSql("english'); DROP TABLE x;--"), /Unsupported text search configuration/);
  assert.throws(() => lexical.buildLexicalSql("cards", { proseConfig: "bogus" }), /Unsupported/);
});

test("ingestion fields are labelled title, headings, body, hint and parameters line up with the SQL", () => {
  const fields = lexical.lexicalFields({
    title: "Checkout spec",
    chunk: { heading: "Payments", heading_path: ["Checkout", "Payments"], content: "Reject expired cards" },
    hint: "payment failure handling"
  });
  assert.deepEqual(fields, ["Checkout spec", "Checkout Payments", "Reject expired cards", "payment failure handling"]);
  const sql = `${lexical.weightedVectorSql("simple")}, ${lexical.weightedVectorSql("english")}`;
  assert.equal(placeholders(sql), lexical.vectorParams(fields).length);
});

test("pg_stats arrays are parsed into lexeme frequencies", () => {
  // The driver delivers the lexeme list as text and the frequencies as numbers.
  const stats = lexical.parseLexemeStatistics({ most_common_elems: "{test,case,\"run\"}", most_common_elem_freqs: [0.6, 0.5, 0.4, 0.1, 0.9] });
  assert.equal(stats.get("test"), 0.6);
  assert.equal(stats.get("run"), 0.4);
  assert.equal(stats.size, 3, "trailing summary frequencies have no lexeme and are ignored");
  assert.equal(lexical.parseLexemeStatistics(null).size, 0);
});

test("PostgreSQL array text with quoting and escapes is parsed exactly", () => {
  assert.deepEqual(lexical.parsePgTextArray('{a,"b,c","say \\"hi\\"",d e}'), ["a", "b,c", 'say "hi"', "d e"]);
  assert.deepEqual(lexical.parsePgTextArray("{}"), []);
  assert.deepEqual(lexical.parsePgTextArray("{NULL,\"NULL\"}"), [null, "NULL"]);
  assert.deepEqual(lexical.parsePgTextArray("not an array"), []);
  assert.deepEqual(lexical.parsePgTextArray(undefined), []);
});
