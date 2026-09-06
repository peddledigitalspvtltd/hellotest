const { PRESENTATIONS } = require("./knowledgeContractSchemas.service");
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = value => Array.isArray(value) ? value : [];
const text = (value, max = 4000) => typeof value === "string" ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max) : "";
const ids = value => [...new Set(array(value).filter(item => typeof item === "string").map(item => item.trim()).filter(Boolean))];
const normalize = value => text(value, 128000).replace(/\[[A-Za-z0-9][A-Za-z0-9_.:-]*\]/g, "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "").toLowerCase();
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const supportedText = (value, evidence) => {
  const normalized = normalize(value);
  return Boolean(normalized) && evidence.some(item => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(normalized)}(?:$|[^\\p{L}\\p{N}])`, "u").test(normalize(item.content)));
};
const inlineIds = value => [...text(value, 12000).matchAll(/\[([A-Za-z0-9][A-Za-z0-9_.:-]*)\]/g)].map(match => match[1]);
function validateGroundedClaims(rawClaims, evidence, { claimVerifier, trustDeterministic = false } = {}) {
  const byId = new Map(array(evidence).map(item => [item.evidence_id, item]));
  const accepted = [];
  let rejected = 0;
  for (const [index, raw] of array(rawClaims).slice(0, 40).entries()) {
    const claim = object(raw);
    const statement = text(claim.statement || claim.text || claim.detail);
    const evidenceIds = ids(claim.evidence_ids || claim.citation_ids || claim.citations);
    if (!statement || !evidenceIds.length || evidenceIds.some(id => !byId.has(id)) || inlineIds(statement).some(id => !evidenceIds.includes(id))) {
      rejected += 1;
      continue;
    }
    const sources = evidenceIds.map(id => byId.get(id));
    let verdict;
    if (claimVerifier) {
      try {
        verdict = claimVerifier({
          statement,
          evidence_ids: evidenceIds,
          evidence: sources
        });
      }
      catch {
        verdict = false;
      }
      // Consume completed verification only; a Promise is not a verification result.
      if (verdict && typeof verdict.then === "function")
        verdict = false;
    }
    if (verdict === false) {
      rejected += 1;
      continue;
    }
    const method = trustDeterministic ? "DETERMINISTIC" : verdict === true ? "VERIFIED_ENTAILMENT" : supportedText(statement, sources) ? "EXTRACTIVE" : "CITATION_BOUND";
    const cleanStatement = statement.replace(/\[([A-Za-z0-9][A-Za-z0-9_.:-]*)\]/g, "").replace(/\s+/g, " ").trim();
    if (!cleanStatement || accepted.some(item => normalize(item.statement) === normalize(cleanStatement)))
      continue;
    accepted.push({
      claim_id: `claim_${index + 1}`,
      statement: cleanStatement,
      text: cleanStatement,
      evidence_ids: evidenceIds,
      classification: method === "CITATION_BOUND" ? "INTERPRETATION" : "SUPPORTED",
      support_method: method
    });
  }
  return {
    claims: accepted,
    rejected
  };
}
function validatePresentation(raw, packet, claims) {
  const candidate = object(raw);
  const type = candidate.recommended_type || "TEXT";
  const fallback = {
    recommended_type: "TEXT",
    structured_payload: {}
  };
  if (!PRESENTATIONS.includes(type))
    return {
      presentation: fallback,
      rejected: true
    };
  if (type === "TEXT")
    return {
      presentation: fallback,
      rejected: false
    };
  const payload = object(candidate.structured_payload);
  const evidence = new Map(array(packet.evidence).map(item => [item.evidence_id, item]));
  const claimEvidence = new Set(claims.filter(item => item.classification === "SUPPORTED").flatMap(item => item.evidence_ids));
  const sourcesFor = row => {
    const cited = ids(row.evidence_ids || (row.evidence_id ? [row.evidence_id] : []));
    return cited.length && cited.every(id => evidence.has(id) && claimEvidence.has(id)) ? cited.map(id => evidence.get(id)) : null;
  };
  const validText = (value, sources) => typeof value === "string" && value.length <= 2000 && (!value.trim() || supportedText(value, sources));
  const simpleLabel = value => typeof value === "string" && value.length > 0 && value.length <= 120 && !/[<>\u0000-\u001f]/.test(value);
  const exactKeys = (value, allowed) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
  const fail = () => ({
    presentation: fallback,
    rejected: true
  });
  let structured;
  if (type === "TABLE" || type === "COMPARISON") {
    if (!exactKeys(payload, ["columns", "rows"]) || !array(payload.columns).length || payload.columns.length > 12 || !array(payload.rows).length || payload.rows.length > 40)
      return fail();
    const columns = payload.columns;
    if (!columns.every(column => exactKeys(column, ["key", "label"]) && /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(column.key) && simpleLabel(column.label)) || new Set(columns.map(column => column.key)).size !== columns.length)
      return fail();
    const keys = columns.map(column => column.key);
    const rows = [];
    for (const row of payload.rows) {
      const sources = sourcesFor(row);
      if (!sources || !exactKeys(row, ["cells", "evidence_ids"]) || !exactKeys(row.cells, keys) || Object.keys(row.cells).length !== keys.length || !Object.values(row.cells).every(value => validText(value, sources)))
        return fail();
      rows.push({
        cells: {
          ...row.cells
        },
        evidence_ids: ids(row.evidence_ids)
      });
    }
    structured = {
      columns: columns.map(({ key, label }) => ({
        key,
        label
      })),
      rows
    };
  }
  else if (type === "TIMELINE" || type === "METRIC") {
    if (!exactKeys(payload, ["items"]) || !array(payload.items).length || payload.items.length > 40)
      return fail();
    const keys = type === "TIMELINE" ? ["date", "title", "description", "evidence_ids"] : ["label", "value", "unit", "evidence_ids"];
    for (const item of payload.items) {
      const sources = sourcesFor(item);
      if (!sources || !exactKeys(item, keys) || !keys.filter(key => key !== "evidence_ids").every(key => validText(item[key] || "", sources)))
        return fail();
      if (type === "TIMELINE" && (!item.date || !item.title) || type === "METRIC" && (!item.label || !item.value))
        return fail();
    }
    structured = {
      items: payload.items.map(item => Object.fromEntries(keys.map(key => [key, key === "evidence_ids" ? ids(item[key]) : item[key] || ""])))
    };
  }
  else if (type === "DOCUMENT_RESULTS" || type === "IMAGE_RESULTS") {
    if (!exactKeys(payload, ["items"]) || !array(payload.items).length || payload.items.length > 30)
      return fail();
    const items = [];
    for (const row of payload.items) {
      if (!exactKeys(row, ["evidence_id", "title", "url"]) || !sourcesFor(row))
        return fail();
      const source = evidence.get(row.evidence_id);
      if (type === "IMAGE_RESULTS" && !/^image\//.test(source.media_type || ""))
        return fail();
      const uri = source.uri || source.location?.uri || source.location?.url || "";
      const url = /^(?:https?:\/\/|\/[^/])/.test(uri) ? uri : undefined;
      items.push({
        evidence_id: source.evidence_id,
        title: source.title,
        ...(url ? {
          url
        } : {})
      });
    }
    structured = {
      items
    };
  }
  else if (type === "RELATIONSHIP_GRAPH") {
    if (!exactKeys(payload, ["nodes", "edges"]) || !array(payload.nodes).length || payload.nodes.length > 40 || !Array.isArray(payload.edges) || payload.edges.length > 80)
      return fail();
    const nodeIds = new Set();
    for (const node of payload.nodes) {
      const sources = sourcesFor(node);
      if (!sources || !exactKeys(node, ["id", "label", "type", "evidence_ids"]) || nodeIds.has(node.id) || !sources.some(source => [source.canonical_id, source.source_id, source.evidence_id].includes(node.id)) || !validText(node.label, sources) || !simpleLabel(node.type))
        return fail();
      nodeIds.add(node.id);
    }
    for (const edge of payload.edges) {
      if (!exactKeys(edge, ["source", "target", "type", "evidence_ids"]) || !nodeIds.has(edge.source) || !nodeIds.has(edge.target) || !sourcesFor(edge))
        return fail();
      if (!array(packet.relationship_evidence || packet.relationships).some(item => item.source === edge.source && item.target === edge.target && item.type === edge.type && ids(edge.evidence_ids).every(id => item.evidence_ids.includes(id))))
        return fail();
    }
    structured = {
      nodes: payload.nodes.map(node => ({
        ...node,
        evidence_ids: ids(node.evidence_ids)
      })),
      edges: payload.edges.map(edge => ({
        ...edge,
        evidence_ids: ids(edge.evidence_ids)
      }))
    };
  }
  return structured ? {
    presentation: {
      recommended_type: type,
      structured_payload: structured
    },
    rejected: false
  } : fail();
}
module.exports = {
  validateGroundedClaims,
  validatePresentation,
  supportedText,
  normalizeClaimText: normalize
};
