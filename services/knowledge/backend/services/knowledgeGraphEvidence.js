// Offsets always address Unicode codepoints in the immutable source chunk.
// Disjoint excerpts carry an explicit map; joining them never claims that the
// omitted source text was adjacent or that display offsets are source offsets.
const points = value => Array.from(value);
const separator = '\n[…]\n';

function validContentScope(content, scope) {
  if (typeof content !== 'string' || scope?.kind !== 'source_chunk_excerpt' || scope.offset_unit !== 'unicode_codepoint'
    || !Number.isSafeInteger(scope.source_length) || scope.source_length < 1 || !Array.isArray(scope.segments) || !scope.segments.length || scope.segments.length > 160
    || scope.segments.some(part=>!part||typeof part!=='object')
    || !Number.isSafeInteger(scope.omitted_codepoints) || scope.omitted_codepoints !== scope.source_length-scope.segments.reduce((sum,part)=>sum+part.source_end-part.source_start,0)) return false;
  const length = points(content).length;
  let sourceEnd = -1, contentEnd = -1;
  return scope.segments.every(segment => {
    const {source_start:start, source_end:end, content_start:from, content_end:to} = segment;
    if (![start,end,from,to].every(Number.isSafeInteger) || start < 0 || start < sourceEnd || end <= start || end > scope.source_length
      || from < 0 || from < contentEnd || to <= from || to > length || end - start !== to - from) return false;
    sourceEnd = end; contentEnd = to; return true;
  });
}

function compactGraphEvidence(hit, spans, context = 60) {
  const raw = points(hit.content), prior = validContentScope(hit.content, hit.content_scope) ? hit.content_scope : null;
  if(hit.content_scope&&!prior)return null;
  const sourceLength = prior?.source_length ?? raw.length;
  const available = prior?.segments || [{source_start:0, source_end:sourceLength, content_start:0, content_end:raw.length}];
  const ranges = [];
  for (const span of spans) {
    if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end <= span.start) return null;
    const segment = available.find(part => part.source_start <= span.start && part.source_end >= span.end);
    if (!segment) return null;
    ranges.push({start:Math.max(segment.source_start, span.start - context), end:Math.min(segment.source_end, span.end + context)});
  }
  ranges.sort((a,b) => a.start - b.start);
  const merged = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({...range});
  }
  if (!merged.length) return null;
  const segments = []; let content = '', offset = 0;
  for (const range of merged) {
    const segment = available.find(part => part.source_start <= range.start && part.source_end >= range.end);
    if (!segment) return null;
    if (segments.length) { content += separator; offset += points(separator).length; }
    const excerpt = raw.slice(segment.content_start + range.start - segment.source_start, segment.content_start + range.end - segment.source_start).join('');
    segments.push({source_start:range.start, source_end:range.end, content_start:offset, content_end:offset + range.end - range.start});
    content += excerpt; offset += range.end - range.start;
  }
  return {...hit, content, content_scope:{kind:'source_chunk_excerpt', offset_unit:'unicode_codepoint', source_length:sourceLength,
    segments, omitted_codepoints:sourceLength - segments.reduce((sum,part) => sum + part.source_end - part.source_start, 0)}};
}

function witnessVisible(hit, span) {
  if(span?.offset_basis!=='source_chunk'||span.offset_unit!=='unicode_codepoint'
    ||!Number.isSafeInteger(span.start)||!Number.isSafeInteger(span.end)||span.start<0||span.end<=span.start)return false;
  if(validContentScope(hit.content,hit.content_scope))return hit.content_scope.segments.some(part=>part.source_start<=span.start&&part.source_end>=span.end);
  // A deduplicating retriever may retain the unchanged full chunk rather than
  // its graph excerpt. Admit it only with exact immutable content identity.
  return !hit.content_scope&&typeof hit.content==='string'&&/^[a-f0-9]{64}$/.test(hit.integrity?.chunk_hash||'')
    &&hit.integrity.evidence_hash===hit.integrity.chunk_hash&&span.end<=points(hit.content).length;
}

module.exports = {compactGraphEvidence, validContentScope, witnessVisible};
