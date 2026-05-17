const integrationService = require("./integration.service");
const testCaseService = require("./testCase.service");
const aiKnowledgeService = require("./aiKnowledge.service");
const { normalizeStoredReferenceList } = require("../utils/externalReferences");
const { createLlmProviderError } = require("../utils/upstreamLlmError");

const DEFAULT_CASE_LIMIT = 8;

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
};

const normalizeTextList = (values = []) => {
  const collection = Array.isArray(values) ? values : [values];
  return collection.map((value) => normalizeText(value)).filter(Boolean);
};

const uniqueById = (items = []) => Array.from(new Map(items.filter(Boolean).map((item) => [item.id, item])).values());

const normalizeImageAssets = (images = []) => {
  if (!Array.isArray(images)) {
    return [];
  }

  return images
    .map((item, index) => ({
      name: normalizeText(item?.name) || `Reference image ${index + 1}`,
      url: normalizeText(item?.url)
    }))
    .filter((item) => item.url);
};

const buildRequirementReferenceMap = (requirements = []) =>
  uniqueById(requirements).map((requirement, index) => ({
    id: requirement.id,
    title: requirement.title,
    description: requirement.description || null,
    ref: `R${index + 1}`
  }));

const extractJsonPayload = (content) => {
  const trimmed = String(content || "").trim();

  if (!trimmed) {
    throw new Error("LLM response was empty");
  }

  const withoutFence = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
    : trimmed;
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");

  const jsonCandidate =
    firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace
      ? withoutFence.slice(firstBrace, lastBrace + 1)
      : withoutFence;

  try {
    return JSON.parse(jsonCandidate);
  } catch {
    throw new Error("Unable to parse JSON from the LLM response");
  }
};

const normalizeSteps = (steps = []) => {
  if (!Array.isArray(steps)) {
    return [];
  }

  return steps
    .map((step, index) => ({
      step_order: Number.isFinite(Number(step?.step_order)) ? Number(step.step_order) : index + 1,
      action: normalizeText(step?.action),
      expected_result: normalizeText(step?.expected_result || step?.expectedResult)
    }))
    .filter((step) => step.action || step.expected_result)
    .map((step, index) => ({
      ...step,
      step_order: index + 1
    }));
};

const normalizeRequirementRefs = (item = {}) => {
  const raw =
    item?.requirement_ids ||
    item?.requirementIds ||
    item?.requirement_refs ||
    item?.requirementRefs ||
    [];

  if (Array.isArray(raw)) {
    return normalizeTextList(raw).map((value) => value.toUpperCase());
  }

  return normalizeTextList(String(raw).split(",")).map((value) => value.toUpperCase());
};

const normalizeRequirementTitles = (item = {}) => {
  const raw = item?.requirement_titles || item?.requirementTitles || item?.requirements || [];

  if (Array.isArray(raw)) {
    return normalizeTextList(raw).map((value) => value.toLowerCase());
  }

  return normalizeTextList(String(raw).split(",")).map((value) => value.toLowerCase());
};

const resolveCaseRequirements = (item, requirements = []) => {
  const uniqueRequirements = uniqueById(requirements);

  if (!uniqueRequirements.length) {
    return [];
  }

  const explicitIds = normalizeTextList(item?.requirement_ids || item?.requirementIds || []);
  const resolvedById = uniqueRequirements.filter((requirement) => explicitIds.includes(requirement.id));

  if (resolvedById.length) {
    return resolvedById;
  }

  const referenceMap = new Map(buildRequirementReferenceMap(uniqueRequirements).map((requirement) => [requirement.ref.toUpperCase(), requirement]));
  const resolvedByRef = normalizeRequirementRefs(item)
    .map((ref) => referenceMap.get(ref))
    .filter(Boolean)
    .map((match) => uniqueRequirements.find((requirement) => requirement.id === match.id))
    .filter(Boolean);

  if (resolvedByRef.length) {
    return uniqueById(resolvedByRef);
  }

  const titleMatches = normalizeRequirementTitles(item);
  const resolvedByTitle = uniqueRequirements.filter((requirement) => titleMatches.includes(String(requirement.title || "").trim().toLowerCase()));

  if (resolvedByTitle.length) {
    return resolvedByTitle;
  }

  if (uniqueRequirements.length === 1) {
    return [uniqueRequirements[0]];
  }

  return [];
};

