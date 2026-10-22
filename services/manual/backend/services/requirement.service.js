const { normalizeReferenceImages, imageUserContent } = require('@hellotest/platform/backend/src/utils/aiReferenceImages');
const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { requireAiAssessment } = require("@hellotest/platform/backend/src/utils/requireAiAssessment");
const db = require("@hellotest/platform/backend/src/db");
const { readBoundedResponseJson, readBoundedResponseText } = require("@hellotest/platform/backend/src/utils/boundedResponse");
const { createHash, randomUUID: uuid } = require("crypto");
const displayIdService = require("@hellotest/platform/backend/services/displayId.service");
const requirementReleaseService = require("./requirementRelease.service");
const workspaceTransactionService = require("@hellotest/platform/backend/services/workspaceTransaction.service");
const integrationService = require("@hellotest/integration/backend/services/integration.service");
const aiKnowledgeService = require("@hellotest/knowledge/backend/services/aiKnowledge.service");
const aiLlmSelectionService = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const { getOptionalEvidenceAccess } = require("@hellotest/platform/backend/services/optionalEvidenceAccess.service");
const { normalizeReferenceList: normalizeDelimitedReferenceList } = require("@hellotest/platform/backend/src/utils/externalReferences");
// JSON arrays already define item boundaries; commas and pipes inside an item are content.
const normalizeReferenceList = value => Array.isArray(value)
  ? [...new Set(value.flat().map(item => String(item || '').trim()).filter(Boolean))]
  : normalizeDelimitedReferenceList(value);
const normalizeStoredReferenceList = value => normalizeReferenceList(parseStoredJson(value, []));
const { createLlmProviderError } = require("@hellotest/platform/backend/src/utils/upstreamLlmError");
const { fetchLlmWithRetry } = require("@hellotest/platform/backend/src/utils/llmHttpClient");
const { getCompletionContent } = require("@hellotest/platform/backend/src/utils/llmResponse");
const { parseAiJson } = require("@hellotest/platform/backend/src/utils/aiJsonResponse");
const { assertExpectedRevision } = require("@hellotest/platform/backend/src/utils/revision");
const { storyAdditionalFields } = require("@hellotest/platform/backend/src/utils/storyAcceptanceCriteria");
const { normalizeStoryImportRow } = require("@hellotest/platform/backend/src/utils/storyImportRow");
const { groupRows, placeholdersFor, uniqueIds } = require("@hellotest/platform/backend/src/utils/batchHydration");
const { resilientHttpRequest } = require("@hellotest/platform/backend/src/utils/resilientHttpClient");
const { SERVICE_ERROR_CODES, serviceError } = require("@hellotest/platform/backend/src/utils/serviceErrors");
const { storyAiSnapshot, text: boundedAiText, object: aiObject } = require("@hellotest/platform/backend/src/utils/aiArtifactContext");

const selectLinkedTestCases = db.prepare(`
  SELECT test_cases.id, test_cases.title, test_cases.description, test_cases.automated, test_cases.priority, test_cases.status
  FROM requirement_test_cases
  JOIN test_cases ON test_cases.id = requirement_test_cases.test_case_id
  JOIN requirements ON requirements.id = requirement_test_cases.requirement_id
  JOIN app_types ON app_types.id = test_cases.app_type_id AND app_types.project_id = requirements.project_id
  WHERE requirement_test_cases.requirement_id = ?
  ORDER BY test_cases.title ASC
`);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const normalizeDeliveryDate = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid Story completion target date");
  parsed.setUTCHours(0, 0, 0, 0);
  return parsed.toISOString();
};

const normalizeSpecificationFormat = (value, fallback = "gherkin") => {
  const normalized = normalizeText(value) || fallback;
  if (!["gherkin", "speckit"].includes(normalized)) throw new Error("Invalid Story specification format");
  return normalized;
};

const STORY_AI_PROCESS_STAGE_IDS = ["intake", "context", "guardrails", "specialist", "outcome", "evaluation", "review"];

const compactStoryEvidenceText = (value, limit = 520) => String(value || "")
  .replace(/<[^>]*>/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, limit);

const rankStoryKnowledge = (knowledge, context, limit = 8) => {
  const stopWords = new Set(["about", "after", "before", "could", "from", "have", "into", "only", "should", "story", "their", "there", "these", "they", "this", "that", "want", "when", "where", "which", "with", "would"]);
  const tokens = [...new Set(String(context || "").toLowerCase().match(/[a-z0-9]{4,}/g) || [])]
    .filter((token) => !stopWords.has(token))
    .slice(0, 48);
  if (!tokens.length) return [];
  return (Array.isArray(knowledge) ? knowledge : [])
    .map((item, index) => {
      const haystack = `${item.title || ""} ${item.description || ""} ${item.content || ""}`.toLowerCase();
      const score = tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
      return { item, index, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ item }) => item);
};

const storyEvidenceRef = (kind, identity) => {
  const digest = createHash("sha256").update(String(identity || kind)).digest("hex").slice(0, 12);
  return `${kind}:${digest}`;
};

const storyRequestFingerprint = (input) => createHash("sha256")
  .update(JSON.stringify(input || {}))
  .digest("hex")
  .slice(0, 24);

const storyImageInputSnapshot = (images) => (Array.isArray(images) ? images : []).map((image) => ({
  name: image.name,
  type: image.type,
  content_ref: storyEvidenceRef("image-content", image.url)
}));

