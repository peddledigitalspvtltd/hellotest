const { normalizeReferenceImages, imageUserContent } = require('@hellotest/platform/backend/src/utils/aiReferenceImages');
const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { requireAiAssessment } = require("@hellotest/platform/backend/src/utils/requireAiAssessment");
const crypto = require("crypto");
const db = require("@hellotest/platform/backend/src/db");
const aiLlmSelectionService = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const { normalizeReferenceList } = require("@hellotest/platform/backend/src/utils/externalReferences");
const { fetchLlmWithRetry } = require("@hellotest/platform/backend/src/utils/llmHttpClient");
const { getCompletionContent } = require("@hellotest/platform/backend/src/utils/llmResponse");
const { parseAiJson } = require("@hellotest/platform/backend/src/utils/aiJsonResponse");
const { createLlmProviderError } = require("@hellotest/platform/backend/src/utils/upstreamLlmError");
const { object: aiObject, list: aiList } = require("@hellotest/platform/backend/src/utils/aiArtifactContext");
const { splitGenerationContext } = require("@hellotest/platform/backend/src/utils/aiGenerationContext");
const defectReproductionService = require("@hellotest/testing/backend/services/defectReproduction.service");
const agentFailureEvidence = require("./agentFailureEvidence");
const permissionService = require("@hellotest/platform/backend/services/permission.service");
const attachmentService = require("@hellotest/platform/backend/services/attachment.service");
const { sanitizeAiText } = require("@hellotest/platform/backend/src/security/aiTextPolicy");
const { parseStructuredLogs } = require("@hellotest/platform/backend/src/domain/executionStepEvidence");

const BUG_DRAFT_USAGE_KEY = "ai.bug.draft";
const MAX_TEST_CASES = 10;
const MAX_REQUIREMENTS = 10;
const MAX_FAILURE_RESULTS = 10;
const MAX_EXTERNAL_LINKS = 12;
const MAX_REFERENCE_IMAGES = 6;
const MAX_REFERENCE_IMAGE_CHARS = 950_000;
const MAX_EXECUTION_IMAGE_BYTES = 650_000;
const EXECUTION_IMAGE_TIME_BUDGET_MS = 8_000;
const DRAFT_FIELDS = [
  "title",
  "message",
  "steps_to_reproduce",
  "expected_result",
  "actual_result",
  "severity",
  "priority",
  "environment",
  "build",
  "labels",
  "rationale"
];
const BUG_DRAFT_CONTEXT_LIMITS = Object.freeze({
  run_text: 240,
  case_title: 300,
  case_description: 600,
  requirement_title: 300,
  requirement_description: 600,
  requirement_expected_section: 1_500,
  case_step_text: 700,
  case_reproduction: 4_000,
  failure_step_text: 900,
  failure_comment: 1_000,
  failure_observation: 1_000,
  status: 80,
  timestamp: 80
});

const stringifyTextValue = (value) => typeof value === "string"
  ? value
  : value === null || value === undefined
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
const normalizeText = (value, max = 18_000) => {
  return stringifyTextValue(value).trim().slice(0, max);
};
const fingerprint = (value) => crypto.createHash("sha256").update(JSON.stringify(value || {})).digest("hex").slice(0, 20);
const shortHash = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
const plainText = (value) => stringifyTextValue(value)
  .replace(/<[^>]*>/g, " ")
  .replace(/\s+/g, " ")
  .trim();
