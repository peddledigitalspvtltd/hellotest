"use strict";

// Pure construction of the lexical (full-text) channel for hybrid search.
//
// Why this exists: the original query ranked every chunk in scope with
// `ts_rank_cd(search_vector, plainto_tsquery('simple', <question>))` and had no
// match predicate. `plainto_tsquery` ANDs every word, so a sentence-length
// question matched nothing, every rank was 0, ties fell back to "newest first",
// and no GIN index could be used. The functions below build an OR query over
// extracted key terms (each term is its own `plainto_tsquery`, so identifiers
// such as STORY-12 stay an exact unit and user text can never inject tsquery
// syntax) and expose a match predicate that the GIN indexes can serve.

// Search-vector label weights (PostgreSQL order is {D, C, B, A}).
//   A = document title, B = section headings, C = chunk body,
//   D = model-written hint and legacy unweighted vectors.
const RANK_WEIGHTS = "{0.3,0.4,0.7,1.0}";
// Bump when the way vectors are composed changes; the reindex job upgrades rows
// whose lexical_version is lower. Rows written before weighting are version 0.
const LEXICAL_VERSION = 2;
// ts_rank_cd normalisation 32 = rank / (rank + 1): bounded to (0, 1).
const RANK_NORMALIZATION = 32;
const MAX_TERMS = 12;
const FALLBACK_TERMS_WHEN_ALL_COMMON = 2;
// A lexeme present in at least this share of chunks carries almost no signal.
const COMMON_LEXEME_FREQUENCY = 0.3;

const SUPPORTED_CONFIGS = Object.freeze(["simple", "english", "german", "french", "spanish", "italian", "portuguese", "dutch", "swedish", "norwegian", "danish", "finnish", "russian", "turkish"]);

const STOP_WORDS = new Set((
  // Function words.
  "a about above after again against all also am an and any are aren as at be because been before being below between both but by can cannot could did do does doing don down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours "
  // Command/question framing that never appears in the answer text.
  + "please tell show give list find explain describe summarize summarise want need know tellme let get got make made using use used like etc eg ie vs versus per via within without whether "
  // Artifacts of the retrieval-text prefix added at ingestion time.
  + "document section path content type untitled"
).split(/\s+/).filter(Boolean));