const normalizeStoryEvidenceRefs = (value, allowedRefs, limit = 12) => [...new Set(
  (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter((ref) => ref && allowedRefs.has(ref))
)].slice(0, limit);

const buildStoryProcessingSnapshot = ({ profile, sourceCount, outputCount, fallbackUsed = false, limitationCount = 0 }) => ({
  profile,
  active_stage_id: "review",
  completed_stage_count: 6,
  total_stage_count: STORY_AI_PROCESS_STAGE_IDS.length,
  status_label: fallbackUsed ? "Fallback result awaiting review" : "Awaiting human review",
  review_status: "awaiting_review",
  stages: [
    { id: "intake", status: "complete", detail: profile === "story-create" ? "The requested Story outcome and output count were bounded." : "The saved Story revision was captured before proposing changes.", evidence: "The request was normalized without changing saved Story data.", item_count: 1 },
    { id: "context", status: "complete", detail: `${sourceCount} bounded evidence source${sourceCount === 1 ? " was" : "s were"} prepared.`, evidence: `${sourceCount} source${sourceCount === 1 ? "" : "s"} remained inside the visible Story AI evidence catalog.`, item_count: sourceCount },
    { id: "guardrails", status: "complete", detail: "Source limits, pointer-only links, and the human approval boundary were checked.", evidence: `${limitationCount} evidence limitation${limitationCount === 1 ? " was" : "s were"} recorded for review.`, item_count: limitationCount },
    { id: "specialist", status: "complete", detail: fallbackUsed ? "The configured provider was unavailable, so only the evidence-preserving fallback was used." : "The Story Architect returned a bounded JSON proposal.", evidence: fallbackUsed ? "No unavailable source content was converted into generated product behavior." : "The configured Story AI usage produced the proposal.", item_count: outputCount },
    { id: "outcome", status: "complete", detail: `${outputCount} editable proposal${outputCount === 1 ? " was" : "s were"} normalized.`, evidence: "Unknown evidence references were removed before the response was returned.", item_count: outputCount },
    { id: "evaluation", status: "complete", detail: "Grounding, completeness, and testability were evaluated from normalized fields.", evidence: "Scores come from deterministic field checks, not model self-assessment.", item_count: outputCount },
    { id: "review", status: "current", detail: "Processing is complete; a person must accept, edit, or discard the proposal.", evidence: "No Story is created or updated by this preview response.", item_count: outputCount }
  ]
});

const buildStoryCreationEvidence = ({ additionalContext, externalLinks, images, knowledge }) => {
  const evidence = [];
  const contextExcerpt = compactStoryEvidenceText(additionalContext, 800);
  if (contextExcerpt) {
    evidence.push({
      ref: "user-guidance:story-brief",
      id: "story-brief",
      type: "user-guidance",
      title: "Story brief and packed context",
      label: "Story brief and packed context",
      excerpt: contextExcerpt,
      trust: "user-provided",
      citation_allowed: true,
      limitation: /HelloTest smart context pack/i.test(contextExcerpt)
        ? "Packed client context does not preserve the individual source identifiers of every included knowledge item."
        : null
    });
  }
  const knowledgeItems = Array.isArray(knowledge) ? knowledge : Array.isArray(knowledge?.knowledge) ? knowledge.knowledge : [];
  knowledgeItems.slice(0, 8).forEach((item) => {
    const ref = item.id ? `knowledge:${item.id}` : storyEvidenceRef("knowledge", `${item.title}:${item.content}`);
    evidence.push({
      ref,
      id: item.id || ref,
      type: "knowledge",
      title: item.title || "Project knowledge",
      label: item.title || "Project knowledge",
      excerpt: compactStoryEvidenceText(item.description || item.content),
      trust: "workspace",
      citation_allowed: true,
      limitation: null
    });
  });
  externalLinks.forEach((link) => {
    const ref = storyEvidenceRef("external-reference", link);
    evidence.push({
    ref,
    id: ref,
    type: "external-reference",
    title: link,
    label: link,
    excerpt: "External reference pointer; linked page content was not fetched.",
    url: link,
    trust: "pointer-only",
    citation_allowed: false,
    limitation: "Pointer metadata cannot support a factual Story claim until a person opens and verifies the linked content."
  });
  });
  images.forEach((image, index) => {
    const ref = storyEvidenceRef("reference-image", `${image.name}:${index}:${image.content_hash || storyEvidenceRef('image-content',image.url)}`);
    evidence.push({
    ref,
    id: ref,
    type: "reference-image",
    title: image.name,
    label: image.name,
    excerpt: "User-supplied reference image attached to this run.",
    trust: "user-provided",
    citation_allowed: true,
    limitation: null
  });
  });
  return evidence;
};

const buildStoryCompletionEvidence = ({ requirement, linkedTestCases, knowledge, additionalContext, externalLinks, images }) => {
  const evidence = [{
    ref: `story:${requirement.id}`,
    id: requirement.id,
    type: "story",
    title: requirement.display_id ? `${requirement.display_id} · ${requirement.title}` : requirement.title,
    label: requirement.display_id ? `${requirement.display_id} · ${requirement.title}` : requirement.title,
    excerpt: compactStoryEvidenceText([requirement.description || requirement.title, ...(requirement.acceptance_criteria || [])].join('\n'), 900),
    trust: "workspace",
    citation_allowed: true,
    limitation: null
  }];
  linkedTestCases.slice(0, 20).forEach((testCase) => evidence.push({
    ref: `test-case:${testCase.id}`,
    id: testCase.id,
    type: "test-case",
    title: testCase.title,
    label: testCase.title,
    excerpt: compactStoryEvidenceText(testCase.description || testCase.title),
    trust: "workspace",
    citation_allowed: true,
    limitation: "A linked Test Case records expected coverage; it does not prove that the product implementation is complete."
  }));
  const knowledgeItems = Array.isArray(knowledge) ? knowledge : Array.isArray(knowledge?.knowledge) ? knowledge.knowledge : [];
  knowledgeItems.slice(0, 6).forEach((item) => {
    const ref = item.id ? `knowledge:${item.id}` : storyEvidenceRef("knowledge", `${item.title}:${item.content}`);
    evidence.push({
    ref,
    id: item.id || ref,
    type: "knowledge",
    title: item.title || "Project knowledge",
    label: item.title || "Project knowledge",
    excerpt: compactStoryEvidenceText(item.description || item.content),
    trust: "workspace",
    citation_allowed: true,
    limitation: null
  });
  });
  const contextExcerpt = compactStoryEvidenceText(additionalContext, 800);
  if (contextExcerpt) evidence.push({ ref: "user-guidance:story-completion", id: "story-completion", type: "user-guidance", title: "Completion guidance", label: "Completion guidance", excerpt: contextExcerpt, trust: "user-provided", citation_allowed: true, limitation: null });
  externalLinks.forEach((link) => {
    const ref = storyEvidenceRef("external-reference", link);
    evidence.push({ ref, id: ref, type: "external-reference", title: link, label: link, excerpt: "External reference pointer; linked page content was not fetched.", url: link, trust: "pointer-only", citation_allowed: false, limitation: "Pointer metadata cannot support a factual Story change until the linked content is verified." });
  });
  images.forEach((image, index) => {
    const ref = storyEvidenceRef("reference-image", `${image.name}:${index}:${image.content_hash || storyEvidenceRef('image-content',image.url)}`);
    evidence.push({ ref, id: ref, type: "reference-image", title: image.name, label: image.name, excerpt: "User-supplied reference image attached to this run.", trust: "user-provided", citation_allowed: true, limitation: null });
  });
  return evidence;
};

const storyEvidenceLimitations = (evidence, fallbackReason) => [...new Set([
  ...evidence.map((item) => item.limitation).filter(Boolean),
  fallbackReason || null
])];

const evaluateStoryCandidate = (candidate) => {
  const hasTitle = Boolean(normalizeText(candidate.title));
  const hasDescription = compactStoryEvidenceText(candidate.description).length >= 24;
  const acceptanceCount = normalizeTextList(candidate.acceptance_criteria, 12, 1200).length;
  const evidenceCount = Array.isArray(candidate.evidence_refs) ? candidate.evidence_refs.length : 0;
  const unsupportedCount = Array.isArray(candidate.unsupported_fields) ? candidate.unsupported_fields.length : 0;
  const score = Math.max(0, Math.round((
    (hasTitle ? 20 : 0)
    + (hasDescription ? 25 : 0)
    + (acceptanceCount ? 35 : 0)
    + (evidenceCount ? 20 : 0)
    - Math.min(40, unsupportedCount * 10)
  )));
  return {
    score,
    grounding: evidenceCount ? unsupportedCount ? "partially-grounded" : "grounded" : "needs-evidence",
    completeness: hasTitle && hasDescription ? acceptanceCount ? "reviewable" : "partial" : "incomplete",
    testability: acceptanceCount ? "criteria-present" : "criteria-missing"
  };
};


const normalizeRequirementAiReferenceImages = images => normalizeReferenceImages(images);

const normalizeMatchText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const buildAlmReference = (provider, key) => {
  const normalizedProvider = normalizeText(provider) || "alm";
  const normalizedKey = normalizeText(key);
  return normalizedKey ? `${normalizedProvider}:${normalizedKey}` : null;
};

const mergeReferences = (...referenceLists) =>
  normalizeReferenceList(referenceLists.flatMap((references) => normalizeReferenceList(references)));

const findExistingRequirementForImport = async ({ project_id, title, external_references }) => {
  const normalizedReferences = new Set(
    normalizeReferenceList(external_references).map((reference) => reference.toLowerCase())
  );
  const normalizedTitle = normalizeMatchText(title);
  const candidates = await db.prepare(`
    SELECT *
    FROM requirements
    WHERE project_id = ? AND (
      LOWER(REGEXP_REPLACE(BTRIM(title), '\\s+', ' ', 'g')) = ?
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(external_references, '[]'::jsonb)) ref
        WHERE LOWER(ref) IN (SELECT jsonb_array_elements_text(?::jsonb))))
    ORDER BY CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(external_references, '[]'::jsonb)) ref
        WHERE LOWER(ref) IN (SELECT jsonb_array_elements_text(?::jsonb))) THEN 0 ELSE 1 END, id
    LIMIT 2
  `).all(project_id, normalizedTitle, JSON.stringify([...normalizedReferences]), JSON.stringify([...normalizedReferences]));

  if (normalizedReferences.size) {
    const referenceMatches = candidates.filter((candidate) =>
      normalizeStoredReferenceList(candidate.external_references).some((reference) =>
        normalizedReferences.has(reference.toLowerCase())
      )
    );

    if (referenceMatches.length > 1) throw new Error('More than one Story matches these references. Use a Story ID and Expected Revision.');
    if (referenceMatches[0]) {
      return referenceMatches[0];
    }
  }

  if (!normalizedTitle) {
    return null;
  }

  const titleMatches = candidates.filter((candidate) => normalizeMatchText(candidate.title) === normalizedTitle);
  if (titleMatches.length > 1) throw new Error('More than one Story has this title. Use a Story ID and Expected Revision.');
  return titleMatches[0] || null;
};

const upsertRequirementFromImport = async ({
  project_id,
  title,
  description,
  external_references,
  labels,
  sprint,
  fix_version,
  release,
  iteration_id,
  release_id,
  priority,
  status,
  story_id,
  expected_revision,
  preserve_existing = false,
  import_marker,
  acceptance_criteria,
  additional_fields,
  gherkin_scenarios,
  specification_format,
  specification_content,
  dev_completion_target_date,
  qa_completion_target_date,
  scrum_team,
  created_by
}) => {
  const normalizedTitle = normalizeText(title);

  if (!project_id || !normalizedTitle) {
    throw new Error("Missing required fields");
  }

  const existing = story_id
    ? await db.prepare('SELECT * FROM requirements WHERE project_id = ? AND (id = ? OR display_id = ?)').get(project_id, story_id, story_id)
    : await findExistingRequirementForImport({
    project_id,
    title: normalizedTitle,
    external_references
  });
  if (story_id && !existing) throw new Error('Story ID was not found in this project.');
  const previousImport = parseStoredJson(existing?.additional_fields, {})._story_import;
  const requestedImport = import_marker;
  if (previousImport && requestedImport && previousImport.transaction_id === requestedImport.transaction_id && previousImport.row === requestedImport.row) return {action:previousImport.action, id:existing.id, title:existing.title, display_id:existing.display_id};
  if (existing && preserve_existing && !story_id) return {action:'skipped',id:existing.id,title:existing.title};
  if (import_marker) {
    const fields = storyAdditionalFields(additional_fields, acceptance_criteria, parseStoredJson(existing?.additional_fields, {}));
    if (JSON.stringify({...fields, _story_import:import_marker}).length > 50000) {
      throw Object.assign(new Error('Story import metadata and custom fields exceed 50,000 characters. Reduce the custom-field content.'), {statusCode:400});
    }
  }
  const contentFields = {acceptance_criteria, additional_fields, gherkin_scenarios, specification_format, specification_content, dev_completion_target_date, qa_completion_target_date, scrum_team};

  if (existing) {
    const nextReferences = story_id && external_references !== undefined ? external_references : mergeReferences(existing.external_references, external_references);

    await exports.updateRequirement(existing.id, {
      project_id,
      title: normalizedTitle,
      description: description !== undefined && description !== null ? description : existing.description,
      external_references: nextReferences,
      labels: labels !== undefined ? labels : existing.labels,
      sprint: sprint !== undefined ? sprint : existing.sprint,
      fix_version: fix_version !== undefined ? fix_version : existing.fix_version,
      release: release !== undefined ? release : existing.release,
      ...(iteration_id !== undefined ? { iteration_id } : {}),
      ...(release_id !== undefined ? { release_id } : {}),
      priority: priority ?? existing.priority,
      status: status || existing.status,
      ...contentFields,
      ...(expected_revision !== undefined ? {expected_revision} : {}),
      updated_by: created_by
    });
    if (import_marker) await db.prepare("UPDATE requirements SET additional_fields = jsonb_set(COALESCE(additional_fields, '{}'::jsonb), '{_story_import}', ?::jsonb) WHERE id = ?").run(import_marker, existing.id);

    return {
      action: "updated",
      id: existing.id,
      display_id: existing.display_id,
      title: normalizedTitle
    };
  }

  const created = await exports.createRequirement({
    project_id,
    title: normalizedTitle,
    description,
    external_references,
    labels,
    sprint,
    fix_version,
    release,
    iteration_id,
    release_id,
    priority,
    status,
    ...contentFields,
    created_by
  });
  if (import_marker) await db.prepare("UPDATE requirements SET additional_fields = jsonb_set(COALESCE(additional_fields, '{}'::jsonb), '{_story_import}', ?::jsonb) WHERE id = ?").run(import_marker, created.id);

  return {
    action: "created",
    id: created.id,
    display_id: (await db.prepare('SELECT display_id FROM requirements WHERE id = ?').get(created.id))?.display_id,
    title: normalizedTitle
  };
};

const toJiraBaseUrl = (integration) => String(integration.base_url || "").replace(/\/+$/, "");

const buildJiraAuthHeader = (integration) => {
  const token = normalizeText(integration.api_key);
  const username = normalizeText(integration.username);

  if (!token) {
    throw new Error("work-tracker integration is missing an API token");
  }

  return username
    ? `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`
    : `Bearer ${token}`;
};

const jiraFetch = async (integration, path, options = {}) => {
  const baseUrl = toJiraBaseUrl(integration);

  if (!baseUrl) {
    throw new Error("work-tracker integration is missing a base URL");
  }

  const method = String(options.method || "GET").toUpperCase();
  const response = await resilientHttpRequest(`${baseUrl}${path}`, {
    ...options,
    redirect: "error",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: buildJiraAuthHeader(integration),
      ...(options.headers || {})
    }
  }, {
    dependency: "connected-workspace",
    operation: path.startsWith("/rest/api/3/search") ? "issues.search" : "issues.read",
    deadlineMs: 30_000,
    maxAttempts: 3,
    maxResponseBytes: 4 * 1024 * 1024,
    maxConcurrent: 12,
    // Jira search POST is a read-only query; all other POST operations remain
    // single-attempt to avoid replaying side effects.
    idempotent: method === "POST" && path.startsWith("/rest/api/3/search")
  });

  if (!response.ok) {
    await readBoundedResponseText(response, {
      maxBytes: 4 * 1024 * 1024,
      label: "Connected workspace response"
    });
    throw serviceError(
      [401, 403].includes(response.status) ? SERVICE_ERROR_CODES.CONFIGURATION : SERVICE_ERROR_CODES.UPSTREAM_REJECTED,
      {
        dependency: "connected-workspace",
        operation: path.startsWith("/rest/api/3/search") ? "issues.search" : "issues.read",
        retryable: response.status === 429 || response.status >= 500,
        statusCode: response.status === 429 || response.status >= 500 ? 503 : 502,
        upstreamStatus: response.status
      }
    );
  }

  return readBoundedResponseJson(response, {
    maxBytes: 4 * 1024 * 1024,
    label: "Connected workspace response"
  });
};

const assertActiveJiraIntegration = async (integrationId) => {
  const integration = await integrationService.getIntegration(integrationId);

  if (integration.type !== "jira") {
    throw new Error("Select a compatible work-tracker integration.");
  }

  if (!integration.is_active) {
    throw new Error("Selected work-tracker integration is inactive");
  }

  return integration;
};