const normalizeCaseDraft = (item, index, { requirements = [], requireRequirementMapping = false, applicableDomain = null } = {}) => {
  const title = normalizeText(item?.title);

  if (!title) {
    throw new Error(`Generated test case ${index + 1} is missing a title`);
  }

  const resolvedRequirements = resolveCaseRequirements(item, requirements);

  if (requireRequirementMapping && !resolvedRequirements.length) {
    throw new Error(`Generated test case ${index + 1} must be linked to at least one requirement`);
  }

  return {
    title,
    description: normalizeText(item?.description),
    priority: Number.isFinite(Number(item?.priority)) ? Number(item.priority) : 3,
    applicable_domain: normalizeText(item?.applicable_domain || item?.applicableDomain || item?.domain) || applicableDomain,
    requirement_ids: resolvedRequirements.map((requirement) => requirement.id),
    requirement_titles: resolvedRequirements.map((requirement) => requirement.title),
    steps: normalizeSteps(item?.steps)
  };
};

const normalizeGeneratedCases = (payload, maxCases, requirements) => {
  const applicableDomain = normalizeText(payload?.applicable_domain || payload?.applicableDomain || payload?.domain);
  const collection = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.testCases)
      ? payload.testCases
      : Array.isArray(payload?.test_cases)
        ? payload.test_cases
        : [];

  if (!collection.length) {
    throw new Error("LLM did not return any test cases");
  }

  return collection.slice(0, maxCases).map((item, index) => normalizeCaseDraft(item, index, { requirements, applicableDomain }));
};

const buildPrompt = ({ requirements, appType, maxCases, additionalContext, externalLinks, images, knowledge }) => {
  const references = buildRequirementReferenceMap(requirements);
  const prompt = [
    "Design high-quality QA test cases for the following product requirements.",
    "Use the requirement title and description as the default source of truth, then blend in any app context, user guidance, links, or image labels below.",
    "First identify the most applicable testing domain for this requirement set, then generate cases that fit that domain.",
    "",
    "Requirements to cover:"
  ];

  references.forEach((requirement) => {
    prompt.push(`- ${requirement.ref}: ${requirement.title}`);
    prompt.push(`  Description: ${requirement.description || "No description provided."}`);
  });

  prompt.push("");
  prompt.push(`Application type: ${appType.name} (${appType.type})`);

  if (additionalContext) {
    prompt.push("");
    prompt.push("Additional testing context from the user:");
    prompt.push(additionalContext);
  }

  if (knowledge && knowledge.length > 0) {
    prompt.push("");
    prompt.push("AI Knowledge Repo (Domain rules, established flows, and reference material):");
    knowledge.forEach((k) => {
      prompt.push(`- [${k.title}]: ${k.content}`);
    });
  }

  if (externalLinks.length) {
    prompt.push("");
    prompt.push("External links supplied by the user. Treat them as references even if their contents are not fetched:");
    externalLinks.forEach((link, index) => {
      prompt.push(`- Link ${index + 1}: ${link}`);
    });
  }

  if (images.length) {
    prompt.push("");
    prompt.push("Reference images are attached to this request. Use them when the selected model supports image input.");
    images.forEach((image, index) => {
      prompt.push(`- Image ${index + 1}: ${image.name}`);
    });
  }

  prompt.push("");
  prompt.push(`Return up to ${maxCases} test cases as strict JSON with this exact processable shape:`);
  prompt.push("{");
  prompt.push('  "applicable_domain": "authentication | payments | ecommerce | reporting | workflow | integration | mobile | api | data | security | performance | accessibility | general",');
  prompt.push('  "testCases": [');
  prompt.push("    {");
  prompt.push('      "title": "string",');
  prompt.push('      "description": "string",');
  prompt.push('      "priority": 1,');
  prompt.push('      "applicable_domain": "string",');
  prompt.push('      "requirement_refs": ["R1"],');
  prompt.push('      "steps": [');
  prompt.push("        {");
  prompt.push('          "action": "string",');
  prompt.push('          "expected_result": "string"');
  prompt.push("        }");
  prompt.push("      ]");
  prompt.push("    }");
  prompt.push("  ]");
  prompt.push("}");
  prompt.push("");
  prompt.push("Guidance for Local LLM:");
  prompt.push("- Pick the applicable_domain from the requirement intent, business process, data handled, integrations, platform type, and risk profile.");
  prompt.push("- Focus deeply on edge cases: generate extreme negative conditions, concurrency limits, and state transitions.");
  prompt.push("- Since this is a local integration, aggressively test security boundaries and destructive actions.");
  prompt.push("- Cover happy path, validation, edge conditions, negative conditions, and operational risk where relevant.");
  prompt.push("- Prefer crisp manual test cases with clear preconditions embedded in the first step when needed.");
  prompt.push("- Make every step executable: one action, one observable expected result, no vague statements like verify properly.");
  prompt.push("- Keep titles concise and reusable across suites.");
  prompt.push("- Use 1-5 priority where 1 is most critical.");
  prompt.push("- Each generated case must include one or more requirement_refs from the provided requirement list.");
  prompt.push("- Multiple requirements can appear on the same case only when the scenario genuinely covers them together.");
  prompt.push("- Do not include markdown or commentary outside the JSON.");

  return prompt.join("\n");
};