const stripMarkup = (value, max = 500) => sanitizeAiText(plainText(value)).text.slice(0, max);
const normalizeExternalLinks = (value) => normalizeReferenceList(value)
  .map((item) => normalizeText(item, 2_048))
  .filter((item) => /^https?:\/\//i.test(item))
  .slice(0, MAX_EXTERNAL_LINKS);
const normalizeImageAssets = images => normalizeReferenceImages(images);
const hasWrittenIncident = (input, context = {}) => Boolean(input.intent || input.evidence
  || splitGenerationContext(input.additional_context).user_request || context.run
  || context.cases?.length || context.requirements?.length || context.failures?.length);
const failureLogsText = (failure) => {
  // Structured runner logs also contain captures, request bodies and image data.
  // Only observed outcome fields belong in the model's incident evidence.
  const logs = parseStructuredLogs(failure?.logs);
  return Object.entries(logs.stepStatuses).filter(([, status]) => status === "failed").slice(0, 30)
    .map(([id]) => [logs.stepNotes[id], logs.stepApiDetails[id]?.error, logs.stepWebDetails[id]?.error]
      .filter(value => typeof value === "string").map(value => stripMarkup(value, 2_400)).join("; "))
    .filter(Boolean).join("\n");
};
const failureObservationText = (failure) => {
  const observations = [];
  if (failure?.error) observations.push(`Failure error: ${failure.error}`);
  const observedLogs = failureLogsText(failure);
  if (observedLogs) observations.push(`Failure logs: ${observedLogs}`);
  if (failure?.defects) observations.push(`Recorded defects: ${failure.defects}`);
  for (const step of failure?.steps || []) {
    if (step.observed_status === "failed" || step.note || step.api_observation?.error || step.browser_observation?.error) {
      observations.push(`Step ${step.order}: ${step.action || "(no action text)"} — ${step.observed_status || "unknown"}${step.note ? `; ${step.note}` : ""}`);
      if (step.api_observation?.error) observations.push(`API error: ${step.api_observation.error}`);
      if (step.browser_observation?.error) observations.push(`Browser error: ${step.browser_observation.error}`);
    }
  }
  for (const comment of failure?.comments || []) if (comment?.body) observations.push(`Failure comment: ${comment.body}`);
  return observations.map(value => stripMarkup(value, 1_600)).filter(Boolean).join("\n");
};
const defectRetrievalQuery = (input, context, images) => {
  const additional = splitGenerationContext(input.additional_context);
  const reviewedText = additional.reviewed_context.map(value => {
    try {
      const parsed = JSON.parse(value);
      // Uploaded file identities and temporary URLs are not search topics.
      return typeof parsed.text_excerpts === "string" ? parsed.text_excerpts : "";
    } catch { return value; }
  });
  const topics = [
    stripMarkup(input.intent, 600), stripMarkup(input.evidence, 800), stripMarkup(additional.user_request, 800),
    ...reviewedText.map(value => stripMarkup(value, 800)),
    context.run ? stripMarkup(context.run.name || context.run.id, 200) : "",
    ...context.cases.map(item => stripMarkup(item.title || item.description || item.id, 200)),
    ...context.requirements.map(item => stripMarkup(item.title || item.expected_section || item.id, 200)),
    ...context.failures.map(item => stripMarkup(failureObservationText(item) || item.id, 300))
  ].filter(Boolean);
  return topics.length ? topics.join("\n").slice(0, 3_500) : images.length ? null : undefined;
};

const extractJson = parseAiJson;
const allowedSeverity = new Set(["critical", "high", "medium", "low"]);
const allowedPriority = new Set(["Highest", "High", "Medium", "Low", "Lowest"]);
const normalizePriority = (value, fallback) => {
  const normalized = String(value || "").trim();
  const mapped = ({ p1: "Highest", p2: "High", p3: "Medium", p4: "Low", p5: "Lowest" })[normalized.toLowerCase()] || normalized;
  const canonical = [...allowedPriority].find((item) => item.toLowerCase() === mapped.toLowerCase());
  return canonical || fallback;
};
const unique = (items) => [...new Set((Array.isArray(items) ? items : []).filter(Boolean))];
const evidenceRef = (type, id) => `${type}:${id}`;

const extractLabeledSection = (value, labels) => {
  const text = normalizeText(value, 12_000);
  if (!text) return "";
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:${escaped})\\s*:?\\s*([^\\n]*(?:\\n(?!(?:\\s*[A-Za-z][A-Za-z ]{1,40}\\s*:))[^\\n]*)*)`, "i");
  const match = text.match(pattern);
  return normalizeText(match?.[1], 8_000);
};

const extractHeadedSection = (value, labels) => {
  const headingMarker = "__HELLOTEST_HEADING__";
  const text = normalizeText(value, 18_000)
    .replace(/<h[1-6][^>]*>/gi, `\n${headingMarker}`)
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(?:li|p|div|ul|ol)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const content = [];
  let collecting = false;
  for (const rawLine of lines) {
    const markedHeading = rawLine.startsWith(headingMarker);
    const markdownHeading = /^#{1,6}\s+/.test(rawLine);
    const line = rawLine.replace(new RegExp(`^${headingMarker}`), "").replace(/^#{1,6}\s+/, "").trim();
    const label = normalizedLabels.find((item) => line.toLowerCase() === item || line.toLowerCase().startsWith(`${item}:`));
    if (label) {
      collecting = true;
      const inlineValue = line.slice(label.length).replace(/^\s*:\s*/, "").trim();
      if (inlineValue) content.push(inlineValue);
      continue;
    }
    if (collecting && (markedHeading || markdownHeading || /^[A-Za-z][A-Za-z0-9 /&-]{1,60}:$/.test(line))) break;
    if (collecting) content.push(line);
  }
  return normalizeText(content.join("\n"), 8_000);
};

const storyExpectedBehavior = (story) => aiList(
  story.acceptance_criteria ?? aiObject(story.additional_fields).acceptance_criteria, 100, 4000
).join("\n") || extractHeadedSection(story.description, ["expected result", "expected behavior", "acceptance criteria", "behavior"]);

const buildPromptContextSnapshot = (context) => {
  const contentOmissions = [];
  const boundText = (sourceRef, field, value, limit) => {
    const full = sanitizeAiText(plainText(value)).text;
    if (full.length > limit) contentOmissions.push({ source_ref: sourceRef, field, unit: "characters", omitted: full.length - limit });
    return full.slice(0, limit);
  };
  const run = context.run ? {
    id: normalizeText(context.run.id, 255),
    name: boundText(evidenceRef("run", context.run.id), "name", context.run.name, BUG_DRAFT_CONTEXT_LIMITS.run_text),
    status: boundText(evidenceRef("run", context.run.id), "status", context.run.status, BUG_DRAFT_CONTEXT_LIMITS.status),
    trigger: boundText(evidenceRef("run", context.run.id), "trigger", context.run.trigger, BUG_DRAFT_CONTEXT_LIMITS.status),
    release: boundText(evidenceRef("run", context.run.id), "release", context.run.release, BUG_DRAFT_CONTEXT_LIMITS.run_text),
    sprint: boundText(evidenceRef("run", context.run.id), "sprint", context.run.sprint, BUG_DRAFT_CONTEXT_LIMITS.run_text),
    build: boundText(evidenceRef("run", context.run.id), "build", context.run.build, BUG_DRAFT_CONTEXT_LIMITS.run_text),
    test_environment_id: normalizeText(context.run.test_environment_id, 255),
    created_at: boundText(evidenceRef("run", context.run.id), "created_at", context.run.created_at, BUG_DRAFT_CONTEXT_LIMITS.timestamp)
  } : null;
  const cases = context.cases.map((item) => {
    const sourceRef = evidenceRef("test-case", item.id);
    const stepRows = item.steps || [];
    const omittedSteps = Number(item.omitted_steps || 0) + Math.max(0, stepRows.length - 30);
    if (omittedSteps) contentOmissions.push({ source_ref: sourceRef, field: "steps", unit: "items", omitted: omittedSteps });
    return {
      id: normalizeText(item.id, 255),
      display_id: normalizeText(item.display_id, 255),
      title: boundText(sourceRef, "title", item.title, BUG_DRAFT_CONTEXT_LIMITS.case_title),
      description: boundText(sourceRef, "description", item.description, BUG_DRAFT_CONTEXT_LIMITS.case_description),
      steps: stepRows.slice(0, 30).map((step) => ({
        order: Number(step.step_order || 0),
        action: boundText(sourceRef, `step_${step.step_order}_action`, step.action, BUG_DRAFT_CONTEXT_LIMITS.case_step_text),
        expected_result: boundText(sourceRef, `step_${step.step_order}_expected`, step.expected_result, BUG_DRAFT_CONTEXT_LIMITS.case_step_text)
      })),
      reproduction_steps: boundText(sourceRef, "reproduction_steps", (item.reproduction_steps || []).join("\n"), BUG_DRAFT_CONTEXT_LIMITS.case_reproduction),
      expected_result: boundText(sourceRef, "expected_result", item.expected_result, BUG_DRAFT_CONTEXT_LIMITS.case_reproduction),
      omitted_steps: omittedSteps,
      status: boundText(sourceRef, "status", item.status, BUG_DRAFT_CONTEXT_LIMITS.status),
      priority: boundText(sourceRef, "priority", item.priority, BUG_DRAFT_CONTEXT_LIMITS.status),
      updated_at: boundText(sourceRef, "updated_at", item.updated_at, BUG_DRAFT_CONTEXT_LIMITS.timestamp),
      source: item.source || 'saved_test_case',
      execution_result_id: item.execution_result_id || null
    };
  });
  const requirements = context.requirements.map((item) => ({
    id: normalizeText(item.id, 255),
    display_id: normalizeText(item.display_id, 255),
    title: boundText(evidenceRef("requirement", item.id), "title", item.title, BUG_DRAFT_CONTEXT_LIMITS.requirement_title),
    description: boundText(evidenceRef("requirement", item.id), "description", item.description, BUG_DRAFT_CONTEXT_LIMITS.requirement_description),
    expected_section: boundText(
      evidenceRef("requirement", item.id),
      "expected_section",
      storyExpectedBehavior(item),
      BUG_DRAFT_CONTEXT_LIMITS.requirement_expected_section
    ),
    status: boundText(evidenceRef("requirement", item.id), "status", item.status, BUG_DRAFT_CONTEXT_LIMITS.status),
    priority: boundText(evidenceRef("requirement", item.id), "priority", item.priority, BUG_DRAFT_CONTEXT_LIMITS.status),
    updated_at: boundText(evidenceRef("requirement", item.id), "updated_at", item.updated_at, BUG_DRAFT_CONTEXT_LIMITS.timestamp)
  }));
  const failures = context.failures.map((item) => {
    const sourceRef = evidenceRef("execution-result", item.id);
    const stepRows = item.steps || [];
    const omittedSteps = Number(item.evidence_coverage?.omitted_steps || 0) + Math.max(0, stepRows.length - 30);
    if (omittedSteps) contentOmissions.push({ source_ref: sourceRef, field: "steps", unit: "items", omitted: omittedSteps });
    const commentRows = item.comments || [];
    const omittedComments = Number(item.evidence_coverage?.omitted_comments || 0) + Math.max(0, commentRows.length - 8);
    if (omittedComments) contentOmissions.push({ source_ref: sourceRef, field: "comments", unit: "items", omitted: omittedComments });
    return {
      id: normalizeText(item.id, 255),
      test_case_id: normalizeText(item.test_case_id, 255),
      status: boundText(sourceRef, "status", item.status, BUG_DRAFT_CONTEXT_LIMITS.status),
      error: boundText(sourceRef, "error", item.error, BUG_DRAFT_CONTEXT_LIMITS.failure_observation),
      logs: boundText(sourceRef, "observation", failureLogsText(item), BUG_DRAFT_CONTEXT_LIMITS.failure_observation),
      steps: stepRows.slice(0, 30).map((step) => ({
        order: Number(step.order || 0),
        action: boundText(sourceRef, `step_${step.order}_action`, step.action, BUG_DRAFT_CONTEXT_LIMITS.failure_step_text),
        expected_result: boundText(sourceRef, `step_${step.order}_expected`, step.expected_result, BUG_DRAFT_CONTEXT_LIMITS.failure_step_text),
        observed_status: boundText(sourceRef, `step_${step.order}_status`, step.observed_status, BUG_DRAFT_CONTEXT_LIMITS.status),
        note: boundText(sourceRef, `step_${step.order}_note`, step.note, BUG_DRAFT_CONTEXT_LIMITS.failure_step_text),
        api_observation: step.api_observation || {},
        browser_observation: step.browser_observation || {}
      })),
      comments: commentRows.slice(0, 8).map((comment) => ({
        body: boundText(sourceRef, "failure_comment", comment.body, BUG_DRAFT_CONTEXT_LIMITS.failure_comment),
        updated_at: boundText(sourceRef, "comment_updated_at", comment.updated_at, BUG_DRAFT_CONTEXT_LIMITS.timestamp)
      })),
      coverage: item.evidence_coverage ? { ...item.evidence_coverage, omitted_steps: omittedSteps, omitted_comments: omittedComments } : null,
      omitted_steps: omittedSteps,
      limitations: item.evidence_limitations || [],
      defects: "",
      created_at: boundText(sourceRef, "created_at", item.created_at, BUG_DRAFT_CONTEXT_LIMITS.timestamp)
    };
  });
  return {
    run,
    cases,
    requirements,
    failures,
    execution_images: (context.execution_images || []).map((image) => ({
      name: plainText(image.name, 255),
      content_hash: normalizeText(image.content_hash, 64)
    })),
    content_limits: BUG_DRAFT_CONTEXT_LIMITS,
    content_omissions: contentOmissions,
    partial_sources: contentOmissions.length > 0
  };
};

const loadExecutionImages = async ({ user, projectId, run, failures, reservedImages = [], exactResult = false }) => {
  if (!run) return { images: [], requested: 0, omitted: 0, accessRestricted: false };
  let canViewAttachments = false;
  try {
    canViewAttachments = Boolean(user
      && await permissionService.hasPermission(user, "attachment.view", projectId)
      && await permissionService.hasPermission(user, "result.view", projectId));
  }
  catch (error) {
    if (error?.name === 'AbortError' || [401, 403, 499].includes(error?.statusCode) || error?.code === 'REQUEST_CANCELLED') throw error;
    return { images: [], requested: 0, omitted: 0, accessRestricted: true };
  }
  if (!canViewAttachments) return { images: [], requested: 0, omitted: 0, accessRestricted: true };
  const resultIds = unique(failures.map((item) => item.id)).slice(0, MAX_FAILURE_RESULTS);
  if (exactResult && !resultIds.length) return { images: [], requested: 0, omitted: 0, accessRestricted: false };
  const imageLimit = MAX_REFERENCE_IMAGES;
  const admitted = [];
  let totalChars = reservedImages.reduce((total, image) => total + image.url.length, 0);
  let omitted = 0, duplicates = 0, inlineRequested = 0, unavailable = false;
  const candidates = [];
  const attachmentSteps = new Map();
  const resultById = new Map(failures.map(failure => [failure.id, failure]));
  const priorityFor = status => status === 'failed' ? 0 : status === 'blocked' ? 1 : status ? 3 : 2;
  const stepContext = (failure, stepId, status) => {
    const step = failure.steps?.find(value => value.id === stepId);
    return `Result ${failure.id} · case ${failure.test_case_id} · step ${step?.order || stepId} · observed ${status || 'unknown'}`;
  };
  for (const failure of failures) {
    const logs = parseStructuredLogs(failure.logs);
    const evidence = Object.entries(logs.stepEvidence).sort(([a], [b]) => priorityFor(logs.stepStatuses[a]) - priorityFor(logs.stepStatuses[b]));
    for (const [stepId, item] of evidence.slice(0, 50)) {
      const status = logs.stepStatuses[stepId];
      const context = { resultId: failure.id, name: stepContext(failure, stepId, status), priority: priorityFor(status) };
      if (typeof item?.attachmentId === 'string') attachmentSteps.set(item.attachmentId, context);
      const url = item?.dataUrl || item?.data_url;
      if (typeof url !== 'string' || !url.startsWith('data:image/')) continue;
      inlineRequested++;
      candidates.push({ ...context, url });
    }
  }
  const failureAttachmentIds = [...attachmentSteps].filter(([, value]) => value.priority < 2).map(([id]) => id);
  const resultClause = resultIds.length ? ` OR (entity_type = 'execution_result' AND entity_id IN (${resultIds.map(() => "?").join(",")}))` : "";
  const rows = await db.prepare(`
    SELECT id, project_id, entity_type, entity_id, file_name, mime_type, size_bytes
    FROM attachments
    WHERE project_id = ? AND (${exactResult ? `entity_type = 'execution_result' AND entity_id IN (${resultIds.map(() => "?").join(",")})` : `(entity_type = 'execution' AND entity_id = ?)${resultClause}`})
      AND (mime_type ILIKE 'image/png%' OR mime_type ILIKE 'image/jpeg%' OR mime_type ILIKE 'image/webp%')
    ORDER BY ${failureAttachmentIds.length ? `CASE WHEN id IN (${failureAttachmentIds.map(() => '?').join(',')}) THEN 0 ELSE 1 END, ` : ''}created_at DESC, id DESC
    LIMIT 51
  `).all(projectId, ...(exactResult ? resultIds : [run.id, ...resultIds]), ...failureAttachmentIds).catch(error => {
    if (error?.name === 'AbortError' || [401, 403, 499].includes(error?.statusCode) || error?.code === 'REQUEST_CANCELLED') throw error;
    unavailable = true;
    return [];
  });
  const candidateRows = rows.filter((row) => ["image/png", "image/jpeg", "image/webp"].includes(String(row.mime_type || "").split(";", 1)[0].toLowerCase()));
  const deadline = Date.now() + EXECUTION_IMAGE_TIME_BUDGET_MS;
  omitted += Math.max(0, candidateRows.length - 50);
  for (const row of candidateRows.slice(0, 50)) {
    const failure = resultById.get(row.entity_id);
    const linkedStep = attachmentSteps.get(row.id);
    const context = linkedStep && row.entity_type === 'execution_result' && row.entity_id === linkedStep.resultId ? linkedStep : null;
    candidates.push({ row, ...(context || {
      priority: failure ? 2 : 4,
      name: failure
        ? `Result ${failure.id} · case ${failure.test_case_id} · step unknown · attachment ${row.file_name || row.id}`
        : `Run ${run.id} · step unknown · attachment ${row.file_name || row.id}`
    }) });
  }
  // Admit failure images before earlier passed steps consume the shared image
  // budget, regardless of whether the runner saved inline data or a receipt.
  for (const candidate of candidates.sort((a, b) => a.priority - b.priority)) {
    if (reservedImages.length + admitted.length >= imageLimit || Date.now() >= deadline) {
      omitted++;
      continue;
    }
    if (candidate.url) {
      if (candidate.url.length > Math.ceil(MAX_EXECUTION_IMAGE_BYTES * 4 / 3) + 100 || totalChars + candidate.url.length > MAX_REFERENCE_IMAGE_CHARS) { omitted++; continue; }
      try {
        const [normalized] = normalizeReferenceImages([{ name: candidate.name, url: candidate.url }]);
        if ([...reservedImages, ...admitted].some(image => image.content_hash === normalized.content_hash)) { duplicates++; continue; }
        admitted.push(normalized);
        totalChars += normalized.url.length;
      } catch { omitted++; }
      continue;
    }
    const { row } = candidate;
    const remainingBytes = Math.floor(Math.max(0, MAX_REFERENCE_IMAGE_CHARS - totalChars - 32) * 0.75);
    const maxBytes = Math.min(MAX_EXECUTION_IMAGE_BYTES, remainingBytes);
    const expectedType = String(row.mime_type || "").split(";", 1)[0].toLowerCase();
    if (!maxBytes || Number(row.size_bytes || 0) <= 0 || Number(row.size_bytes || 0) > maxBytes) {
      omitted++;
      continue;
    }
    let stream, timer, expired = false;
    try {
      const read = (async () => {
        const downloaded = await attachmentService.download({ user, id: row.id });
        stream = downloaded.stream;
        const stored = downloaded.row;
        if (expired) {
          stream.destroy();
          throw new Error("Screenshot read exceeded its time budget.");
        }
        if (stored.project_id !== projectId || stored.entity_type !== row.entity_type || stored.entity_id !== row.entity_id
          || !((stored.entity_type === "execution" && stored.entity_id === run.id)
            || (stored.entity_type === "execution_result" && resultIds.includes(stored.entity_id)))) {
          throw new Error("Screenshot attachment scope changed.");
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of stream) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > maxBytes) throw new Error("Screenshot exceeds the AI image budget.");
          chunks.push(bytes);
        }
        return Buffer.concat(chunks);
      })();
      const bytes = await Promise.race([read, new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          stream?.destroy();
          reject(new Error("Screenshot read exceeded its time budget."));
        }, Math.min(2_500, Math.max(1, deadline - Date.now())));
      })]);
      const image = { name: candidate.name, url: `data:${expectedType};base64,${bytes.toString("base64")}` };
      const candidateHash = crypto.createHash("sha256").update(bytes).digest("hex");
      if ([...reservedImages, ...admitted].some((image) => image.content_hash === candidateHash)) { duplicates++; continue; }
      const normalized = normalizeReferenceImages([...reservedImages, ...admitted, image]);
      const normalizedCandidate = normalized.find((image) => image.content_hash === candidateHash);
      if (!normalizedCandidate) {
        omitted++;
        continue;
      }
      admitted.push(normalizedCandidate);
      totalChars += normalizedCandidate.url.length;
    } catch (error) {
      if (error?.name === 'AbortError' || [401, 403, 499].includes(error?.statusCode) || error?.code === 'REQUEST_CANCELLED') throw error;
      omitted++;
    } finally {
      clearTimeout(timer);
      stream?.destroy();
    }
  }
  return { images: admitted, requested: candidateRows.length + inlineRequested - duplicates, omitted, accessRestricted: false, unavailable };
};

const loadEvidence = async ({ user, projectId, runId, resultId, testCaseIds, suiteIds = [], moduleIds = [], requirementIds, referenceImages = [] }) => {
  const requestedCaseIds = unique(testCaseIds);
  const requestedSuiteIds = unique(suiteIds);
  const requestedModuleIds = unique(moduleIds);
  const requestedRequirementIds = unique(requirementIds);
  let boundedCaseIds = requestedCaseIds.slice(0, MAX_TEST_CASES);
  const boundedRequirementIds = requestedRequirementIds.slice(0, MAX_REQUIREMENTS);
  const unavailable = [];
  const optionalRead = async (kind, operation, fallback = []) => {
    try { return await operation(); }
    catch (error) {
      if (error?.name === 'AbortError' || [401, 403, 499].includes(error?.statusCode) || error?.code === 'REQUEST_CANCELLED') throw error;
      unavailable.push(kind);
      return fallback;
    }
  };
  const run = runId
    ? await optionalRead('run', () => db.prepare("SELECT id, name, status, trigger, release, sprint, build, project_id, test_environment_id, created_at FROM executions WHERE id = ? AND project_id = ?").get(runId, projectId), null)
    : null;
  const canReadRunCases = Boolean(run && user && await optionalRead('case_permission', () => permissionService.hasPermission(user, 'testcase.view', projectId), false));
  const selectedScopes = {};
  for (const [kind, table, ids] of [['suites', 'test_suites', requestedSuiteIds], ['modules', 'test_case_modules', requestedModuleIds]]) {
    const bounded = ids.slice(0, MAX_TEST_CASES);
    selectedScopes[kind] = bounded.length ? await optionalRead(kind, () => db.prepare(`SELECT scope.id, scope.name
      FROM ${table} scope JOIN app_types app ON app.id = scope.app_type_id
      WHERE app.project_id = ? AND scope.id IN (${bounded.map(() => '?').join(',')})
      ORDER BY scope.id LIMIT ${MAX_TEST_CASES}`).all(projectId, ...bounded)) : [];
  }
  const validSuiteIds = selectedScopes.suites.map(item => item.id);
  const validModuleIds = selectedScopes.modules.map(item => item.id);
  const scopeRequested = Boolean(requestedSuiteIds.length || requestedModuleIds.length);
  const scopeResolved = (!requestedSuiteIds.length || validSuiteIds.length > 0) && (!requestedModuleIds.length || validModuleIds.length > 0);
  const placeholders = ids => ids.map(() => '?').join(',');
  let liveScopeCount = 0;
  if (!runId && !requestedCaseIds.length && scopeRequested && scopeResolved) {
    const rows = await optionalRead('scope_cases', () => db.prepare(`SELECT tc.id, COUNT(*) OVER()::INTEGER AS total_scope_cases
      FROM test_cases tc JOIN app_types app ON app.id = tc.app_type_id
      WHERE app.project_id = ?
        ${validSuiteIds.length ? `AND (tc.suite_id IN (${placeholders(validSuiteIds)}) OR EXISTS (SELECT 1 FROM suite_test_cases membership WHERE membership.test_case_id = tc.id AND membership.suite_id IN (${placeholders(validSuiteIds)})))` : ''}
        ${validModuleIds.length ? `AND EXISTS (SELECT 1 FROM test_case_effective_module_cases membership WHERE membership.test_case_id = tc.id AND membership.module_id IN (${placeholders(validModuleIds)}))` : ''}
      ORDER BY tc.id LIMIT ${MAX_TEST_CASES}`).all(projectId, ...validSuiteIds, ...validSuiteIds, ...validModuleIds));
    boundedCaseIds = rows.map(item => item.id);
    liveScopeCount = Number(rows[0]?.total_scope_cases || rows.length);
  }
  // A missing selected run cannot turn into live-library evidence. Its frozen
  // actions must remain unknown instead of silently using a changed test case.
  let cases = !runId ? await optionalRead('test_cases', () => defectReproductionService.loadCaseReproduction({ projectId, testCaseIds: boundedCaseIds })) : [];
  const requirements = [];
  for (const id of boundedRequirementIds) {
    const item = await optionalRead('requirements', () => db.prepare("SELECT id, display_id, title, description, additional_fields, status, priority, updated_at FROM requirements WHERE id = ? AND project_id = ?").get(id, projectId), null);
    if (item) requirements.push(item);
  }

  let failures = [];
  let failureCount = 0;
  if (run) {
    const selectedCaseIds = requestedCaseIds.length ? boundedCaseIds : [];
    const caseClause = selectedCaseIds.length
      ? ` AND execution_results.test_case_id IN (${placeholders(selectedCaseIds)})`
      : "";
    // Explicit cases are authoritative. Suite/module dimensions only resolve
    // cases when none were selected, and the dimensions intersect each other.
    const scopeClause = !requestedCaseIds.length && scopeRequested
      ? !scopeResolved ? ' AND FALSE' : ` AND EXISTS (SELECT 1 FROM execution_case_snapshots scoped_case
        WHERE scoped_case.execution_id = execution_results.execution_id AND scoped_case.test_case_id = execution_results.test_case_id
          ${validSuiteIds.length ? `AND scoped_case.suite_id IN (${placeholders(validSuiteIds)})` : ''}
          ${validModuleIds.length ? `AND scoped_case.module_id IN (${placeholders(validModuleIds)})` : ''})`
      : '';
    const scopeParams = !requestedCaseIds.length && scopeRequested && scopeResolved ? [...validSuiteIds, ...validModuleIds] : [];
    const resultClause = resultId ? ' AND execution_results.id = ?' : '';
    failures = await optionalRead('failure_results', () => db.prepare(`WITH latest AS (
      SELECT DISTINCT ON (test_case_id, COALESCE(data_set_iteration_index, -1))
        id, test_case_id, test_case_title, status, error, logs, defects, created_at
      FROM execution_results WHERE execution_results.execution_id = ?${caseClause}${scopeClause}${resultClause}
      ORDER BY test_case_id, COALESCE(data_set_iteration_index, -1), created_at DESC, id DESC
    ) SELECT *, COUNT(*) OVER()::INTEGER AS total_results FROM latest WHERE status IN ('failed', 'blocked')
      ORDER BY created_at DESC, id DESC LIMIT ${MAX_FAILURE_RESULTS}`).all(run.id, ...selectedCaseIds, ...scopeParams, ...(resultId ? [resultId] : [])));
    failureCount = Number(failures[0]?.total_results || failures.length);
  }

  let failurePackets = [];
  let failureEvidenceUnavailable = false;
  if (run && user && canReadRunCases && failures.length) {
    try {
      failurePackets = await agentFailureEvidence.collect({
        projectId,
        runIds: [run.id],
        testCaseIds: unique(failures.map(item => item.test_case_id)),
        resultIds: failures.map(item => item.id),
        canView: permission => permissionService.hasPermission(user, permission, projectId),
        read: (sql, values = []) => db.prepare(sql).all(...values)
      });
    } catch (error) {
      if (error?.name === 'AbortError' || [401, 403, 499].includes(error?.statusCode) || error?.code === 'REQUEST_CANCELLED') throw error;
      failureEvidenceUnavailable = true;
    }
  }
  const packetsByResult = new Map(failurePackets.map((packet) => [packet.result_id, packet]));
  failures = failures.map((failure) => {
    const packet = packetsByResult.get(failure.id);
    return packet ? {
      ...failure,
      error: packet.error || failure.error,
      steps: packet.steps,
      comments: packet.comments,
      evidence_coverage: packet.coverage,
      evidence_limitations: packet.limitations
    } : failure;
  });
  const packetsByCase = new Map();
  for (const packet of failurePackets) if (!packetsByCase.has(packet.test_case_id)) packetsByCase.set(packet.test_case_id, packet);
  if (run && canReadRunCases) {
    const caseIds = requestedCaseIds.length ? boundedCaseIds : unique(failures.map(item => item.test_case_id)).slice(0, MAX_TEST_CASES);
    const frozenCases = caseIds.length ? await optionalRead('frozen_cases', () => db.prepare(`SELECT snapshot.test_case_id AS id,
      snapshot.test_case_title AS title, snapshot.test_case_description AS description, snapshot.status, snapshot.priority
      FROM execution_case_snapshots snapshot JOIN executions owner ON owner.id = snapshot.execution_id
      WHERE owner.id = ? AND owner.project_id = ? AND snapshot.test_case_id IN (${placeholders(caseIds)})
      ORDER BY snapshot.sort_order, snapshot.test_case_id LIMIT ${MAX_TEST_CASES}`).all(run.id, projectId, ...caseIds)) : [];
    const frozenByCase = new Map(frozenCases.map(item => [item.id, item]));
    const missingStepCaseIds = frozenCases.filter(item => !packetsByCase.has(item.id)).map(item => item.id);
    const frozenSteps = missingStepCaseIds.length ? await optionalRead('frozen_steps', () => db.prepare(`SELECT id, test_case_id, step_order, action, expected_result, total_case_steps FROM (
      SELECT snapshot.snapshot_step_id AS id, snapshot.test_case_id, snapshot.step_order, snapshot.action, snapshot.expected_result,
        COUNT(*) OVER (PARTITION BY snapshot.test_case_id)::INTEGER AS total_case_steps,
        ROW_NUMBER() OVER (PARTITION BY snapshot.test_case_id ORDER BY snapshot.step_order, snapshot.snapshot_step_id) AS case_step_rank
      FROM execution_step_snapshots snapshot JOIN executions owner ON owner.id = snapshot.execution_id
      WHERE owner.id = ? AND owner.project_id = ? AND snapshot.test_case_id IN (${placeholders(missingStepCaseIds)})
    ) bounded_steps WHERE case_step_rank <= 30 ORDER BY test_case_id, step_order, id`).all(run.id, projectId, ...missingStepCaseIds)) : [];
    cases = caseIds.flatMap(id => {
      const packet = packetsByCase.get(id);
      const frozen = frozenByCase.get(id);
      const failure = failures.find(item => item.test_case_id === id);
      if (!frozen && !packet && !failure) return [];
      const steps = packet?.steps?.map(step => ({ id: step.id, step_order: step.order, action: step.action, expected_result: step.expected_result,
        total_case_steps: packet.coverage?.total_steps })) || frozenSteps.filter(step => step.test_case_id === id);
      return [{ ...defectReproductionService.summarizeCase({ id, title: frozen?.title || packet?.title || failure?.test_case_title || '',
        description: frozen?.description || packet?.description || '', status: frozen?.status, priority: frozen?.priority }, steps),
        source: frozen || steps.length ? 'execution_snapshot' : 'execution_result', execution_result_id: packet?.result_id || failure?.id || null }];
    });
  }
  let executionImageEvidence = { images: [], requested: 0, omitted: 0, accessRestricted: false, unavailable: false };
  try {
    executionImageEvidence = await loadExecutionImages({ user, projectId, run: failures.length ? run : null, failures, reservedImages: referenceImages,
      exactResult: Boolean(resultId || requestedCaseIds.length || scopeRequested) });
  } catch (error) {
    if (error?.name === 'AbortError' || [401, 403, 499].includes(error?.statusCode) || error?.code === 'REQUEST_CANCELLED') throw error;
    executionImageEvidence.unavailable = true;
  }

  const boundaries = {
    limits: {
      test_cases: MAX_TEST_CASES,
      suites: MAX_TEST_CASES,
      modules: MAX_TEST_CASES,
      requirements: MAX_REQUIREMENTS,
      failed_or_blocked_results: MAX_FAILURE_RESULTS,
      external_links: MAX_EXTERNAL_LINKS,
      reference_images: MAX_REFERENCE_IMAGES,
      execution_images: MAX_REFERENCE_IMAGES
    },
    requested: {
      run: runId ? 1 : 0,
      execution_result: resultId ? 1 : 0,
      test_cases: requestedCaseIds.length || liveScopeCount || unique(failures.map(item => item.test_case_id)).length,
      suites: requestedSuiteIds.length,
      modules: requestedModuleIds.length,
      requirements: requestedRequirementIds.length,
      failed_or_blocked_results: failureCount,
      execution_images: executionImageEvidence.requested
    },
    included: {
      run: run ? 1 : 0,
      execution_result: resultId && failures.some(item => item.id === resultId) ? 1 : 0,
      test_cases: cases.length,
      suites: validSuiteIds.length,
      modules: validModuleIds.length,
      requirements: requirements.length,
      failed_or_blocked_results: failures.length,
      execution_images: executionImageEvidence.images.length,
      execution_failure_details: failurePackets.length
    },
    omitted: {
      run: runId && !run ? 1 : 0,
      execution_result: resultId && !failures.some(item => item.id === resultId) ? 1 : 0,
      test_cases: Math.max(0, (requestedCaseIds.length || liveScopeCount || unique(failures.map(item => item.test_case_id)).length) - cases.length),
      suites: Math.max(0, requestedSuiteIds.length - validSuiteIds.length),
      modules: Math.max(0, requestedModuleIds.length - validModuleIds.length),
      requirements: Math.max(0, requestedRequirementIds.length - requirements.length),
      failed_or_blocked_results: Math.max(0, failureCount - failures.length),
      execution_images: executionImageEvidence.omitted,
      execution_images_unavailable: executionImageEvidence.unavailable ? 1 : 0,
      execution_image_access: executionImageEvidence.accessRestricted ? 1 : 0,
      execution_failure_details_unavailable: failureEvidenceUnavailable ? 1 : 0,
      execution_failure_sources_unavailable: failurePackets.reduce((total, packet) => total + (packet.coverage?.unavailable_sources?.length || 0), 0),
      execution_case_context_access: run && failures.length && !canReadRunCases ? 1 : 0,
      context_sources_unavailable: unavailable.length
    },
    unavailable_sources: unique([...unavailable, ...failurePackets.flatMap(packet => packet.coverage?.unavailable_sources || [])])
  };
  boundaries.partial_sources = Object.values(boundaries.omitted).some((count) => count > 0);
  return { run, cases, requirements, failures, execution_images: executionImageEvidence.images, boundaries,
    linked_test_suite_ids: validSuiteIds, linked_module_ids: validModuleIds };
};

const buildEvidenceSources = ({ input, context, imageAssets }) => {
  const sources = [];
  const add = (source) => {
    if (!source?.ref || sources.some((item) => item.ref === source.ref)) return;
    sources.push(source);
  };
  if (input.intent) add({ ref: "reporter:intent", type: "reporter-input", id: "intent", title: "Incident brief", excerpt: stripMarkup(input.intent), trust: "user-provided" });
  if (input.evidence) add({ ref: "reporter:evidence", type: "reporter-input", id: "evidence", title: "Observed evidence", excerpt: stripMarkup(input.evidence), trust: "user-provided" });
  if (input.additional_context) add({ ref: "reporter:additional-context", type: "reporter-input", id: "additional-context", title: "Additional reporter context", excerpt: stripMarkup(input.additional_context), trust: "user-provided" });
  input.external_links.forEach((url) => add({ ref: `external-link:${shortHash(url)}`, type: "external-link-pointer", id: shortHash(url), title: url, excerpt: "Pointer only; linked content was not fetched.", url, trust: "pointer-only" }));
  imageAssets.forEach((image) => add({ ref: `reference-image:${image.content_hash}`, type: "reference-image", id: image.content_hash, title: image.name, excerpt: "Reporter-provided image admitted to the bounded evidence pack.", trust: "user-provided" }));
  if (context.run) add({ ref: evidenceRef("run", context.run.id), type: "test-run", id: context.run.id, title: context.run.name || context.run.display_id || context.run.id, excerpt: stripMarkup([context.run.status, context.run.build, context.run.release].filter(Boolean).join(" · ")), status: context.run.status || null, trust: "workspace" });
  context.cases.forEach((item) => add({ ref: evidenceRef("test-case", item.id), type: "test-case", id: item.id, title: item.title || item.display_id || item.id, excerpt: stripMarkup([item.description, ...(item.reproduction_steps || []), item.expected_result].filter(Boolean).join("\n")), status: item.status || null, trust: "workspace" }));
  context.requirements.forEach((item) => add({ ref: evidenceRef("requirement", item.id), type: "requirement", id: item.id, title: item.title || item.display_id || item.id, excerpt: stripMarkup(storyExpectedBehavior(item) || item.description), status: item.status || null, trust: "workspace" }));
  context.failures.forEach((item) => add({ ref: evidenceRef("execution-result", item.id), type: "execution-result", id: item.id, title: `${item.status || "failed"} result`, excerpt: stripMarkup(failureObservationText(item)), status: item.status || null, related_id: item.test_case_id || null, trust: "workspace" }));
  (context.execution_images || []).forEach((image) => add({ ref: `execution-image:${image.content_hash}`, type: "execution-screenshot", id: image.content_hash, title: image.name, excerpt: "Screenshot captured or attached to the selected execution and sent to the vision model.", trust: "workspace" }));
  return sources;
};

const inferImpact = ({ intent, evidence, failures }) => {
  const text = `${intent} ${evidence} ${failures.map(failureObservationText).join(" ")}`;
  const criticalMatch = text.match(/\b(data loss|security breach|production down|outage|payment failure|unavailable)\b/i);
  const highMatch = text.match(/\b(crash|blocked|cannot|failure|failed|error)\b/i);
  if (criticalMatch) return { severity: "critical", priority: "Highest", signal: criticalMatch[0] };
  if (failures.length || highMatch) return { severity: "high", priority: "High", signal: highMatch?.[0] || `${failures.length} failed or blocked result${failures.length === 1 ? "" : "s"}` };
  return { severity: "medium", priority: "Medium", signal: "" };
};

const deterministicDraft = ({ input, context, evidenceSources }) => {
  const sourceRefs = new Set(evidenceSources.map((source) => source.ref));
  const refs = (...items) => unique(items.flat()).filter((ref) => sourceRefs.has(ref));
  const runRef = context.run ? evidenceRef("run", context.run.id) : null;
  const caseRefs = context.cases.map((item) => evidenceRef("test-case", item.id));
  const casesWithReproduction = context.cases.filter((item) => item.reproduction_steps?.length);
  const casesWithExpected = context.cases.filter((item) => item.expected_result);
  const requirementRefs = context.requirements.map((item) => evidenceRef("requirement", item.id));
  const failureRefs = context.failures.map((item) => evidenceRef("execution-result", item.id));
  const explicitSteps = extractLabeledSection(input.evidence, ["steps to reproduce", "reproduction steps", "steps", "repro"]);
  const explicitExpected = extractLabeledSection(input.evidence, ["expected result", "expected behavior", "expected"]);
  const explicitActual = extractLabeledSection(input.evidence, ["actual result", "observed result", "actual", "observed"]);
  const explicitEnvironment = extractLabeledSection(input.evidence, ["environment", "test environment"]);
  const explicitBuild = extractLabeledSection(input.evidence, ["build", "version"]);
  const hasStructuredReporterEvidence = Boolean(explicitSteps || explicitExpected || explicitActual || explicitEnvironment || explicitBuild);
  const caseReproduction = defectReproductionService.buildReproduction(context.cases);
  const requirementExpectationEntry = explicitExpected || casesWithExpected.length ? null : context.requirements
    .map((item) => ({ item, expectation: item.expected_section || storyExpectedBehavior(item) }))
    .find(({ expectation }) => expectation);
  const requirementExpectation = requirementExpectationEntry?.expectation || "";
  const expectationRequirement = requirementExpectationEntry?.item || null;
  const firstFailure = context.failures.find((item) => failureObservationText(item));
  const failureObservation = firstFailure ? stripMarkup(failureObservationText(firstFailure), 8_000) : "";
  const impact = inferImpact({ intent: input.intent, evidence: input.evidence, failures: context.failures });
  const messageParts = [
    input.intent,
    context.run ? `Linked run: ${context.run.name || context.run.display_id || context.run.id}${context.run.status ? ` (${context.run.status})` : ""}.` : "",
    context.cases.length ? `Linked Test Cases: ${context.cases.map((item) => item.title || item.display_id || item.id).join(", ")}.` : "",
    input.additional_context,
    input.external_links.length ? `Reporter-provided reference pointers (content not fetched):\n${input.external_links.join("\n")}` : ""
  ].filter(Boolean);
  const actualResult = explicitActual || (!hasStructuredReporterEvidence ? input.evidence : "") || failureObservation;
  const actualResultEvidence = explicitActual || (!hasStructuredReporterEvidence && input.evidence)
    ? refs("reporter:evidence")
    : firstFailure
      ? refs(evidenceRef("execution-result", firstFailure.id))
      : [];
  const fieldEvidence = {
    title: refs("reporter:intent"),
    message: refs("reporter:intent", runRef, caseRefs, "reporter:additional-context", input.external_links.map((url) => `external-link:${shortHash(url)}`)),
    steps_to_reproduce: explicitSteps ? refs("reporter:evidence") : casesWithReproduction.length ? refs(casesWithReproduction.map((item) => evidenceRef("test-case", item.id))) : [],
    expected_result: explicitExpected ? refs("reporter:evidence") : casesWithExpected.length ? refs(casesWithExpected.map((item) => evidenceRef("test-case", item.id))) : expectationRequirement ? refs(evidenceRef("requirement", expectationRequirement.id)) : [],
    actual_result: actualResultEvidence,
    severity: impact.signal ? refs("reporter:intent", "reporter:evidence", failureRefs) : [],
    priority: impact.signal ? refs("reporter:intent", "reporter:evidence", failureRefs) : [],
    environment: explicitEnvironment ? refs("reporter:evidence") : [],
    build: explicitBuild ? refs("reporter:evidence") : runRef && context.run?.build ? refs(runRef) : [],
    labels: context.failures.length ? failureRefs : [],
    rationale: refs("reporter:intent", "reporter:evidence", runRef, caseRefs, requirementRefs, failureRefs)
  };
  const draft = {
    title: normalizeText(input.intent, 180).replace(/[.\s]+$/, ""),
    message: messageParts.join("\n\n"),
    steps_to_reproduce: explicitSteps || caseReproduction.steps_to_reproduce,
    expected_result: explicitExpected || caseReproduction.expected_result || requirementExpectation,
    actual_result: actualResult,
    severity: impact.severity,
    priority: impact.priority,
    environment: explicitEnvironment,
    build: explicitBuild || context.run?.build || "",
    labels: context.failures.length ? ["execution-failure"] : [],
    rationale: `Prepared from ${evidenceSources.length} bounded evidence source${evidenceSources.length === 1 ? "" : "s"}. Missing Defect facts remain explicit for human review.`
  };
  const gaps = [];
  const addGap = (field, reason, question) => gaps.push({ field, reason, question });
  if (!draft.steps_to_reproduce) addGap("steps_to_reproduce", "No explicit reproduction steps were found in the selected evidence.", "What exact actions reproduce the problem?");
  if (!draft.expected_result) addGap("expected_result", "No explicit expected-behavior or acceptance-criteria section was found in reporter or linked Story evidence.", "What should have happened?");
  if (!draft.actual_result) addGap("actual_result", "No observed-result evidence was supplied.", "What happened instead?");
  if (!draft.environment) addGap("environment", "The selected evidence does not name an environment.", "Which environment reproduced the problem?");
  if (!draft.build) addGap("build", "The selected evidence does not identify a build or version.", "Which build or version was affected?");
  if (!impact.signal) addGap("severity", "No explicit impact signal was found; medium is a review default, not a confirmed severity.", "What user or business impact was observed?");
  if (!impact.signal) addGap("priority", "No explicit urgency signal was found; Medium is a review default, not a confirmed priority.", "How urgently should this Defect be addressed, and why?");
  return { draft, field_evidence: fieldEvidence, gaps, assumptions: [] };
};

const normalizeFieldRefs = (value, allowedRefs) => unique(value).filter((ref) => allowedRefs.has(ref));
const normalizeCandidate = (candidate, fallback, evidenceSources) => {
  const rawDraft = candidate?.draft && typeof candidate.draft === "object" ? candidate.draft : candidate || {};
  const rawFieldEvidence = candidate?.field_evidence && typeof candidate.field_evidence === "object" ? candidate.field_evidence : {};
  const allowedRefs = new Set(evidenceSources.map((source) => source.ref));
  const fallbackFields = [];
  const fieldEvidence = {};
  const chooseText = (field, max) => {
    const value = normalizeText(rawDraft[field], max);
    const refs = normalizeFieldRefs(rawFieldEvidence[field], allowedRefs);
    if (value && refs.length) {
      fieldEvidence[field] = refs;
      return value;
    }
    fallbackFields.push(field);
    fieldEvidence[field] = fallback.field_evidence[field] || [];
    return fallback.draft[field];
  };
  const severityCandidate = String(rawDraft.severity || "").toLowerCase();
  const severityRefs = normalizeFieldRefs(rawFieldEvidence.severity, allowedRefs);
  const severity = allowedSeverity.has(severityCandidate) && severityRefs.length
    ? (fieldEvidence.severity = severityRefs, severityCandidate)
    : (fallbackFields.push("severity"), fieldEvidence.severity = fallback.field_evidence.severity || [], fallback.draft.severity);
  const priorityCandidate = normalizePriority(rawDraft.priority, "");
  const priorityRefs = normalizeFieldRefs(rawFieldEvidence.priority, allowedRefs);
  const priority = allowedPriority.has(priorityCandidate) && priorityRefs.length
    ? (fieldEvidence.priority = priorityRefs, priorityCandidate)
    : (fallbackFields.push("priority"), fieldEvidence.priority = fallback.field_evidence.priority || [], fallback.draft.priority);
  const labels = normalizeReferenceList(rawDraft.labels).slice(0, 20);
  const labelRefs = normalizeFieldRefs(rawFieldEvidence.labels, allowedRefs);
  const groundedLabels = labels.length && labelRefs.length;
  if (!groundedLabels) fallbackFields.push("labels");
  fieldEvidence.labels = groundedLabels ? labelRefs : fallback.field_evidence.labels || [];
  const draft = {
    title: chooseText("title", 180),
    message: chooseText("message", 18_000),
    steps_to_reproduce: chooseText("steps_to_reproduce", 12_000),
    expected_result: chooseText("expected_result", 8_000),
    actual_result: chooseText("actual_result", 8_000),
    severity,
    priority,
    environment: chooseText("environment", 500),
    build: chooseText("build", 500),
    labels: groundedLabels ? labels : fallback.draft.labels,
    rationale: chooseText("rationale", 2_000)
  };
  const candidateGaps = (Array.isArray(candidate?.gaps) ? candidate.gaps : [])
    .map((gap) => ({ field: normalizeText(gap?.field, 80), reason: normalizeText(gap?.reason, 500), question: normalizeText(gap?.question, 500) }))
    .filter((gap) => DRAFT_FIELDS.includes(gap.field) && gap.reason);
  const missingGaps = fallback.gaps.filter((gap) => !draft[gap.field] || fallbackFields.includes(gap.field));
  const assumptions = unique((Array.isArray(candidate?.assumptions) ? candidate.assumptions : []).map((item) => normalizeText(item, 500))).slice(0, 12);
  return {
    draft,
    field_evidence: fieldEvidence,
    gaps: [...candidateGaps, ...missingGaps].filter((gap, index, items) => items.findIndex((item) => item.field === gap.field && item.reason === gap.reason) === index),
    assumptions,
    fallback_fields: unique(fallbackFields)
  };
};

const requestLlmDraft = async (integration, input, context, evidenceSources, images = [], { compact = false, canonicalFields = {} } = {}) => {
  const allowedRefs = evidenceSources.map((source) => source.ref);
  const modelContext = { ...context, cases: context.cases.map(item => item.steps?.length
    ? { ...item, reproduction_steps: undefined, expected_result: undefined } : item) };
  const visualEvidenceMap = images.map((image, index) => {
    const executionImage = (context.execution_images || []).find((item) => item.content_hash === image.content_hash);
    const ref = executionImage ? `execution-image:${image.content_hash}` : `reference-image:${image.content_hash}`;
    return `Image part ${index + 1} supports ${ref} (${image.name || "unnamed image"}).`;
  });
  const prompt = [
    compact ? "Compact completion retry: the previous response reached its output limit. Return the complete agreed JSON object only. Do not explain your analysis or repeat evidence excerpts. Keep message and rationale brief, keep actual results to observed facts, and use the shortest valid evidence refs. For each host-owned canonical field below, return its exact short source-reference placeholder as the draft value and its evidence_refs as the matching field_evidence. HelloTest restores the full source text after native contract validation. These known fields are not evidence gaps. Never invent or expand source actions. Keep gaps focused on genuinely missing facts. The same complete evidence and screenshots are attached." : "Output concision: return only the agreed JSON object. Summarize evidence instead of repeating it. Preserve supplied Test Case actions in order in steps_to_reproduce without expanding them. Keep message, rationale, expected/actual results, gaps, and assumptions concise.",
    compact && Object.keys(canonicalFields).length ? `Host-owned canonical fields:\n${JSON.stringify(canonicalFields)}` : '',
    aiInstructionBlock("ai.bug.draft", "aiBugDraft.service.js.prompt.final.1"),
    images.length && !hasWrittenIncident(input, context)
      ? aiInstructionBlock("ai.bug.draft", "aiBugDraft.imageOnlyContext")
      : "",
    visualEvidenceMap.length ? `Visual evidence is attached after this prompt in the same order listed here. Cite only the matching allowed source ref. Use the recorded step/status for chronology: earlier passed-step images do not establish the later failed state, and an image establishes only what is visible in it.\n${visualEvidenceMap.join("\n")}` : "",
    input.prompt_guidance ? `Workspace editorial guidance (lower priority than the evidence rules above):\n${input.prompt_guidance}` : "",
    [aiInstructionBlock("ai.bug.draft", "aiBugDraft.service.prompt.segment.1"),String(JSON.stringify(allowedRefs)),""].join(''),
    aiInstructionBlock("ai.bug.draft", "aiBugDraft.service.js.prompt.final.6"),
    [aiInstructionBlock("ai.bug.draft", "aiBugDraft.service.prompt.segment.2"),String(JSON.stringify({ ...input, prompt_guidance: undefined })),""].join(''),
    // Source excerpts duplicate the bounded record snapshot and reporter input.
    // Keep their refs and identity; include each evidence body only once.
    [aiInstructionBlock("ai.bug.draft", "aiBugDraft.service.prompt.segment.3"),String(JSON.stringify({ context: modelContext, evidence_sources: evidenceSources.map(({ excerpt, ...source }) => source) })),""].join('')
  ].filter(Boolean).join("\n\n");
  const userContent = imageUserContent(prompt, images);
  const baseUrl = String(integration.base_url || "https://api.openai.com/v1").replace(/\/+$/, "");
  const url = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
  const response = await fetchLlmWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(integration.api_key ? { Authorization: `Bearer ${integration.api_key}` } : {}) },
    body: JSON.stringify({
      model: integration.model,

      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: [aiInstructionBlock("ai.bug.draft", "aiBugDraft.response.1"), compact ? "For this compact retry, preserve every required key and exact evidence grounding while writing the shortest complete valid values. Use the supplied short source-reference placeholders for host-owned canonical fields; HelloTest restores their source text after validation." : "Use concise values. Do not restate the supplied records."].join("\n") },
        { role: "user", content: userContent }
      ]
    })
  }, { integration, operation: "bug-draft.generate", contextRetrievalQuery: defectRetrievalQuery(input, context, images) });
  if (!response.ok) throw createLlmProviderError({ status: response.status, headers: response.headers, detail: await response.text() });
  try {
    const payload = await response.json();
    if (["length", "max_tokens"].includes(payload?.choices?.[0]?.finish_reason)) {
      throw Object.assign(new Error("The model reached its output limit before completing the Defect proposal."), { statusCode: 502, code: "AI_OUTPUT_TRUNCATED" });
    }
    return extractJson(getCompletionContent(payload));
  } catch (error) {
    if (error?.code === 'AI_OUTPUT_TRUNCATED') throw error;
    const message = "The model returned an incomplete or unreadable Defect proposal. Retry with a smaller scope or choose another configured model. No Defect was created.";
    throw Object.assign(new Error(message), { statusCode: 502, code: "AI_DEFECT_RESPONSE_INVALID", publicMessage: message });
  }
};

const buildProcessingSnapshot = ({ evidenceSources, generationMode, gaps, fallbackFields, partialSources }) => ({
  active_stage_id: "review",
  completed_stage_count: 3,
  total_stage_count: 4,
  status_label: "Awaiting human review",
  stages: [
    { id: "intake", status: "complete", detail: "Incident brief and requested Defect boundary were validated.", evidence: "Reporter intent is retained as evidence, not treated as executable instruction.", item_count: 1 },
    { id: "context", status: "complete", detail: `${evidenceSources.length} bounded evidence source${evidenceSources.length === 1 ? "" : "s"} assembled${partialSources ? " with disclosed omissions" : ""}.`, evidence: "Only validated project records, reporter inputs, image assets, and pointer-only links were included.", item_count: evidenceSources.length },
    { id: "specialist", status: "complete", detail: `${generationMode === "llm" ? "Model-assisted" : generationMode === "hybrid" ? "Hybrid" : "Deterministic"} Defect proposal validated against the output contract.`, evidence: `${fallbackFields.length} field${fallbackFields.length === 1 ? "" : "s"} used deterministic fallback; ${gaps.length} evidence gap${gaps.length === 1 ? "" : "s"} remain explicit.`, item_count: DRAFT_FIELDS.length },
    { id: "review", status: "current", detail: "Proposal is ready for field-by-field human review.", evidence: "Nothing has been created or written back. Accepting only moves the proposal into the manual Defect form." }
  ]
});

exports.preview = async ({ user, project_id, intent, evidence, additional_context, external_links, reference_photos, linked_test_run_id, linked_execution_result_id, linked_test_case_ids, linked_test_suite_ids, linked_module_ids, linked_requirement_ids, integration_id, prompt_guidance, require_case_context = false } = {}) => {
  const projectId = normalizeText(project_id, 255);
  const normalizedIntent = normalizeText(intent, 4_000);
  if (!projectId) throw Object.assign(new Error("project_id is required"), { statusCode: 400 });
  if (linked_execution_result_id && !linked_test_run_id) throw Object.assign(new Error("Select the Test Run for the requested execution result."), { statusCode: 400 });
  const project = await db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) throw new Error("Project not found");
  const requestedExternalLinks = normalizeReferenceList(external_links);
  const requestedReferenceImages = Array.isArray(reference_photos) ? reference_photos : [];
  const imageAssets = normalizeImageAssets(reference_photos);
  const input = {
    intent: normalizedIntent,
    evidence: normalizeText(evidence, 12_000),
    additional_context: normalizeText(additional_context, 12_000),
    external_links: normalizeExternalLinks(external_links),
    reference_photos: imageAssets.map((image) => ({ name: image.name, content_hash: image.content_hash })),
    linked_test_run_id: normalizeText(linked_test_run_id, 255),
    linked_execution_result_id: normalizeText(linked_execution_result_id, 255),
    linked_test_case_ids: unique(normalizeReferenceList(linked_test_case_ids)),
    linked_test_suite_ids: unique(normalizeReferenceList(linked_test_suite_ids)),
    linked_module_ids: unique(normalizeReferenceList(linked_module_ids)),
    linked_requirement_ids: unique(normalizeReferenceList(linked_requirement_ids)),
    prompt_guidance: normalizeText(prompt_guidance, 4_000)
  };
  const rawContext = await loadEvidence({
    user,
    projectId,
    runId: input.linked_test_run_id,
    resultId: input.linked_execution_result_id,
    testCaseIds: input.linked_test_case_ids,
    suiteIds: input.linked_test_suite_ids,
    moduleIds: input.linked_module_ids,
    requirementIds: input.linked_requirement_ids,
    referenceImages: imageAssets
  });
  if (require_case_context && !rawContext.cases.length) throw Object.assign(new Error("Selected Test Case context is unavailable in this project. Choose an accessible Test Case."), { statusCode: 400 });
  if (!input.intent && !input.evidence && !input.additional_context && !imageAssets.length && !rawContext.run && !rawContext.cases.length && !rawContext.requirements.length) {
    const message = "Describe the observed problem, attach a screenshot, or select accessible Test Case, Story or run evidence before drafting a Defect. External links alone are reference pointers; their content is not read.";
    throw Object.assign(new Error(message), { statusCode: 400, code: "AI_DEFECT_EVIDENCE_REQUIRED", publicMessage: message });
  }
  rawContext.boundaries.requested.external_links = requestedExternalLinks.length;
  rawContext.boundaries.requested.reference_images = requestedReferenceImages.length;
  rawContext.boundaries.included.external_links = input.external_links.length;
  const admittedImages = normalizeReferenceImages([...imageAssets, ...rawContext.execution_images]);
  const admittedExecutionImages = admittedImages.filter((image) => rawContext.execution_images.some((candidate) => candidate.content_hash === image.content_hash));
  rawContext.boundaries.included.reference_images = imageAssets.length;
  rawContext.boundaries.omitted.external_links = Math.max(0, requestedExternalLinks.length - input.external_links.length);
  rawContext.boundaries.omitted.reference_images = Math.max(0, requestedReferenceImages.length - imageAssets.length);
  rawContext.boundaries.included.execution_images = admittedExecutionImages.length;
  rawContext.boundaries.omitted.execution_images = Math.max(rawContext.boundaries.requested.execution_images - admittedExecutionImages.length, rawContext.boundaries.omitted.execution_images || 0);
  const evidenceSources = buildEvidenceSources({ input, context: { ...rawContext, execution_images: admittedExecutionImages }, imageAssets });
  const promptContext = buildPromptContextSnapshot(rawContext);
  const context = {
    run: promptContext.run,
    cases: promptContext.cases,
    requirements: promptContext.requirements,
    failures: promptContext.failures,
    execution_images: promptContext.execution_images,
    boundaries: {
      ...rawContext.boundaries,
      content_limits: promptContext.content_limits,
      content_omissions: promptContext.content_omissions,
      partial_sources: Object.values(rawContext.boundaries.omitted).some((count) => count > 0) || promptContext.partial_sources
    }
  };
  const deterministic = deterministicDraft({ input, context, evidenceSources });
  let normalized = { ...deterministic, fallback_fields: [...DRAFT_FIELDS] };
  let integration = null;
  let providerError = null;
  let providerFailure = null;
  try {
    integration = await aiLlmSelectionService.resolveLlmIntegrationForUsage({ integrationId: integration_id, userId: user?.id, usageKey: BUG_DRAFT_USAGE_KEY, projectId, fallback: "project-then-global", allowMissing: true });
    if (integration) {
      let candidate, restoredFields = [];
      try {
        candidate = await requestLlmDraft(integration, input, context, evidenceSources, admittedImages);
      } catch (error) {
        if (error?.code !== "AI_OUTPUT_TRUNCATED") throw error;
        const canonicalFields = Object.fromEntries(['steps_to_reproduce', 'expected_result']
          .filter(field => deterministic.draft[field] && deterministic.field_evidence[field]?.length)
          .map(field => [field, { value: `source:${deterministic.field_evidence[field][0]}`, evidence_refs: deterministic.field_evidence[field] }]));
        candidate = await requestLlmDraft(integration, input, context, evidenceSources, admittedImages, { compact: true, canonicalFields });
        if (candidate?.draft && typeof candidate.draft === 'object' && !Array.isArray(candidate.draft)) {
          restoredFields = Object.keys(canonicalFields);
          candidate = { ...candidate, draft: { ...candidate.draft }, field_evidence: { ...candidate.field_evidence } };
          for (const field of restoredFields) {
            candidate.draft[field] = deterministic.draft[field];
            candidate.field_evidence[field] = deterministic.field_evidence[field];
          }
        }
      }
      normalized = normalizeCandidate(candidate, deterministic, evidenceSources);
      normalized.fallback_fields = unique([...normalized.fallback_fields, ...restoredFields]);
    }
  } catch (error) {
    if (error?.code === "AI_OUTPUT_TRUNCATED") {
      const message = "The selected model reached its output limit, including on a compact retry. Select fewer linked records or increase this feature’s output-token limit, then try again. No Defect draft was generated.";
      throw Object.assign(new Error(message), { statusCode: 502, code: "AI_OUTPUT_TRUNCATED", publicMessage: message });
    }
    else {
      if (error?.publicMessage) {
        error.message = error.publicMessage;
        throw error;
      }
      if (['AI_VISION_UNSUPPORTED', 'AI_MCP_QUERY_REQUIRED', 'LLM_AUTHENTICATION_FAILED', 'LLM_QUOTA_EXCEEDED', 'LLM_RATE_LIMITED', 'LLM_RATE_LIMIT_REQUEST_TOO_LARGE', 'LLM_REQUEST_TOO_LARGE'].includes(error?.code)) throw error;
      if (admittedImages.length && !hasWrittenIncident(input, context) && error?.code === 'AI_NATIVE_CONTRACT_INVALID') {
        const message = "The screenshot did not provide enough evidence for a valid Defect proposal. Describe what is wrong and what should happen, or attach a clearer screenshot. No Defect was created.";
        throw Object.assign(new Error(message), { statusCode: 422, code: "AI_DEFECT_EVIDENCE_REQUIRED", publicMessage: message });
      }
      if (error?.code === 'AI_NATIVE_CONTRACT_INVALID') {
        const fields = unique((error.validation_errors || []).map(item => item?.field).filter(field => DRAFT_FIELDS.includes(field)));
        const message = `The model returned Defect details that still do not match the required format${fields.length ? ` (${fields.join(', ')})` : ''}. Retry or select another configured LLM. Your saved work is unchanged.`;
        throw Object.assign(new Error(message, { cause: error }), { statusCode: 502, code: 'AI_DEFECT_RESPONSE_INVALID', publicMessage: message });
      }
      providerFailure = error instanceof Error ? error : new Error('LLM generation failed.');
      providerError = error instanceof Error ? error.message : "LLM generation failed.";
      normalized = { ...deterministic, fallback_fields: [...DRAFT_FIELDS] };
    }
  }
  if (integration && !providerError && (!normalized.draft.title || normalized.fallback_fields.length === DRAFT_FIELDS.length)) {
    const message = admittedImages.length && !hasWrittenIncident(input, context)
      ? "The model did not identify a Defect supported by the screenshot and selected evidence. Describe the visible problem and expected outcome, or attach a clearer screenshot. No Defect was created."
      : "The model did not identify a Defect supported by the supplied evidence. Add an observed problem or relevant failure evidence and retry. No Defect was created.";
    throw Object.assign(new Error(message), { statusCode: 422, code: "AI_DEFECT_EVIDENCE_REQUIRED", publicMessage: message });
  }
  try {
    requireAiAssessment({ integration, failed: Boolean(providerError), accepted: normalized.fallback_fields.length < DRAFT_FIELDS.length });
  } catch (error) {
    if (providerFailure) error.cause = providerFailure;
    throw error;
  }
  const generationMode = !integration || providerError ? "deterministic" : normalized.fallback_fields.length ? "hybrid" : "llm";
  const fallbackReason = providerError
    || (!integration ? "No active LLM integration is configured." : normalized.fallback_fields.length ? "Some model fields were missing, invalid, or lacked allowed evidence refs and were replaced with evidence-bound deterministic values." : null);
  const now = new Date().toISOString();
  const citations = evidenceSources
    .filter((source) => ["test-run", "test-case", "requirement", "execution-result", "execution-screenshot"].includes(source.type))
    .map((source) => ({ type: source.type, id: source.id, title: source.title }));
  const evidenceSnapshot = {
    input,
    sources: evidenceSources.map(({ ref, type, id, title, excerpt, status, trust }) => ({ ref, type, id, title, excerpt, status, trust })),
    context: { run: context.run, cases: context.cases, requirements: context.requirements, failures: context.failures, execution_images: context.execution_images },
    boundaries: context.boundaries
  };
  const processing = buildProcessingSnapshot({
    evidenceSources,
    generationMode,
    gaps: normalized.gaps,
    fallbackFields: normalized.fallback_fields,
    partialSources: context.boundaries.partial_sources
  });
  const fallbackUsed = generationMode !== "llm";
  return {
    draft: {
      ...normalized.draft,
      linked_test_run_id: context.run?.id || "",
      linked_test_case_ids: context.cases.map((item) => item.id),
      linked_test_suite_ids: rawContext.linked_test_suite_ids,
      linked_module_ids: rawContext.linked_module_ids,
      linked_requirement_ids: context.requirements.map((item) => item.id)
    },
    citations,
    evidence_sources: evidenceSources,
    field_evidence: normalized.field_evidence,
    gaps: normalized.gaps,
    assumptions: normalized.assumptions,
    boundaries: context.boundaries,
    fallback_fields: normalized.fallback_fields,
    processing,
    provenance: {
      capability: "ai-bug-draft",
      generation_mode: generationMode,
      provider: integration?.name || "HelloTest evidence graph",
      model: integration?.model || null,
      request_id: `bug-draft-${Date.now()}`,
      input_fingerprint: fingerprint(evidenceSnapshot),
      generated_at: now,
      confidence: 0,
      confidence_basis: "not-scored; review evidence coverage and gaps",
      evidence: evidenceSources.map((item) => item.ref),
      fallback_used: fallbackUsed,
      fallback_reason: fallbackReason,
      fallback_fields: normalized.fallback_fields,
      partial_sources: context.boundaries.partial_sources,
      requires_human_review: true
    }
  };
};

exports._private = {
  BUG_DRAFT_USAGE_KEY,
  buildEvidenceSources,
  deterministicDraft,
  normalizeCandidate,
  extractLabeledSection,
  extractHeadedSection,
  buildPromptContextSnapshot,
  loadEvidence,
  BUG_DRAFT_CONTEXT_LIMITS
};