const extractJiraText = (value) => {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(extractJiraText).filter(Boolean).join("\n");
  }

  if (typeof value === "object") {
    if (typeof value.text === "string") {
      return value.text;
    }

    if (Array.isArray(value.content)) {
      return value.content.map(extractJiraText).filter(Boolean).join(value.type === "paragraph" ? " " : "\n");
    }
  }

  return "";
};

const mapJiraIssueToRequirementRow = (issue, integration) => {
  const key = normalizeText(issue.key);
  const fields = issue.fields || {};
  const title = normalizeText(fields.summary) || key || "Imported ALM requirement";
  const reference = buildAlmReference("jira", key);
  const browseUrl = key ? `${toJiraBaseUrl(integration)}/browse/${encodeURIComponent(key)}` : null;
  const priorityName = normalizeText(fields.priority?.name);
  const priorityNumber = priorityName?.match(/\d+/)?.[0];

  return {
    title,
    description: extractJiraText(fields.description),
    external_references: mergeReferences([reference, browseUrl].filter(Boolean)),
    priority: priorityNumber ? Math.max(1, Math.min(5, Number(priorityNumber))) : undefined,
    status: normalizeText(fields.status?.name) || undefined,
    alm_key: key
  };
};

const extractJsonPayload = parseAiJson;

const resolveLlmIntegration = async (integrationId, projectId, { userId, usageKey } = {}) => {
  const integration = await aiLlmSelectionService.resolveLlmIntegrationForUsage({
    integrationId,
    userId,
    usageKey,
    projectId,
    fallback: "project-then-global",
    allowMissing: true
  });

  if (!integration) {
    return null;
  }

  if (integration.type !== "llm") {
    throw new Error("Selected integration is not an LLM integration");
  }

  if (!integration.is_active) {
    throw new Error("Selected LLM integration is inactive");
  }

  return integration;
};

const requestRequirementOptimization = async ({ integration, prompt, images = [], fallbackContent, contextState }) => {
  const baseUrl = (integration.base_url || "https://api.openai.com/v1").replace(/\/+$/, "");
  const url = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
  const userContent = imageUserContent(prompt, images);
  const response = await fetchLlmWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(integration.api_key ? { Authorization: `Bearer ${integration.api_key}` } : {})
    },
    body: JSON.stringify({
      model: integration.model,

      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: aiInstructionBlock("ai.requirement.optimization", "requirement.response.1")
        },
        {
          role: "user",
          content: userContent
        }
      ]
    })
  }, { integration, operation: "requirement.optimize", contextFallbackContent: fallbackContent, onContextFallback: () => { if (contextState) contextState.reduced = true; } });

  if (!response.ok) {
    const raw = await response.text();
    throw createLlmProviderError({ status: response.status, detail: raw });
  }

  const payload = await response.json();
  const messageContent = getCompletionContent(payload);

  if (!messageContent) {
    throw new Error("LLM response did not include generated content");
  }

  return messageContent;
};

const normalizeStoryPromptGuidance = (value) => {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > 6000) throw Object.assign(new Error("Story prompt guidance must be at most 6000 characters."), { statusCode: 400 });
  return value.trim();
};

const buildRequirementOptimizationPrompt = ({ requirement, linkedTestCases, knowledge, additionalContext, externalLinks, imageNames, evidenceCatalog, promptGuidance = "" }) => [
  aiInstructionBlock("ai.requirement.optimization", "requirement.buildRequirementOptimizationPrompt.2"),
  "",
  aiInstructionBlock("ai.requirement.optimization", "requirement.buildRequirementOptimizationPrompt.4"),
  "{",
  aiInstructionBlock("ai.requirement.optimization", "requirement.buildRequirementOptimizationPrompt.5"),
  "}",
  "",
  aiInstructionBlock("ai.requirement.optimization", "requirement.buildRequirementOptimizationPrompt.33"),
  "",
  aiInstructionBlock("ai.requirement.optimization", "requirement.buildRequirementOptimizationPrompt.25"),
  [aiInstructionBlock("ai.requirement.optimization", "requirement.service.buildRequirementOptimizationPrompt.segment.1"),String(JSON.stringify(promptGuidance)),""].join(''),
  aiInstructionBlock("ai.requirement.optimization", "requirement.buildRequirementOptimizationPrompt.34"),
  JSON.stringify(storyAiSnapshot(requirement)),
  "",
  aiInstructionBlock("ai.requirement.optimization", "requirement.buildRequirementOptimizationPrompt.26"),
  [aiInstructionBlock("ai.requirement.optimization", "requirement.service.buildRequirementOptimizationPrompt.segment.2"),String(imageNames.length ? JSON.stringify(imageNames) : "none"),""].join(''),
  aiInstructionBlock("ai.requirement.optimization", "requirement.buildRequirementOptimizationPrompt.27"),
  JSON.stringify(evidenceCatalog.slice(0, 50).map(({ ref, type, label, excerpt, citation_allowed }) => ({ ref, type, label: boundedAiText(label, 500), excerpt: type === "story" ? "See the complete bounded Story snapshot above." : boundedAiText(excerpt, 900), citation_allowed }))),
  "",
  additionalContext ? `User guidance:\n${additionalContext.slice(0, 8000)}` : "User guidance: none"
].join("\n");

const buildDeterministicRequirementOptimization = (requirement, additionalContext, externalLinks = [], imageNames = [], evidenceRefs = []) => {
  const references = normalizeReferenceList([
    ...normalizeStoredReferenceList(requirement.external_references),
    ...externalLinks
  ]);
  return {
    title: requirement.title,
    description: requirement.description || "",
    priority: requirement.priority ?? 3,
    status: requirement.status || "open",
    external_references: references,
    acceptance_criteria: [],
    risks: [
      "No generated Story changes were proposed because the configured AI provider was unavailable.",
      imageNames.length ? `${imageNames.length} supplied reference image${imageNames.length === 1 ? " was" : "s were"} not analyzed by the deterministic fallback and require manual review.` : null
    ].filter(Boolean),
    open_questions: [
      additionalContext ? "Review the supplied completion guidance manually before changing this Story." : null,
      imageNames.length ? "Review the supplied reference images manually before changing this Story." : null
    ].filter(Boolean),
    change_summary: [
      "The fallback preserved the saved Story fields and proposed no generated product behavior.",
      externalLinks.length ? `Preserved ${externalLinks.length} supplied external reference pointer${externalLinks.length === 1 ? "" : "s"}; linked page contents were not fetched.` : null
    ].filter(Boolean),
    evidence_refs: evidenceRefs,
    field_evidence: {},
    no_changes_proposed: true,
    fallback_used: true,
    fallback_reason: "No active LLM integration is configured."
  };
};

const clampNumber = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

const normalizeTextList = (value, limit = 12, itemLimit = 1000) =>
  (Array.isArray(value) ? value : [])
    .map((item) => normalizeText(String(item ?? "")))
    .filter(Boolean)
    .slice(0, limit)
    .map((item) => item.slice(0, itemLimit));

const parseStoredJson = (value, fallback) => {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const normalizeStoredTextList = (value, limit = 20, itemLimit = 4_000) =>
  normalizeTextList(parseStoredJson(value, []), limit, itemLimit);

const normalizeJsonObject = (value, label = "additional fields", maxChars = 50_000) => {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const serialized = JSON.stringify(value);
  if (serialized.length > maxChars) {
    const error = new Error(`${label} exceed the supported ${maxChars.toLocaleString()} character boundary`);
    error.statusCode = 413;
    throw error;
  }
  return JSON.parse(serialized);
};

const normalizeStoryAiReview = (value, acceptedBy) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const capability = ["ai-story-create", "ai-story-complete"].includes(value.capability) ? value.capability : null;
  const requestId = normalizeText(value.request_id)?.slice(0, 255) || null;
  const inputFingerprint = normalizeText(value.input_fingerprint)?.slice(0, 128) || null;
  if (!capability || !requestId || !inputFingerprint) return null;
  return {
    capability,
    request_id: requestId,
    input_fingerprint: inputFingerprint,
    evidence_refs: normalizeTextList(value.evidence_refs, 100, 255),
    human_edited_fields: normalizeTextList(value.human_edited_fields, 20, 100),
    decision: "accepted",
    accepted_by: acceptedBy || null,
    accepted_at: new Date().toISOString()
  };
};

const buildRequirementCreationPrompt = ({ additionalContext, externalLinks, imageNames, maxRequirements, priority, status, evidenceCatalog, promptGuidance = "" }) => [
  aiInstructionBlock("ai.requirement.creation", "requirement.buildRequirementCreationPrompt.28"),
  "{",
  aiInstructionBlock("ai.requirement.creation", "requirement.buildRequirementCreationPrompt.35"),
  aiInstructionBlock("ai.requirement.creation", "requirement.buildRequirementCreationPrompt.32"),
  aiInstructionBlock("ai.requirement.creation", "requirement.buildRequirementCreationPrompt.33"),
  aiInstructionBlock("ai.requirement.creation", "requirement.buildRequirementCreationPrompt.36"),
  aiInstructionBlock("ai.requirement.creation", "requirement.buildRequirementCreationPrompt.34"),
  '    "acceptance_criteria": [],',
  '    "risks": [],',
  '    "open_questions": [],',
  aiInstructionBlock("ai.requirement.creation", "requirement.buildRequirementCreationPrompt.40"),
  aiInstructionBlock("ai.requirement.creation", "requirement.buildRequirementCreationPrompt.41"),
  aiInstructionBlock("ai.requirement.creation", "requirement.buildRequirementCreationPrompt.37"),
  "}",
  aiInstructionBlock("ai.requirement.creation", "requirement.buildRequirementCreationPrompt.38"),
  [aiInstructionBlock("ai.requirement.creation", "requirement.service.buildRequirementCreationPrompt.segment.3"),String(maxRequirements),aiInstructionBlock("ai.requirement.creation", "requirement.service.buildRequirementCreationPrompt.segment.4"),String(maxRequirements),aiInstructionBlock("ai.requirement.creation", "requirement.service.buildRequirementCreationPrompt.segment.5")].join(''),
  aiInstructionBlock("ai.requirement.creation", "requirement.buildRequirementCreationPrompt.42"),
  [aiInstructionBlock("ai.requirement.creation", "requirement.service.buildRequirementCreationPrompt.segment.6"),String(priority),aiInstructionBlock("ai.requirement.creation", "requirement.service.buildRequirementCreationPrompt.segment.7"),String(status),aiInstructionBlock("ai.requirement.creation", "requirement.service.buildRequirementCreationPrompt.segment.8")].join(''),
  aiInstructionBlock("ai.requirement.creation", "requirement.buildRequirementCreationPrompt.49"),
  [aiInstructionBlock("ai.requirement.creation", "requirement.service.buildRequirementCreationPrompt.segment.9"),String(JSON.stringify(promptGuidance)),""].join(''),
  "",
  [aiInstructionBlock("ai.requirement.creation", "requirement.service.buildRequirementCreationPrompt.segment.10"),String(externalLinks.length ? JSON.stringify(externalLinks) : "none"),""].join(''),
  [aiInstructionBlock("ai.requirement.creation", "requirement.service.buildRequirementCreationPrompt.segment.11"),String(imageNames.length ? JSON.stringify(imageNames.map((name,index)=>({name,evidence_ref:evidenceCatalog.filter(item=>item.type==='reference-image')[index]?.ref}))) : "none"),""].join(''),
  aiInstructionBlock("ai.requirement.creation", "requirement.buildRequirementCreationPrompt.51"),
  JSON.stringify(evidenceCatalog.slice(0, 32).map(({ ref, type, label, excerpt, citation_allowed }) => ({ ref, type, label: boundedAiText(label, 500), excerpt: type === "user-guidance" ? "See the bounded product brief below." : boundedAiText(excerpt, 900), citation_allowed }))),
  aiInstructionBlock("ai.requirement.creation", "requirement.buildRequirementCreationPrompt.39"),
  additionalContext?.slice(0, 12000) || aiInstructionBlock("ai.requirement.creation", imageNames.length ? "requirement.imageOnlyContext" : "requirement.missingProductContext")
].join("\n");