const resolveIntegration = async (integration_id) => {
  const integration = integration_id
    ? await integrationService.getIntegration(integration_id)
    : await integrationService.getActiveIntegrationByType("llm");

  if (!integration) {
    throw new Error("No active LLM integration is configured");
  }

  if (integration.type !== "llm") {
    throw new Error("Selected integration is not an LLM integration");
  }

  if (!integration.is_active) {
    throw new Error("Selected LLM integration is inactive");
  }

  return integration;
};

const requestChatCompletion = async ({ integration, content }) => {
  const baseUrl = (integration.base_url || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${integration.api_key}`
    },
    body: JSON.stringify({
      model: integration.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "You are a senior QA architect. Return strict JSON only."
        },
        {
          role: "user",
          content
        }
      ]
    })
  });

  if (!response.ok) {
    const raw = await response.text();
    const retryAfter = Number(response.headers.get("retry-after"));
    throw createLlmProviderError({
      status: response.status,
      detail: raw,
      retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : undefined
    });
  }

  const payload = await response.json();
  const messageContent = payload?.choices?.[0]?.message?.content;

  if (!messageContent) {
    throw new Error("LLM response did not include generated content");
  }

  return messageContent;
};

const requestGeneratedCases = async ({
  integration,
  requirements,
  appType,
  maxCases,
  additionalContext,
  externalLinks,
  images,
  knowledge
}) => {
  const prompt = buildPrompt({
    requirements,
    appType,
    maxCases,
    additionalContext,
    externalLinks,
    images,
    knowledge
  });

  try {
    const content = images.length
      ? await requestChatCompletion({
          integration,
          content: [
            { type: "text", text: prompt },
            ...images.map((image) => ({
              type: "image_url",
              image_url: {
                url: image.url
              }
            }))
          ]
        })
      : await requestChatCompletion({ integration, content: prompt });

    return normalizeGeneratedCases(extractJsonPayload(content), maxCases, requirements);
  } catch (error) {
    if (!images.length || ![400, 415, 422].includes(Number(error?.statusCode || 0))) {
      throw error;
    }

    const fallbackPrompt = [
      prompt,
      "",
      "The selected model rejected direct image input. The following image labels were supplied by the user instead:",
      ...images.map((image, index) => `- Image ${index + 1}: ${image.name}`)
    ].join("\n");

    const content = await requestChatCompletion({ integration, content: fallbackPrompt });
    return normalizeGeneratedCases(extractJsonPayload(content), maxCases, requirements);
  }
};

const normalizeAcceptedCases = (cases = [], requirements = []) => {
  if (!Array.isArray(cases) || !cases.length) {
    throw new Error("At least one generated test case is required");
  }

  return cases.map((item, index) => normalizeCaseDraft(item, index, { requirements, requireRequirementMapping: true }));
};

exports.previewRequirementsTestCases = async ({
  requirements,
  appType,
  integration_id,
  max_cases,
  additional_context,
  external_links,
  images
}) => {
  const scopedRequirements = uniqueById(requirements);

  if (!scopedRequirements.length) {
    throw new Error("At least one requirement is required");
  }

  const maxCases = Number.isFinite(Number(max_cases))
    ? Math.max(1, Math.min(Number(max_cases), 20))
    : DEFAULT_CASE_LIMIT;
  const additionalContext = normalizeText(additional_context);
  const externalLinks = normalizeTextList(external_links);
  const normalizedImages = normalizeImageAssets(images);
  const integration = await resolveIntegration(integration_id);
  const knowledge = await aiKnowledgeService.getActiveKnowledgeForLLM(scopedRequirements[0].project_id, appType.id);
  
  const generatedCases = await requestGeneratedCases({
    integration,
    requirements: scopedRequirements,
    appType,
    maxCases,
    additionalContext,
    externalLinks,
    images: normalizedImages,
    knowledge
  });

  return {
    integration: {
      id: integration.id,
      name: integration.name,
      type: integration.type,
      model: integration.model
    },
    requirements: scopedRequirements.map((requirement) => ({
      id: requirement.id,
      title: requirement.title
    })),
    app_type: {
      id: appType.id,
      name: appType.name
    },
    generated: generatedCases.length,
    cases: generatedCases.map((candidate, index) => ({
      ...candidate,
      client_id: `draft-${index + 1}`,
      step_count: candidate.steps.length
    }))
  };
};

exports.previewRequirementTestCases = async ({
  requirement,
  appType,
  integration_id,
  max_cases,
  additional_context,
  external_links,
  images
}) => {
  const preview = await exports.previewRequirementsTestCases({
    requirements: [requirement],
    appType,
    integration_id,
    max_cases,
    additional_context,
    external_links,
    images
  });

  return {
    ...preview,
    requirement: {
      id: requirement.id,
      title: requirement.title
    }
  };
};

exports.acceptGeneratedTestCases = async ({
  requirements,
  appType,
  status = "draft",
  cases = []
}) => {
  const scopedRequirements = uniqueById(requirements);
  const acceptedCases = normalizeAcceptedCases(cases, scopedRequirements);
  const created = [];

  for (const candidate of acceptedCases) {
    const candidateRequirements = scopedRequirements.filter((requirement) => candidate.requirement_ids.includes(requirement.id));
    const externalReferences = [
      ...new Set(candidateRequirements.flatMap((requirement) => normalizeStoredReferenceList(requirement.external_references)))
    ];
    const response = await testCaseService.createTestCase({
      app_type_id: appType.id,
      title: candidate.title,
      description: candidate.description || undefined,
      external_references: externalReferences,
      priority: candidate.priority,
      status,
      requirement_ids: candidate.requirement_ids,
      steps: candidate.steps
    });

    created.push({
      id: response.id,
      title: candidate.title,
      step_count: candidate.steps.length,
      requirement_ids: candidate.requirement_ids
    });
  }

  return {
    accepted: created.length,
    created
  };
};

exports.acceptRequirementTestCases = async ({
  requirement,
  appType,
  status = "draft",
  cases = []
}) => {
  return exports.acceptGeneratedTestCases({
    requirements: [requirement],
    appType,
    status,
    cases: cases.map((candidate) => ({
      ...candidate,
      requirement_ids: [requirement.id]
    }))
  });
};

exports.generateRequirementTestCases = async ({
  requirement,
  appType,
  integration_id,
  max_cases,
  status = "draft",
  additional_context,
  external_links,
  images
}) => {
  const preview = await exports.previewRequirementTestCases({
    requirement,
    appType,
    integration_id,
    max_cases,
    additional_context,
    external_links,
    images
  });

  const accepted = await exports.acceptRequirementTestCases({
    requirement,
    appType,
    status,
    cases: preview.cases
  });

  return {
    integration: preview.integration,
    generated: accepted.accepted,
    created: accepted.created
  };
};