const IDENTIFIER_PATTERN = /\b(?:AT[_-][0-9]+|[A-Z][A-Z0-9]{1,11}(?:-[A-Z0-9]*\d[A-Z0-9]*)+|(?:BUG|TC|TS|STORY|RUN|REQ)-?[A-Z0-9_-]+|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\b/gi;
// A word, or an identifier-like run that may contain - _ . / @ between letters/digits.
const TOKEN_PATTERN = /[\p{L}\p{N}](?:[\p{L}\p{N}_.\-/@]*[\p{L}\p{N}])?/gu;

const clean = (value) => String(value ?? "").normalize("NFKC");

const extractIdentifiers = (text, limit = 10) => [...new Set((clean(text).match(IDENTIFIER_PATTERN) || [])
  .map((value) => value.toUpperCase()))].slice(0, limit);

/**
 * Pick the terms that should drive a lexical match.
 *
 * @param {string} text              the user question
 * @param {object} [options]
 * @param {Map<string,number>} [options.commonLexemes] lexeme -> share of chunks containing it
 * @param {number} [options.maxTerms]
 * @returns {{terms: string[], identifiers: string[], dropped: string[]}}
 */
const extractKeyTerms = (text, { commonLexemes = new Map(), maxTerms = MAX_TERMS, extraStopWords } = {}) => {
  const input = clean(text);
  const identifiers = extractIdentifiers(input).map((value) => value.toLowerCase());
  const identifierSet = new Set(identifiers);
  const seen = new Set();
  const candidates = [];
  for (const raw of input.match(TOKEN_PATTERN) || []) {
    const token = raw.toLowerCase().replace(/^[._\-/@]+|[._\-/@]+$/g, "");
    if (!token || seen.has(token)) continue;
    seen.add(token);
    const isIdentifier = identifierSet.has(token);
    const hasDigit = /\p{N}/u.test(token);
    // Short words are noise unless they are identifiers or carry a digit (p95, e2e, v2).
    if (!isIdentifier && token.length < 3 && !hasDigit) continue;
    if (!isIdentifier && (STOP_WORDS.has(token) || extraStopWords?.has(token))) continue;
    candidates.push({ token, isIdentifier, frequency: Number(commonLexemes.get(token) || 0), order: candidates.length });
  }
  const isCommon = (candidate) => !candidate.isIdentifier && candidate.frequency >= COMMON_LEXEME_FREQUENCY;
  let kept = candidates.filter((candidate) => !isCommon(candidate));
  // One distinctive term is a good query. Only when every word is common do we
  // keep the least common ones, so the question is never searched with nothing.
  if (!kept.length && candidates.length) {
    kept = candidates.slice().sort((left, right) => left.frequency - right.frequency || left.order - right.order)
      .slice(0, FALLBACK_TERMS_WHEN_ALL_COMMON);
  }
  // Identifiers first, then rarer and longer words (length is a cheap rarity proxy).
  const ranked = kept.slice().sort((left, right) => Number(right.isIdentifier) - Number(left.isIdentifier)
    || left.frequency - right.frequency || right.token.length - left.token.length || left.order - right.order);
  const selected = ranked.slice(0, Math.max(1, maxTerms));
  const selectedSet = new Set(selected.map((candidate) => candidate.token));
  return {
    // Preserve the author's word order for stable SQL and diagnostics.
    terms: candidates.filter((candidate) => selectedSet.has(candidate.token)).map((candidate) => candidate.token),
    identifiers: identifiers.filter((identifier) => selectedSet.has(identifier)),
    dropped: candidates.filter((candidate) => !selectedSet.has(candidate.token)).map((candidate) => candidate.token)
  };
};

/**
 * The language configuration for the stemmed prose vector. Operators can choose
 * another supported language; anything else (including "simple", which the
 * exact-token vector already covers) falls back to English.
 */
const configuredProseConfig = (env = process.env) => {
  const configured = String(env.KNOWLEDGE_LEXICAL_PROSE_CONFIG || "english").trim().toLowerCase();
  return SUPPORTED_CONFIGS.includes(configured) && configured !== "simple" ? configured : "english";
};

const assertConfig = (config) => {
  if (!SUPPORTED_CONFIGS.includes(config)) throw new Error(`Unsupported text search configuration: ${config}`);
  return config;
};

const orQuery = (terms, config) => {
  assertConfig(config);
  return {
    sql: `(${terms.map(() => `plainto_tsquery('${config}', ?)`).join(" || ")})`,
    params: terms.slice()
  };
};

/**
 * Build the SQL fragments for the lexical channel.
 *
 * `rank` is a SELECT expression yielding a value in [0, 1]. `match` is a WHERE
 * predicate that PostgreSQL can answer from the GIN indexes. `params` order is
 * `rankParams` followed by `matchParams`; callers splice each into the place
 * where its fragment appears in the final statement.
 */
const buildLexicalSql = (text, { commonLexemes, proseConfig = "english", prosePresent = true, tableAlias = "chunks", maxTerms } = {}) => {
  const { terms, identifiers, dropped } = extractKeyTerms(text, { commonLexemes, maxTerms });
  const alias = /^[a-z_][a-z0-9_]*$/i.test(tableAlias) ? tableAlias : "chunks";
  if (!terms.length) {
    // Nothing distinctive to search for (for example only stop words). Fall back
    // to the strict form, still behind a match predicate so the index is usable.
    const strict = String(clean(text)).trim().slice(0, 1_000);
    if (!strict) return { empty: true, terms, identifiers, dropped, rank: "0::real", rankParams: [], match: "FALSE", matchParams: [] };
    return {
      empty: false, fallback: "strict_and", terms, identifiers, dropped,
      rank: `ts_rank_cd('${RANK_WEIGHTS}', ${alias}.search_vector, plainto_tsquery('simple', ?), ${RANK_NORMALIZATION})`,
      rankParams: [strict],
      match: `${alias}.search_vector @@ plainto_tsquery('simple', ?)`,
      matchParams: [strict]
    };
  }
  const simple = orQuery(terms, "simple");
  const rankParts = [`ts_rank_cd('${RANK_WEIGHTS}', ${alias}.search_vector, ${simple.sql}, ${RANK_NORMALIZATION})`];
  const rankParams = [...simple.params];
  const matchParts = [`${alias}.search_vector @@ ${simple.sql}`];
  const matchParams = [...simple.params];
  if (prosePresent) {
    const prose = orQuery(terms, proseConfig);
    // The stemmed vector can be NULL for rows that predate it; NULL @@ q is not true.
    rankParts.push(`0.9 * COALESCE(ts_rank_cd('${RANK_WEIGHTS}', ${alias}.search_vector_prose, ${prose.sql}, ${RANK_NORMALIZATION}), 0)`);
    rankParams.push(...prose.params);
    matchParts.push(`${alias}.search_vector_prose @@ ${prose.sql}`);
    matchParams.push(...prose.params);
  }
  let rank = rankParts.length > 1 ? `GREATEST(${rankParts.join(", ")})` : rankParts[0];
  if (identifiers.length) {
    // An exact identifier in the question is the strongest lexical signal.
    const exact = orQuery(identifiers, "simple");
    rank = `LEAST(1.0, ${rank} + 0.5 * COALESCE(ts_rank_cd('${RANK_WEIGHTS}', ${alias}.search_vector, ${exact.sql}, ${RANK_NORMALIZATION}), 0))`;
    rankParams.push(...exact.params);
  }
  return { empty: false, fallback: null, terms, identifiers, dropped, rank, rankParams, match: `(${matchParts.join(" OR ")})`, matchParams };
};

// --- Ingestion side -------------------------------------------------------

const pathText = (chunk) => {
  const path = Array.isArray(chunk?.heading_path) ? chunk.heading_path : Array.isArray(chunk?.section_path) ? chunk.section_path : [];
  return [...new Set([...path, chunk?.heading].map((value) => clean(value).trim()).filter(Boolean))].join(" ");
};

/** Fields in label order A, B, C, D for one chunk. */
const lexicalFields = ({ title, chunk, hint } = {}) => [
  clean(title).slice(0, 1_000),
  pathText(chunk).slice(0, 2_000),
  clean(chunk?.content ?? chunk?.body).slice(0, 200_000),
  clean(hint).slice(0, 4_000)
];

/**
 * SQL expression composing a weighted vector from four bound parameters in
 * label order A, B, C, D. `config` is checked against a fixed allow-list.
 */
const weightedVectorSql = (config) => {
  assertConfig(config);
  return `(setweight(to_tsvector('${config}', ?), 'A') || setweight(to_tsvector('${config}', ?), 'B')`
    + ` || setweight(to_tsvector('${config}', ?), 'C') || setweight(to_tsvector('${config}', ?), 'D'))`;
};

/** Parameters for `weightedVectorSql` twice: the simple vector, then the prose vector. */
const vectorParams = (fields) => [...fields, ...fields];

/**
 * Parse the text form of a one-dimensional PostgreSQL array, for example
 * `{a,"b,c","say \"hi\""}`. `anyarray` columns reach node-postgres unparsed.
 */
const parsePgTextArray = (value) => {
  if (typeof value !== "string" || value.length < 2 || value[0] !== "{" || value[value.length - 1] !== "}") return [];
  const items = [];
  let current = "";
  let quoted = false;
  let wasQuoted = false;
  for (let index = 1; index < value.length - 1; index += 1) {
    const char = value[index];
    if (quoted) {
      if (char === "\\") { current += value[index + 1] ?? ""; index += 1; }
      else if (char === "\"") quoted = false;
      else current += char;
    } else if (char === "\"") { quoted = true; wasQuoted = true; }
    else if (char === ",") { items.push(wasQuoted || current !== "NULL" ? current : null); current = ""; wasQuoted = false; }
    else current += char;
  }
  if (value.length > 2) items.push(wasQuoted || current !== "NULL" ? current : null);
  return items;
};

/**
 * Parse pg_stats most_common_elems / most_common_elem_freqs for the tsvector
 * column into lexeme -> frequency. The lexeme list arrives as array text and
 * the frequency list as numbers (it has trailing summary entries we ignore).
 */
const parseLexemeStatistics = (row) => {
  const toArray = (value) => Array.isArray(value) ? value : parsePgTextArray(value);
  const lexemes = toArray(row?.most_common_elems);
  const frequencies = toArray(row?.most_common_elem_freqs);
  const result = new Map();
  lexemes.forEach((lexeme, index) => {
    const frequency = Number(frequencies[index]);
    if (lexeme && Number.isFinite(frequency)) result.set(String(lexeme).toLowerCase(), frequency);
  });
  return result;
};

module.exports = {
  COMMON_LEXEME_FREQUENCY, IDENTIFIER_PATTERN, LEXICAL_VERSION, MAX_TERMS, RANK_NORMALIZATION, RANK_WEIGHTS,
  STOP_WORDS, SUPPORTED_CONFIGS,
  buildLexicalSql, configuredProseConfig, extractIdentifiers, extractKeyTerms, lexicalFields, parseLexemeStatistics, parsePgTextArray, vectorParams, weightedVectorSql
};