const requestRequirementCreation = async ({ integration, prompt, images, fallbackContent, contextState }) => {
  const baseUrl = (integration.base_url || "https://api.openai.com/v1").replace(/\/+$/, "");
  const url = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
  const safeImages = normalizeReferenceImages(images, {max_images:4});
  const userContent = imageUserContent(prompt, safeImages);
  const response = await fetchLlmWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(integration.api_key ? { Authorization: `Bearer ${integration.api_key}` } : {})
    },
    body: JSON.stringify({
      model: integration.model,

      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: aiInstructionBlock("ai.requirement.creation", "requirement.response.creation")
        },
        { role: "user", content: userContent }
      ]
    })
  }, { integration, operation: "requirement.generate", contextFallbackContent: fallbackContent, onContextFallback: () => { if (contextState) contextState.reduced = true; } });

  if (!response.ok) {
    const raw = await response.text();
    throw createLlmProviderError({ status: response.status, detail: raw });
  }

  const payload = await response.json();
  const messageContent = getCompletionContent(payload);
  if (!messageContent) throw new Error("LLM response did not include generated content");
  return extractJsonPayload(messageContent);
};

const buildDeterministicRequirementCreation = ({ additionalContext, externalLinks, priority, status, evidenceRefs }) => {
  const contextLines = String(additionalContext || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*#\s]+/, "").trim())
    .filter((line) => line && !/^(hellotest smart context pack|requirements?|ai knowledge|file context|attached file context)\s*:?$/i.test(line))
    .filter((line, index, lines) => lines.findIndex((candidate) => candidate.toLowerCase() === line.toLowerCase()) === index);
  const seed = contextLines[0];
  if (!seed || !additionalContext) return [];
  return [{
    client_id: "ai-req-1",
    title: seed.slice(0, 255),
    description: additionalContext.slice(0, 12_000),
    external_references: externalLinks,
    priority,
    status,
    acceptance_criteria: [],
    risks: [],
    open_questions: ["The provider was unavailable, so acceptance behavior still needs an explicit human-authored review."],
    rationale: "Evidence-preserving fallback: the title and description were copied from supplied guidance without inventing behavior.",
    evidence_refs: evidenceRefs,
    field_evidence: { title: evidenceRefs, description: evidenceRefs, priority: [], status: [], acceptance_criteria: [] }
  }];
};

const normalizeRequirementCreationCandidate = (candidate, index, defaults) => {
  const evidenceRefs = normalizeStoryEvidenceRefs(candidate?.evidence_refs, defaults.allowedEvidenceRefs);
  const fieldEvidence = ["title", "description", "priority", "status", "acceptance_criteria"].reduce((result, field) => {
    result[field] = normalizeStoryEvidenceRefs(candidate?.field_evidence?.[field], defaults.allowedEvidenceRefs, 8);
    return result;
  }, {});
  const title = (normalizeText(candidate?.title) || "").slice(0, 255);
  const description = (normalizeText(candidate?.description) || "").slice(0, 12_000);
  const acceptanceCriteria = normalizeTextList(candidate?.acceptance_criteria, 12, 1200);
  const unsupportedCoreField = title && !fieldEvidence.title.length || description && !fieldEvidence.description.length;
  if (!title || unsupportedCoreField) return null;
  const unsupportedFields = acceptanceCriteria.length && !fieldEvidence.acceptance_criteria.length ? ["acceptance criteria"] : [];
  const normalized = {
    client_id: normalizeText(candidate?.client_id) || `ai-req-${index + 1}`,
    title,
    description,
    external_references: normalizeReferenceList(defaults.externalLinks).slice(0, 20),
    priority: fieldEvidence.priority.length ? clampNumber(candidate?.priority, 1, 5, defaults.priority) : defaults.priority,
    status: fieldEvidence.status.length ? (normalizeText(candidate?.status) || defaults.status).slice(0, 100) : defaults.status,
    acceptance_criteria: unsupportedFields.length ? [] : acceptanceCriteria,
    risks: normalizeTextList(candidate?.risks, 8, 800),
    open_questions: normalizeTextList(candidate?.open_questions, 8, 800),
    change_summary: normalizeTextList(candidate?.change_summary, 8, 800),
    rationale: (normalizeText(candidate?.rationale) || "No generation rationale was returned.").slice(0, 1200),
    evidence_refs: evidenceRefs,
    field_evidence: fieldEvidence,
    unsupported_fields: unsupportedFields,
    limitations: unsupportedFields.length
      ? [`No allowed field-level evidence was returned for: ${unsupportedFields.join(", ")}. Review these fields as ungrounded suggestions.`]
      : []
  };
  const evaluation = evaluateStoryCandidate(normalized);
  return { ...normalized, quality_score: evaluation.score / 100, evaluation };
};

const normalizeRequirementFields = (requirement) => ({
  ...requirement,
  gherkin_scenarios: normalizeStoredTextList(requirement.gherkin_scenarios),
  additional_fields: normalizeJsonObject(parseStoredJson(requirement.additional_fields, {})),
  acceptance_criteria: normalizeJsonObject(parseStoredJson(requirement.additional_fields, {})).acceptance_criteria || [],
  ai_review: parseStoredJson(requirement.ai_review, null),
  external_references: normalizeStoredReferenceList(requirement.external_references),
  labels: normalizeStoredReferenceList(requirement.labels)
});

const hydrateRequirements = async (requirements) => {
  const ids = uniqueIds(requirements);
  if (!ids.length) {
    return requirements;
  }

  const placeholders = placeholdersFor(ids);
  const [testCaseRows, defectRows, relatedRows] = await Promise.all([
    db.prepare(`
      SELECT links.requirement_id, links.test_case_id
      FROM requirement_test_cases links
      JOIN requirements r ON r.id = links.requirement_id
      JOIN test_cases tc ON tc.id = links.test_case_id
      LEFT JOIN app_types app ON app.id = tc.app_type_id
      WHERE links.requirement_id IN (${placeholders}) AND (tc.app_type_id IS NULL OR app.project_id = r.project_id)
      UNION
      SELECT tc.requirement_id, tc.id AS test_case_id
      FROM test_cases tc JOIN requirements r ON r.id = tc.requirement_id
      LEFT JOIN app_types app ON app.id = tc.app_type_id
      WHERE tc.requirement_id IN (${placeholders}) AND (tc.app_type_id IS NULL OR app.project_id = r.project_id)
      ORDER BY requirement_id ASC, test_case_id ASC
    `).all(...ids, ...ids),
    db.prepare(`
      SELECT
        requirement_defects.requirement_id,
        feedback.id,
        feedback.title,
        feedback.status,
        feedback.created_at,
        requirement_defects.link_source
      FROM requirement_defects
      JOIN requirements linked_story ON linked_story.id = requirement_defects.requirement_id
      JOIN feedback ON feedback.id = requirement_defects.issue_id AND feedback.project_id = linked_story.project_id
      WHERE requirement_defects.requirement_id IN (${placeholders})
      ORDER BY requirement_defects.requirement_id ASC, feedback.created_at DESC, feedback.title ASC
    `).all(...ids),
    db.prepare(`
      SELECT requirement_relations.requirement_id AS owner_id,
             related.id, related.display_id, related.title, related.status, related.description, related.sprint,
             related.additional_fields->>'assignee_id' AS assignee_id, assignee.name AS assignee_name,
             requirement_relations.relation, 'outward' AS direction
      FROM requirement_relations
      JOIN requirements owner ON owner.id = requirement_relations.requirement_id
      JOIN requirements related ON related.id = requirement_relations.related_requirement_id AND related.project_id = owner.project_id
      LEFT JOIN users assignee ON assignee.id = related.additional_fields->>'assignee_id'
      WHERE requirement_relations.requirement_id IN (${placeholders})
      UNION ALL
      SELECT requirement_relations.related_requirement_id AS owner_id,
             related.id, related.display_id, related.title, related.status, related.description, related.sprint,
             related.additional_fields->>'assignee_id' AS assignee_id, assignee.name AS assignee_name,
             requirement_relations.relation, 'inward' AS direction
      FROM requirement_relations
      JOIN requirements owner ON owner.id = requirement_relations.related_requirement_id
      JOIN requirements related ON related.id = requirement_relations.requirement_id AND related.project_id = owner.project_id
      LEFT JOIN users assignee ON assignee.id = related.additional_fields->>'assignee_id'
      WHERE requirement_relations.related_requirement_id IN (${placeholders})
      ORDER BY title
    `).all(...ids, ...ids)
  ]);
  const testCasesByRequirement = groupRows(testCaseRows, "requirement_id");
  const defectsByRequirement = groupRows(defectRows, "requirement_id");
  const relatedByRequirement = groupRows(relatedRows, "owner_id");

  return requirements.map((requirement) => {
    const defects = defectsByRequirement.get(requirement.id) || [];
    return {
      ...normalizeRequirementFields(requirement),
      test_case_ids: (testCasesByRequirement.get(requirement.id) || []).map((row) => row.test_case_id),
      defect_ids: defects.map((defect) => defect.id),
      defects: defects.map(({ requirement_id, ...defect }) => defect),
      related_items: (relatedByRequirement.get(requirement.id) || []).map(({ owner_id, ...item }) => ({
        ...item,
        issue_type: "Story",
        hellotest_kind: "requirement"
      }))
    };
  });
};

exports.replaceRelatedRequirements = async (id, relatedRequirementIds = []) => {
  const requirement = await exports.getRequirement(id);
  const normalizedIds = normalizeReferenceList(relatedRequirementIds).filter((relatedId) => relatedId !== id);
  await ensureStoriesInProject(normalizedIds, requirement.project_id);
  const transaction = db.transaction(async () => {
    // Keep retained links in their original direction, including typed links.
    // Only relations visible in this project's Related Items are replaced.
    const retainedClause = normalizedIds.length ? `
      AND NOT ((requirement_id = ? AND related_requirement_id IN (${placeholdersFor(normalizedIds)}))
        OR (related_requirement_id = ? AND requirement_id IN (${placeholdersFor(normalizedIds)})))` : "";
    await db.prepare(`
      DELETE FROM requirement_relations
      WHERE (requirement_id = ? OR related_requirement_id = ?)
        AND requirement_id IN (SELECT id FROM requirements WHERE project_id = ?)
        AND related_requirement_id IN (SELECT id FROM requirements WHERE project_id = ?)
        ${retainedClause}
    `).run(id, id, requirement.project_id, requirement.project_id, ...(normalizedIds.length ? [id, ...normalizedIds, id, ...normalizedIds] : []));
    for (const relatedId of normalizedIds) {
      await db.prepare(`
        INSERT INTO requirement_relations (requirement_id, related_requirement_id, relation)
        SELECT ?, ?, 'relates to'
        WHERE NOT EXISTS (
          SELECT 1 FROM requirement_relations
          WHERE (requirement_id = ? AND related_requirement_id = ?)
            OR (requirement_id = ? AND related_requirement_id = ?)
        )
        ON CONFLICT (requirement_id, related_requirement_id) DO NOTHING
      `).run(id, relatedId, id, relatedId, relatedId, id);
    }
  });
  await transaction();
  return { updated: true, related_requirement_ids: normalizedIds };
};

const hydrateTestCaseIds = async (requirement) => {
  if (!requirement) return requirement;
  return (await hydrateRequirements([requirement]))[0];
};

exports.bulkImportRequirements = async ({ project_id, rows = [], created_by, transaction_id } = {}) => {
  if (!project_id) {
    throw new Error("project_id is required");
  }

  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("At least one row is required");
  }

  const project = await db.prepare(`
    SELECT id FROM projects WHERE id = ?
  `).get(project_id);

  if (!project) {
    throw new Error("Project not found");
  }

  const created = [];
  const updated = [];
  const skipped = [];
  const errors = [];
  const transaction = transaction_id
    ? await workspaceTransactionService.updateTransaction(transaction_id, {
        project_id,
        category: "bulk_import",
        action: "requirement_import",
        status: "running",
        title: "Story Import",
        description: `Importing ${rows.length} Story${rows.length === 1 ? "" : "s"} from CSV.`,
        metadata: {
          import_source: "csv",
          total_rows: rows.length,
          total_items: rows.length,
          processed_items: 0,
          progress_percent: 0,
          current_phase: "prepare"
        },
        started_at: new Date().toISOString()
      })
    : await workspaceTransactionService.createTransaction({
        project_id,
        category: "bulk_import",
        action: "requirement_import",
        status: "running",
        title: "Story Import",
        description: `Importing ${rows.length} Story${rows.length === 1 ? "" : "s"} from CSV.`,
        metadata: {
          import_source: "csv",
          total_rows: rows.length,
          total_items: rows.length,
          processed_items: 0,
          progress_percent: 0,
          current_phase: "prepare"
        },
        created_by,
        started_at: new Date().toISOString()
      });
  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    phase: "prepare",
    message: `Started Story import for ${rows.length} CSV row${rows.length === 1 ? "" : "s"}.`,
    details: {
      import_source: "csv",
      total_rows: rows.length
    }
  });

  const completedRows = new Map((await db.prepare(`SELECT id, display_id, title, additional_fields FROM requirements
    WHERE project_id = ? AND additional_fields #>> '{_story_import,transaction_id}' = ?`).all(project_id, transaction.id))
    .map(item => [parseStoredJson(item.additional_fields, {})._story_import?.row, item]));

  for (const [index, row] of rows.entries()) {
    const title = typeof row?.title === "string" ? row.title.trim() : "";

    try {
      if (title.length < 2) {
        throw new Error("Title must be at least 2 characters");
      }

      const normalized = normalizeStoryImportRow(row);
      const previous = completedRows.get(index + 1);
      const response = previous ? {id:previous.id, display_id:previous.display_id, action:parseStoredJson(previous.additional_fields, {})._story_import?.action || 'created'} : await db.transaction(async () => {
        // Serialize the short match/create section across competing imports in this project.
        await db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').get(`story-import:${project_id}`);
        const result = await upsertRequirementFromImport({
        ...normalized,
        project_id,
        title,
        description: typeof row?.description === "string" ? row.description : undefined,
        external_references: row.external_references !== undefined || row.externalReferences !== undefined || row.reference !== undefined || row.references !== undefined
          ? normalizeReferenceList(row.external_references ?? row.externalReferences ?? row.reference ?? row.references) : undefined,
        labels: row?.labels !== undefined || row?.label !== undefined ? normalizeReferenceList(row?.labels || row?.label) : undefined,
        sprint: typeof row?.sprint === "string" ? row.sprint : undefined,
        fix_version: typeof row?.fix_version === "string" ? row.fix_version : typeof row?.fixVersion === "string" ? row.fixVersion : undefined,
        release: typeof row?.release === "string" ? row.release : undefined,
        iteration_id: typeof row?.iteration_id === "string" ? row.iteration_id : undefined,
        release_id: typeof row?.release_id === "string" ? row.release_id : undefined,
        priority: normalized.priority,
        status: normalized.status,
        preserve_existing: true,
        additional_fields: normalized.additional_fields,
        import_marker: {transaction_id:transaction.id, row:index + 1, action:normalized.story_id ? 'updated' : 'created'},
        created_by
      });

        if (result.action !== 'skipped') {
          if (normalized.linked_test_cases !== undefined) await require('./requirementTestCase.service').replaceMappingsForRequirement(result.id, normalizeReferenceList(normalized.linked_test_cases));
          if (normalized.linked_bugs !== undefined) await require('./requirementDefect.service').replaceMappingsForRequirement(result.id, normalizeReferenceList(normalized.linked_bugs));
        }
        return result;
      })();

      const bucket = response.action === "skipped" ? skipped : response.action === "updated" ? updated : created;
      bucket.push({
        row: index + 1,
        id: response.id,
        display_id: response.display_id,
        title
      });
    } catch (error) {
      errors.push({
        row: index + 1,
        title: title || null,
        message: error.message || "Unable to import Story"
      });
    }

    const processed = index + 1;

    if (processed === 1 || processed === rows.length || processed % 10 === 0) {
      await workspaceTransactionService.updateTransaction(transaction.id, {
        description: `Processed ${processed} of ${rows.length} Story${rows.length === 1 ? "" : "s"} so far.`,
        metadata: {
          processed_items: processed,
          total_items: rows.length,
          imported: created.length,
          updated: updated.length,
          skipped: skipped.length,
          failed: errors.length,
          progress_percent: rows.length ? Math.round((processed / rows.length) * 100) : 0,
          current_phase: "import"
        }
      });
      await workspaceTransactionService.appendTransactionEvent(transaction.id, {
        phase: "import",
        message: `Processed ${processed} of ${rows.length} Story row${rows.length === 1 ? "" : "s"}.`,
        details: {
          processed_items: processed,
          total_items: rows.length,
          imported: created.length,
          updated: updated.length,
          skipped: skipped.length,
          failed: errors.length
        }
      });
    }
  }

  const response = {
    transaction_id: transaction.id,
    imported: created.length,
    updated: updated.length,
    skipped: skipped.length,
    failed: errors.length,
    created,
    updated_records: updated,
    skipped_records: skipped,
    errors
  };

  await workspaceTransactionService.updateTransaction(transaction.id, {
    status: created.length || updated.length || skipped.length ? "completed" : "failed",
    description: created.length || updated.length || skipped.length
      ? `Imported ${created.length}, updated ${updated.length}, preserved ${skipped.length} existing Stories; ${errors.length} rows failed.`
      : "No Stories were imported from the CSV file.",
    metadata: {
      import_source: "csv",
      total_rows: rows.length,
      total_items: rows.length,
      processed_items: rows.length,
      imported: created.length,
      updated: updated.length,
      skipped: skipped.length,
      failed: errors.length,
      progress_percent: 100,
      current_phase: "completed"
    },
    completed_at: new Date().toISOString()
  });
  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    level: created.length || updated.length || skipped.length ? "success" : "error",
    phase: "complete",
    message: created.length || updated.length || skipped.length
      ? `Imported ${created.length}, updated ${updated.length}, preserved ${skipped.length}, with ${errors.length} failure${errors.length === 1 ? "" : "s"}.`
      : "Story import completed with no created records.",
    details: {
      imported: created.length,
      updated: updated.length,
      skipped: skipped.length,
      failed: errors.length,
      sample_errors: errors.slice(0, 10)
    }
  });

  const artifact = await workspaceTransactionService.createTransactionArtifact(transaction.id, {
    file_name:'story-import-results.json', mime_type:'application/json', content:JSON.stringify(response, null, 2)
  });

  return {...response, artifact_id:artifact.id};
};

exports.listAlmProjects = async ({ integration_id } = {}) => {
  const integration = await assertActiveJiraIntegration(integration_id);
  const payload = await jiraFetch(integration, "/rest/api/3/project/search?maxResults=100");
  const values = Array.isArray(payload?.values) ? payload.values : Array.isArray(payload) ? payload : [];

  return {
    integration_id: integration.id,
    provider: "jira",
    projects: values.map((project) => ({
      id: String(project.id || project.key || ""),
      key: String(project.key || project.id || ""),
      name: String(project.name || project.key || "Unnamed project")
    })).filter((project) => project.key)
  };
};

exports.listAlmRequirements = async ({ integration_id, alm_project_key, query } = {}) => {
  const integration = await assertActiveJiraIntegration(integration_id);
  const projectKey = normalizeText(alm_project_key || integration.project_key);

  if (!projectKey) {
    throw new Error("Select an ALM project before loading requirements");
  }

  const searchText = normalizeText(query);
  const jql = [
    `project = "${projectKey.replace(/"/g, '\\"')}"`,
    searchText ? `text ~ "${searchText.replace(/"/g, '\\"')}"` : null
  ].filter(Boolean).join(" AND ") + " ORDER BY updated DESC";
  const payload = await jiraFetch(integration, "/rest/api/3/search", {
    method: "POST",
    body: JSON.stringify({
      jql,
      maxResults: 100,
      fields: ["summary", "description", "status", "priority", "issuetype", "updated"]
    })
  });
  const issues = Array.isArray(payload?.issues) ? payload.issues : [];

  return {
    integration_id: integration.id,
    provider: "jira",
    project_key: projectKey,
    requirements: issues.map((issue) => {
      const fields = issue.fields || {};
      const mapped = mapJiraIssueToRequirementRow(issue, integration);
      return {
        key: mapped.alm_key,
        title: mapped.title,
        description: mapped.description,
        status: mapped.status || null,
        priority: mapped.priority || null,
        issue_type: fields.issuetype?.name || null,
        updated_at: fields.updated || null,
        external_references: mapped.external_references
      };
    }).filter((item) => item.key)
  };
};

exports.importRequirementsFromAlm = async ({
  project_id,
  integration_id,
  alm_project_key,
  requirement_keys = [],
  created_by,
  transaction_id
} = {}) => {
  if (!project_id) {
    throw new Error("project_id is required");
  }

  const keys = normalizeReferenceList(requirement_keys);

  if (!keys.length) {
    throw new Error("Select at least one ALM requirement to import");
  }

  const project = await db.prepare(`SELECT id FROM projects WHERE id = ?`).get(project_id);
  if (!project) {
    throw new Error("Project not found");
  }

  const integration = await assertActiveJiraIntegration(integration_id);
  const projectKey = normalizeText(alm_project_key || integration.project_key);
  const created = [];
  const updated = [];
  const errors = [];
  const transaction = transaction_id
    ? await workspaceTransactionService.updateTransaction(transaction_id, {
        project_id,
        category: "bulk_import",
        action: "alm_requirement_import",
        status: "running",
        title: "ALM requirement import",
        description: `Pulling ${keys.length} requirement${keys.length === 1 ? "" : "s"} from ${integration.name}.`,
        metadata: {
          provider: "jira",
          integration_id: integration.id,
          alm_project_key: projectKey,
          total_items: keys.length,
          processed_items: 0,
          imported: 0,
          updated: 0,
          failed: 0,
          progress_percent: 0,
          current_phase: "pulling"
        },
        started_at: new Date().toISOString()
      })
    : await workspaceTransactionService.createTransaction({
        project_id,
        category: "bulk_import",
        action: "alm_requirement_import",
        status: "running",
        title: "ALM requirement import",
        description: `Pulling ${keys.length} requirement${keys.length === 1 ? "" : "s"} from ${integration.name}.`,
        metadata: {
          provider: "jira",
          integration_id: integration.id,
          alm_project_key: projectKey,
          total_items: keys.length,
          processed_items: 0,
          imported: 0,
          updated: 0,
          failed: 0,
          progress_percent: 0,
          current_phase: "pulling"
        },
        created_by,
        started_at: new Date().toISOString()
      });

  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    phase: "pull",
    message: `Started ALM requirement import from ${integration.name}.`,
    details: {
      provider: "jira",
      alm_project_key: projectKey,
      selected_requirements: keys.length
    }
  });

  for (const [index, key] of keys.entries()) {
    try {
      const issue = await jiraFetch(integration, `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,status,priority,issuetype,updated,project`);
      const issueProjectKey = normalizeText(issue.fields?.project?.key) || normalizeText(String(issue.key || "").split("-")[0]);

      if (projectKey && issueProjectKey && issueProjectKey !== projectKey) {
        throw new Error(`ALM requirement ${key} belongs to ${issueProjectKey}, not ${projectKey}`);
      }

      const row = mapJiraIssueToRequirementRow(issue, integration);
      const response = await upsertRequirementFromImport({
        project_id,
        title: row.title,
        description: row.description,
        external_references: row.external_references,
        priority: row.priority,
        status: row.status,
        created_by
      });
      const bucket = response.action === "updated" ? updated : created;
      bucket.push({
        key,
        id: response.id,
        title: response.title
      });
    } catch (error) {
      errors.push({
        key,
        message: error.message || "Unable to import ALM requirement"
      });
    }

    const processed = index + 1;
    await workspaceTransactionService.updateTransaction(transaction.id, {
      description: `Pulled ${processed} of ${keys.length} ALM requirement${keys.length === 1 ? "" : "s"}.`,
      metadata: {
        processed_items: processed,
        total_items: keys.length,
        imported: created.length,
        updated: updated.length,
        failed: errors.length,
        progress_percent: keys.length ? Math.round((processed / keys.length) * 100) : 0,
        current_phase: "import"
      }
    });
    await workspaceTransactionService.appendTransactionEvent(transaction.id, {
      phase: "import",
      message: `Processed ${processed} of ${keys.length} ALM requirement${keys.length === 1 ? "" : "s"}.`,
      details: {
        key,
        processed_items: processed,
        total_items: keys.length,
        imported: created.length,
        updated: updated.length,
        failed: errors.length
      }
    });
  }

  const completedAt = new Date().toISOString();

  await workspaceTransactionService.updateTransaction(transaction.id, {
    status: created.length || updated.length ? "completed" : "failed",
    description: created.length || updated.length
      ? `Imported ${created.length} and updated ${updated.length} requirement${keys.length === 1 ? "" : "s"} from ${integration.name}.`
      : "No ALM requirements were imported.",
    metadata: {
      provider: "jira",
      integration_id: integration.id,
      alm_project_key: projectKey,
      total_items: keys.length,
      processed_items: keys.length,
      imported: created.length,
      updated: updated.length,
      failed: errors.length,
      progress_percent: 100,
      current_phase: "completed"
    },
    completed_at: completedAt
  });
  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    level: created.length || updated.length ? "success" : "error",
    phase: "complete",
    message: `ALM import created ${created.length}, updated ${updated.length}, failed ${errors.length}.`,
    details: {
      imported: created.length,
      updated: updated.length,
      failed: errors.length,
      sample_errors: errors.slice(0, 10)
    }
  });

  return {
    imported: created.length,
    updated: updated.length,
    failed: errors.length,
    created,
    updated_records: updated,
    errors
  };
};

const ensureIterationBelongsToProject = async (iterationId, projectId) => {
  const normalizedIterationId = normalizeText(iterationId);

  if (!normalizedIterationId) {
    return null;
  }

  const iteration = await db.prepare(`
    SELECT id, project_id, name, state
    FROM requirement_iterations
    WHERE id = ?
  `).get(normalizedIterationId);

  if (!iteration) {
    throw new Error("Iteration not found");
  }

  if (iteration.project_id !== projectId) {
    throw new Error("Iteration must belong to the same project as the requirement");
  }

  return iteration;
};

const ensureStoriesInProject = async (requirementIds, projectId) => {
  for (const requirementId of requirementIds) {
    const story = await db.prepare("SELECT id, project_id FROM requirements WHERE id = ?").get(requirementId);
    if (!story) throw new Error(`Story not found: ${requirementId}`);
    if (story.project_id !== projectId) throw new Error("Related Stories must belong to the same project");
  }
};

exports.createRequirement = async ({ project_id, title, description, acceptance_criteria, gherkin_scenarios, additional_fields, ai_review, external_references, labels, sprint, fix_version, release, release_id, iteration_id, dev_completion_target_date, qa_completion_target_date, scrum_team, specification_format, specification_content, priority, status, related_requirement_ids = [], created_by }) => {
  if (!project_id || !title) {
    throw new Error("Missing required fields");
  }

  const project = await db.prepare(`
    SELECT id FROM projects WHERE id = ?
  `).get(project_id);

  if (!project) throw new Error("Project not found");
  const nativeIteration = await ensureIterationBelongsToProject(iteration_id, project_id);
  if (nativeIteration?.state === "closed") throw Object.assign(new Error("Completed Sprints cannot accept a Story"), { statusCode: 409, code: "SPRINT_SCOPE_LOCKED" });
  const relatedRequirementIds = normalizeReferenceList(related_requirement_ids);
  await ensureStoriesInProject(relatedRequirementIds, project_id);

  const id = uuid();
  const display_id = await displayIdService.createDisplayId("requirement");

  const transaction = db.transaction(async () => {
    await db.prepare(`
      INSERT INTO requirements (id, display_id, project_id, title, description, gherkin_scenarios, additional_fields, ai_review, external_references, labels, sprint, fix_version, release, iteration_id, dev_completion_target_date, qa_completion_target_date, scrum_team, specification_format, specification_content, priority, status, created_by, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      id,
      display_id,
      project_id,
      title,
      description || null,
      normalizeTextList(gherkin_scenarios, 20, 4_000),
      storyAdditionalFields(normalizeJsonObject(additional_fields), acceptance_criteria),
      normalizeStoryAiReview(ai_review, created_by),
      normalizeReferenceList(external_references),
      normalizeReferenceList(labels),
      nativeIteration?.name || normalizeText(sprint),
      normalizeText(fix_version),
      normalizeText(release),
      normalizeText(iteration_id),
      normalizeDeliveryDate(dev_completion_target_date),
      normalizeDeliveryDate(qa_completion_target_date),
      normalizeText(scrum_team),
      normalizeSpecificationFormat(specification_format),
      normalizeText(specification_content),
      priority ?? 3,
      status || null,
      created_by || null,
      created_by || null
    );
    for (const relatedId of relatedRequirementIds) {
      await db.prepare(`
        INSERT INTO requirement_relations (requirement_id, related_requirement_id, relation)
        VALUES (?, ?, 'relates to')
        ON CONFLICT (requirement_id, related_requirement_id) DO NOTHING
      `).run(id, relatedId);
    }
    await requirementReleaseService.syncSprintMembership(iteration_id, { updated_by: created_by });
    if (release_id !== undefined) await requirementReleaseService.setStoryRelease(id, {
      releaseId: release_id, projectId: project_id, updated_by: created_by
    });
  });
  await transaction();

  return { id, related_requirement_ids: relatedRequirementIds };
};

exports.getRequirementsPage = (query) => require("./requirementCatalog.service").getPage(query, hydrateRequirements);

exports.getRequirements = async ({ project_id, status, priority, ids, limit }) => {
  let query = `SELECT * FROM requirements WHERE 1=1`;
  const params = [];

  if (project_id) {
    query += ` AND project_id = ?`;
    params.push(project_id);
  }

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }

  if (priority !== undefined) {
    query += ` AND priority = ?`;
    params.push(priority);
  }

  const normalizedIds = normalizeReferenceList(ids);
  if (normalizedIds.length) {
    query += ` AND id IN (${normalizedIds.map(() => "?").join(",")})`;
    params.push(...normalizedIds);
  }

  query += ` ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC`;

  if (limit !== undefined) {
    const boundedLimit = Math.max(1, Math.min(10_000, Number.parseInt(String(limit), 10) || 1));
    query += ` LIMIT ?`;
    params.push(boundedLimit);
  }

  const rows = await db.prepare(query).all(...params);
  return hydrateRequirements(rows);
};

exports.getRequirement = async (id, { includeLinkedRecords = true } = {}) => {
  const requirement = await db.prepare(`
    SELECT * FROM requirements WHERE id = ?
  `).get(id);

  if (!requirement) throw new Error("Requirement not found");

  return includeLinkedRecords ? hydrateTestCaseIds(requirement) : normalizeRequirementFields(requirement);
};

exports.updateRequirement = async (id, data) => {
  const transaction = db.transaction(async () => {
    const existing = await db.prepare(`SELECT * FROM requirements WHERE id = ? FOR UPDATE`).get(id);
    if (!existing) throw new Error("Requirement not found");
    const currentRevision = assertExpectedRevision(existing.revision, data.expected_revision, "Story");

    if (data.project_id) {
      const project = await db.prepare(`SELECT id FROM projects WHERE id = ?`).get(data.project_id);
      if (!project) throw new Error("Project not found");
    }
    const previousIterationId = normalizeText(existing.iteration_id);
    const nextIterationId = data.iteration_id !== undefined ? normalizeText(data.iteration_id) : previousIterationId;
    const targetProjectId = data.project_id ?? existing.project_id;
    const [previousIteration, nextIteration] = await Promise.all([
      previousIterationId ? ensureIterationBelongsToProject(previousIterationId, existing.project_id) : null,
      nextIterationId ? ensureIterationBelongsToProject(nextIterationId, targetProjectId) : null
    ]);
    if (nextIterationId !== previousIterationId && nextIteration?.state === "closed") {
      throw Object.assign(new Error("Completed Sprints cannot accept a Story"), { statusCode: 409, code: "SPRINT_SCOPE_LOCKED" });
    }
    const nextSprint = nextIteration
      ? nextIteration.name
      : data.sprint !== undefined
        ? normalizeText(data.sprint)
        : previousIterationId && previousIteration?.name === normalizeText(existing.sprint)
          ? null
          : existing.sprint;

    await db.prepare(`
      UPDATE requirements
      SET project_id = ?, title = ?, description = ?, gherkin_scenarios = ?, additional_fields = ?, ai_review = ?, external_references = ?, labels = ?, sprint = ?, fix_version = ?, release = ?, iteration_id = ?, dev_completion_target_date = ?, qa_completion_target_date = ?, scrum_team = ?, specification_format = ?, specification_content = ?, priority = ?, status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP, revision = ?
      WHERE id = ?
    `).run(
      data.project_id ?? existing.project_id,
      data.title ?? existing.title,
      data.description ?? existing.description,
      data.gherkin_scenarios !== undefined
        ? normalizeTextList(data.gherkin_scenarios, 20, 4_000)
        : normalizeStoredTextList(existing.gherkin_scenarios),
      storyAdditionalFields(data.additional_fields, data.acceptance_criteria, parseStoredJson(existing.additional_fields, {})),
      data.ai_review !== undefined
        ? normalizeStoryAiReview(data.ai_review, data.updated_by ?? existing.updated_by ?? existing.created_by)
        : parseStoredJson(existing.ai_review, null),
      data.external_references !== undefined
        ? normalizeReferenceList(data.external_references)
        : normalizeStoredReferenceList(existing.external_references),
      data.labels !== undefined
        ? normalizeReferenceList(data.labels)
        : normalizeStoredReferenceList(existing.labels),
      nextSprint,
      data.fix_version !== undefined ? normalizeText(data.fix_version) : existing.fix_version,
      data.release !== undefined ? normalizeText(data.release) : existing.release,
      nextIterationId,
      data.dev_completion_target_date !== undefined ? normalizeDeliveryDate(data.dev_completion_target_date) : existing.dev_completion_target_date,
      data.qa_completion_target_date !== undefined ? normalizeDeliveryDate(data.qa_completion_target_date) : existing.qa_completion_target_date,
      data.scrum_team !== undefined ? normalizeText(data.scrum_team) : existing.scrum_team,
      data.specification_format !== undefined ? normalizeSpecificationFormat(data.specification_format, existing.specification_format) : normalizeSpecificationFormat(existing.specification_format),
      data.specification_content !== undefined ? normalizeText(data.specification_content) : existing.specification_content,
      data.priority ?? existing.priority,
      data.status ?? existing.status,
      data.updated_by ?? existing.updated_by ?? existing.created_by ?? null,
      currentRevision + 1,
      id
    );

    if (previousIterationId !== nextIterationId) {
      for (const sprintId of [...new Set([previousIterationId, nextIterationId].filter(Boolean))]) {
        await requirementReleaseService.syncSprintMembership(sprintId, { updated_by: data.updated_by });
      }
    }

    if (data.release_id !== undefined) await requirementReleaseService.setStoryRelease(id, {
      releaseId: data.release_id, projectId: targetProjectId,
      previousRelease: existing.release, previousFixVersion: existing.fix_version, updated_by: data.updated_by
    });

    return { updated: true, revision: currentRevision + 1 };
  });

  return transaction();
};

exports.previewRequirementOptimization = async ({ id, integration_id, user_id, user, requirement_context, prompt_guidance, additional_context, external_links, images } = {}) => {
  const requestId = uuid();
  const promptGuidance = normalizeStoryPromptGuidance(prompt_guidance);
  const savedRequirement = await exports.getRequirement(id, { includeLinkedRecords: false });
  const currentDraft = aiObject(requirement_context);
  if ((currentDraft.id && currentDraft.id !== id) || (currentDraft.project_id && currentDraft.project_id !== savedRequirement.project_id)) {
    throw Object.assign(new Error("Story draft context must belong to the selected Story and project"), { statusCode: 400 });
  }
  const draftFields = Object.fromEntries(Object.keys(storyAiSnapshot({})).filter(key => !["id", "display_id", "context_limits"].includes(key) && Object.hasOwn(currentDraft, key)).map(key => [key, currentDraft[key]]));
  const requirement = { ...savedRequirement, ...draftFields,
    additional_fields: { ...aiObject(savedRequirement.additional_fields), ...aiObject(draftFields.additional_fields) } };
  requirement.acceptance_criteria = normalizeTextList(currentDraft.acceptance_criteria ?? aiObject(currentDraft.additional_fields).acceptance_criteria ?? savedRequirement.acceptance_criteria, 100, 2000);
  const evidenceUser = user || (user_id ? { id: user_id } : null);
  const evidenceAccess = await getOptionalEvidenceAccess(evidenceUser, requirement.project_id, ["testcase.view"]);
  const linkedTestCases = evidenceAccess["testcase.view"] ? await selectLinkedTestCases.all(id) : [];
  const additionalContext = (normalizeText(additional_context) || "").slice(0, 20_000);
  const externalLinks = normalizeTextList(external_links, 20, 2000);
  const safeImages = normalizeRequirementAiReferenceImages(images);
  const imageNames = safeImages.map((image) => image.name);
  const knowledge = await aiKnowledgeService.buildKnowledgeContextPackage(requirement.project_id, {
    app_type_id: requirement.app_type_id || null,
    query: requirement.description || requirement.title,
    module_name: requirement.module_name || null,
    feature_name: requirement.feature_name || null,
    user: evidenceUser || undefined
  });
  const evidence = buildStoryCompletionEvidence({
    requirement,
    linkedTestCases,
    knowledge,
    additionalContext,
    externalLinks,
    images: safeImages
  });
  const integration = await resolveLlmIntegration(integration_id, requirement.project_id, {
    userId: user_id || user?.id,
    usageKey: "ai.requirement.optimization"
  });
  const inputFingerprint = storyRequestFingerprint({
    capability: "requirement-completion-preview",
    project_id: requirement.project_id,
    requirement_id: requirement.id,
    requirement_revision: requirement.revision ?? null,
    requirement_updated_at: requirement.updated_at || null,
    requirement_context: storyAiSnapshot(requirement),
    integration_id: integration?.id || integration_id || null,
    prompt_guidance: promptGuidance,
    additional_context: additionalContext,
    external_links: externalLinks,
    images: storyImageInputSnapshot(safeImages),
    evidence_snapshot: evidence.map((item) => ({ ref: item.ref, content_ref: storyRequestFingerprint(item.excerpt || item.title) }))
  });
  let suggestion;
  let fallbackUsed = false;
  let fallbackReason = null;
  const contextState = { reduced: false };

  if (integration) {
    try {
      const content = await requestRequirementOptimization({
        integration,
        contextState,
        fallbackContent: buildRequirementOptimizationPrompt({
          promptGuidance,
          requirement,
          linkedTestCases: [], knowledge: [], additionalContext,
          externalLinks: [], imageNames: [], evidenceCatalog: evidence.filter((item) => item.ref === `story:${requirement.id}`)
        }),
        images: safeImages,
        prompt: buildRequirementOptimizationPrompt({
          promptGuidance,
          requirement,
          linkedTestCases,
          knowledge,
          additionalContext,
          externalLinks,
          imageNames,
          evidenceCatalog: evidence
        })
      });
      suggestion = extractJsonPayload(content);
    } catch (error) {
      if (error?.code === 'AI_VISION_UNSUPPORTED') throw error;
      fallbackUsed = true;
      fallbackReason = "The configured AI provider could not return a valid evidence-backed Story completion; no generated Story changes were proposed.";
      suggestion = {
        ...buildDeterministicRequirementOptimization(requirement, additionalContext, externalLinks, imageNames, [`story:${requirement.id}`]),
        fallback_used: true,
        fallback_reason: fallbackReason
      };
    }
  } else {
    fallbackUsed = true;
    fallbackReason = "No active LLM integration is configured; no generated Story changes were proposed.";
    suggestion = {
      ...buildDeterministicRequirementOptimization(requirement, additionalContext, externalLinks, imageNames, [`story:${requirement.id}`]),
      fallback_reason: fallbackReason
    };
  }

  requireAiAssessment({ integration, failed: fallbackUsed });
  if (fallbackUsed) {
    evidence.filter((item) => item.type === "reference-image").forEach((item) => {
      item.citation_allowed = false;
      item.trust = "manual-review-only";
      item.limitation = "The deterministic fallback did not inspect this image; it cannot support a proposed Story change.";
    });
  }
  const allowedEvidenceRefs = new Set(evidence.filter((item) => item.citation_allowed).map((item) => item.ref));
  const allEvidenceRefs = new Set(evidence.map((item) => item.ref));
  const fieldEvidenceKeys = ["title", "description", "priority", "status", "external_references", "acceptance_criteria"];
  const fieldEvidence = fieldEvidenceKeys.reduce((result, field) => {
    result[field] = normalizeStoryEvidenceRefs(
      suggestion?.field_evidence?.[field],
      field === "external_references" ? allEvidenceRefs : allowedEvidenceRefs,
      8
    );
    return result;
  }, {});
  const savedDescription = requirement.description || "";
  const savedPriority = requirement.priority ?? 3;
  const savedStatus = requirement.status || "open";
  const proposedTitle = normalizeText(suggestion.title) || requirement.title;
  const proposedDescription = normalizeText(suggestion.description) || savedDescription;
  const proposedPriority = Number.isFinite(Number(suggestion.priority)) ? clampNumber(suggestion.priority, 1, 5, savedPriority) : savedPriority;
  const proposedStatus = normalizeText(suggestion.status) || savedStatus;
  const proposedAcceptanceCriteria = normalizeTextList(suggestion.acceptance_criteria, 12, 1200);
  const unsupportedFields = [
    proposedTitle !== requirement.title && !fieldEvidence.title.length ? "title" : null,
    proposedDescription !== savedDescription && !fieldEvidence.description.length ? "description" : null,
    proposedPriority !== savedPriority && !fieldEvidence.priority.length ? "priority" : null,
    proposedStatus !== savedStatus && !fieldEvidence.status.length ? "status" : null,
    proposedAcceptanceCriteria.length && !fieldEvidence.acceptance_criteria.length ? "acceptance criteria" : null
  ].filter(Boolean);
  const normalizedSuggestion = {
    title: proposedTitle !== requirement.title && !fieldEvidence.title.length ? requirement.title : proposedTitle,
    description: proposedDescription !== savedDescription && !fieldEvidence.description.length ? savedDescription : proposedDescription,
    priority: proposedPriority !== savedPriority && !fieldEvidence.priority.length ? savedPriority : proposedPriority,
    status: proposedStatus !== savedStatus && !fieldEvidence.status.length ? savedStatus : proposedStatus,
    external_references: normalizeReferenceList([
      ...normalizeStoredReferenceList(requirement.external_references),
      ...externalLinks
    ]),
    acceptance_criteria: proposedAcceptanceCriteria.length && !fieldEvidence.acceptance_criteria.length ? [] : proposedAcceptanceCriteria,
    risks: normalizeTextList(suggestion.risks, 8, 800),
    open_questions: normalizeTextList(suggestion.open_questions, 8, 800),
    change_summary: normalizeTextList(suggestion.change_summary, 8, 800),
    evidence_refs: normalizeStoryEvidenceRefs(suggestion.evidence_refs, allowedEvidenceRefs),
    field_evidence: fieldEvidence,
    unsupported_fields: unsupportedFields,
    no_changes_proposed: Boolean(suggestion.no_changes_proposed)
  };
  const savedReferences = normalizeStoredReferenceList(requirement.external_references);
  const hasSupportedChange = normalizedSuggestion.title !== requirement.title
    || normalizedSuggestion.description !== savedDescription
    || normalizedSuggestion.priority !== savedPriority
    || normalizedSuggestion.status !== savedStatus
    || normalizedSuggestion.acceptance_criteria.length > 0
    || normalizedSuggestion.external_references.some((ref) => !savedReferences.includes(ref));
  normalizedSuggestion.no_changes_proposed = normalizedSuggestion.no_changes_proposed || !hasSupportedChange;
  const evaluation = evaluateStoryCandidate(normalizedSuggestion);
  const limitations = storyEvidenceLimitations(evidence, fallbackReason || suggestion.fallback_reason || null);
  if (!evidenceAccess["testcase.view"]) limitations.push("Linked Test Case evidence is unavailable under the current access settings; Story completion uses the remaining permitted context.");
  if (unsupportedFields.length) {
    limitations.push(`Unsupported model changes were discarded for: ${unsupportedFields.join(", ")}. The saved Story values remain unchanged for those fields.`);
  }
  const processing = buildStoryProcessingSnapshot({
    profile: "story-complete",
    sourceCount: evidence.length,
    outputCount: 1,
    fallbackUsed,
    limitationCount: limitations.length
  });

  return {
    requirement: {
      id: requirement.id,
      title: requirement.title
    },
    integration: integration
      ? {
          id: integration.id,
          name: integration.name,
          type: integration.type,
          model: integration.model
        }
      : null,
    suggestion: normalizedSuggestion,
    evidence,
    limitations,
    evaluation,
    processing,
    review_status: "awaiting_review",
    context_reduced: contextState.reduced,
    context_reduction_reason: contextState.reduced ? "The provider rejected the full context size; a shorter evidence context was used. Review the proposal against the original Story and attachments." : null,
    generation_mode: fallbackUsed ? "deterministic" : "llm",
    fallback_used: fallbackUsed,
    fallback_reason: fallbackReason || suggestion.fallback_reason || null,
    request_id: requestId,
    input_fingerprint: inputFingerprint,
    requires_human_review: true,
    preview_only: true,
    provenance: {
      capability: "requirement-completion-preview",
      project_id: requirement.project_id,
      requirement_id: requirement.id,
      request_id: requestId,
      input_fingerprint: inputFingerprint,
      evidence_refs: evidence.map((item) => item.ref),
      provider: fallbackUsed ? "HelloTest evidence-preserving fallback" : integration?.name || null,
      model: fallbackUsed ? null : integration?.model || null,
      attempted_provider: fallbackUsed ? integration?.name || null : null,
      context_reduced: contextState.reduced,
      context_reduction_reason: contextState.reduced ? "The provider rejected the full context size; a shorter evidence context was used. Review the proposal against the original Story and attachments." : null,
      generation_mode: fallbackUsed ? "deterministic" : "llm",
      generated_at: new Date().toISOString()
    }
  };
};

exports.previewRequirementCreation = async ({
  project_id,
  integration_id,
  user_id,
  additional_context,
  prompt_guidance,
  external_links,
  images,
  max_requirements,
  priority,
  status
} = {}) => {
  const requestId = uuid();
  const promptGuidance = normalizeStoryPromptGuidance(prompt_guidance);
  if (max_requirements != null && (!Number.isInteger(Number(max_requirements)) || Number(max_requirements) < 1 || Number(max_requirements) > 6)) throw Object.assign(new Error("Generate between one and six Stories per request."), { statusCode: 400 });
  const maxRequirements = Math.round(clampNumber(max_requirements, 1, 6, 4));
  const defaultPriority = Math.round(clampNumber(priority, 1, 5, 3));
  const defaultStatus = (normalizeText(status) || "open").slice(0, 100);
  const additionalContext = (normalizeText(additional_context) || "").slice(0, 20_000);
  const externalLinks = normalizeTextList(external_links, 20, 2000);
  const safeImages = normalizeReferenceImages(images, {max_images:4});
  if (!additionalContext && !safeImages.length) {
    const message = 'Add a product description or upload a PNG, JPEG, or WebP image before creating Stories. Links alone do not supply product evidence.';
    throw Object.assign(new Error(message), { statusCode:422, code:'AI_STORY_EVIDENCE_REQUIRED', publicMessage:message });
  }
  const missingEvidenceError = () => {
    const message = safeImages.length
      ? 'The model did not return a Story supported by the supplied image evidence. Try a clearer screenshot, add a short description of the intended behavior, or select another vision-capable model.'
      : 'The model did not return a Story supported by the supplied product context. Add the intended behavior and expected outcome, or select another configured model.';
    return Object.assign(new Error(message), { statusCode:422, code:'AI_STORY_EVIDENCE_REQUIRED', publicMessage:message });
  };
  const knowledgePackage = additionalContext
    ? await aiKnowledgeService.buildKnowledgeContextPackage(project_id, {
        query: additionalContext,
        user: user_id ? { id: user_id } : undefined
      })
    : { knowledge: [] };
  const knowledge = {
    ...knowledgePackage,
    knowledge: rankStoryKnowledge(knowledgePackage.knowledge, additionalContext)
  };
  const evidence = buildStoryCreationEvidence({ additionalContext, externalLinks, images: safeImages, knowledge });
  const integration = await resolveLlmIntegration(integration_id, project_id, {
    userId: user_id,
    usageKey: "ai.requirement.creation"
  });
  requireAiAssessment({ integration });
  const inputFingerprint = storyRequestFingerprint({
    capability: "requirement-creation-preview",
    project_id,
    integration_id: integration?.id || integration_id || null,
    prompt_guidance: promptGuidance,
    additional_context: additionalContext,
    external_links: externalLinks,
    images: storyImageInputSnapshot(safeImages),
    evidence_snapshot: evidence.map((item) => ({ ref: item.ref, content_ref: storyRequestFingerprint(item.excerpt || item.title) })),
    max_requirements: maxRequirements,
    priority: defaultPriority,
    status: defaultStatus
  });
  let rawCandidates;
  const fallbackUsed = false;
  const fallbackReason = null;
  const contextState = { reduced: false };

  try {
      const result = await requestRequirementCreation({
        integration,
        contextState,
        fallbackContent: buildRequirementCreationPrompt({
          promptGuidance,
          additionalContext: String(additionalContext || "").slice(0, 2000), externalLinks: [], imageNames: safeImages.map(image=>image.name),
          maxRequirements, priority: defaultPriority, status: defaultStatus,
          evidenceCatalog: evidence.filter((item) => item.citation_allowed).slice(0, 6).map((item) => ({ ...item, excerpt: String(item.excerpt || "").slice(0, 400) }))
        }),
        images: safeImages,
        prompt: buildRequirementCreationPrompt({
          promptGuidance,
          additionalContext,
          externalLinks,
          imageNames: safeImages.map((image) => image.name),
          maxRequirements,
          priority: defaultPriority,
          status: defaultStatus,
          evidenceCatalog: evidence
        })
      });
      if (!Array.isArray(result?.requirements)) throw new Error('Missing Story draft array');
      rawCandidates = result.requirements;
  } catch (error) {
    // Keep classified, sanitized provider/configuration failures actionable.
    // Never substitute provider response text or invented local Stories.
    if (typeof error?.publicMessage === 'string' && error.publicMessage.trim()) {
      error.message = error.publicMessage; // Durable jobs display message, while HTTP uses publicMessage.
      throw error;
    }
    if (['AI_VISION_UNSUPPORTED','LLM_AUTHENTICATION_FAILED','LLM_QUOTA_EXCEEDED','LLM_RATE_LIMITED','LLM_RATE_LIMIT_REQUEST_TOO_LARGE','LLM_REQUEST_TOO_LARGE'].includes(error?.code)) throw error;
    if (error?.code === 'AI_NATIVE_CONTRACT_INVALID' && error.validation_errors?.length && error.validation_errors.every(item=>item.field==='requirements')) throw missingEvidenceError();
    const message = 'The configured model did not return a valid Story response. Retry or select another configured model; image inputs require a vision-capable model.';
    throw Object.assign(new Error(message), { statusCode:502, code:'AI_STORY_RESPONSE_INVALID', publicMessage:message });
  }
  const allowedEvidenceRefs = new Set(evidence.filter((item) => item.citation_allowed).map((item) => item.ref));

  const normalizeCandidates = (candidates) => candidates
    .slice(0, maxRequirements)
    .map((candidate, index) => normalizeRequirementCreationCandidate(candidate, index, {
      externalLinks,
      priority: defaultPriority,
      status: defaultStatus,
      allowedEvidenceRefs
    }))
    .filter((candidate) => Boolean(candidate?.title))
    .filter((candidate, index, all) => all.findIndex(item => item.title.toLowerCase() === candidate.title.toLowerCase() && item.description === candidate.description) === index);
  const requirements = normalizeCandidates(rawCandidates);
  if (!requirements.length) throw missingEvidenceError();

  const limitations = storyEvidenceLimitations(evidence, fallbackReason);
  const unsupportedDraftCount = requirements.filter((candidate) => candidate.unsupported_fields.length).length;
  if (unsupportedDraftCount) limitations.push(`${unsupportedDraftCount} draft${unsupportedDraftCount === 1 ? " had" : "s had"} unsupported acceptance criteria removed before review.`);
  const processing = buildStoryProcessingSnapshot({
    profile: "story-create",
    sourceCount: evidence.length,
    outputCount: requirements.length,
    fallbackUsed,
    limitationCount: limitations.length
  });

  return {
    requirement: null,
    generated: requirements.length,
    requirements,
    suggestion: requirements[0] || null,
    integration: integration
      ? { id: integration.id, name: integration.name, type: integration.type, model: integration.model }
      : null,
    fallback_used: fallbackUsed,
    fallback_reason: fallbackReason,
    request_id: requestId,
    input_fingerprint: inputFingerprint,
    evidence,
    limitations,
    processing,
    review_status: "awaiting_review",
    context_reduced: contextState.reduced,
    context_reduction_reason: contextState.reduced ? "The provider rejected the full context size; a shorter evidence context was used. Review the proposal against the original Story and attachments." : null,
    generation_mode: fallbackUsed ? "deterministic" : "llm",
    requires_human_review: true,
    preview_only: true,
    provenance: {
      capability: "requirement-creation-preview",
      project_id,
      request_id: requestId,
      input_fingerprint: inputFingerprint,
      evidence_refs: evidence.map((item) => item.ref),
      provider: fallbackUsed ? "HelloTest evidence-preserving fallback" : integration?.name || null,
      model: fallbackUsed ? null : integration?.model || null,
      attempted_provider: fallbackUsed ? integration?.name || null : null,
      context_reduced: contextState.reduced,
      context_reduction_reason: contextState.reduced ? "The provider rejected the full context size; a shorter evidence context was used. Review the proposal against the original Story and attachments." : null,
      generation_mode: fallbackUsed ? "deterministic" : "llm",
      generated_at: new Date().toISOString()
    }
  };
};

exports.deleteRequirement = async (id) => {
  await exports.getRequirement(id);
  await db.prepare(`
    DELETE FROM requirement_test_cases
    WHERE requirement_id = ?
  `).run(id);

  await db.prepare(`
    UPDATE test_cases
    SET requirement_id = NULL
    WHERE requirement_id = ?
  `).run(id);

  await db.prepare(`
    DELETE FROM requirements WHERE id = ?
  `).run(id);

  return { deleted: true };
};

if (process.env.NODE_ENV === "test") {
  Object.defineProperty(exports, "__storyAiInternals", {
    enumerable: false,
    value: {
      buildDeterministicRequirementCreation,
      buildDeterministicRequirementOptimization,
      buildStoryCreationEvidence,
      buildStoryProcessingSnapshot,
      evaluateStoryCandidate,
      normalizeRequirementCreationCandidate,
      normalizeStoryEvidenceRefs,
      rankStoryKnowledge,
      storyRequestFingerprint
    }
  });
}
