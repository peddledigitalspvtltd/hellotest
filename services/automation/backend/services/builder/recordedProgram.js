// recordedProgram: cohesive builder implementation; dependencies are explicit lazy ports.
function createRecordedProgram(ports) {
const exports = ports.exports;
const require = ports.require;


const normalizeCapturedActions = (actions = []) =>
  (Array.isArray(actions) ? actions : [])
    .map((action, index) => ({
      index: Number.isFinite(Number(action?.index)) ? Number(action.index) : index + 1,
      type: ports.normalizeText(action?.type) || "action",
      url: ports.normalizeText(action?.url),
      locator: ports.normalizeText(action?.locator),
      text: ports.normalizeText(action?.text),
      value: typeof action?.value === 'string' ? action.value.replace(/\r\n/g, '\n') : null,
      page_id: ports.normalizeText(action?.page_id || action?.pageId),
      page_title: ports.normalizeText(action?.page_title || action?.pageTitle),
      frame_scope: action?.frame_scope === 'child' ? 'child' : null,
      frame_url: ports.normalizeText(action?.frame_url),
      click_count: Number.isSafeInteger(action?.click_count) ? action.click_count : null,
      remote_input_id: ports.normalizeText(action?.remote_input_id),
      keyboard_activation_id: ports.normalizeText(action?.keyboard_activation_id),
      x: action?.x != null && String(action.x).trim() && Number.isFinite(Number(action.x)) ? Number(action.x) : null,
      y: action?.y != null && String(action.y).trim() && Number.isFinite(Number(action.y)) ? Number(action.y) : null,
      source: ports.normalizeText(action?.source),
      timestamp: ports.normalizeText(action?.timestamp)
    }))
    .filter((action) => action.type || action.locator || action.text || action.value)
    .slice(-ports.MAX_CAPTURED_ACTIONS);


const normalizeCapturedNetwork = (network = []) =>
  (Array.isArray(network) ? network : [])
    .map((entry) => ({
      method: ports.normalizeText(entry?.method) || "GET",
      url: ports.normalizeText(entry?.url),
      status: Number.isFinite(Number(entry?.status)) ? Number(entry.status) : null,
      resource_type: ports.normalizeText(entry?.resource_type || entry?.resourceType),
      page_id: ports.normalizeText(entry?.page_id || entry?.pageId),
      page_title: ports.normalizeText(entry?.page_title || entry?.pageTitle),
      request_body: ports.normalizeRichText(entry?.request_body || entry?.requestBody || entry?.post_data || entry?.postData),
      response_body_sample: ports.normalizeRichText(entry?.response_body_sample || entry?.responseBodySample),
      content_type: ports.normalizeText(entry?.content_type || entry?.contentType)
    }))
    .filter((entry) => entry.url && ["fetch", "xhr"].includes(String(entry.resource_type || "").toLowerCase()))
    .slice(-ports.MAX_CAPTURED_NETWORK);


const parseActionTimestamp = (value) => {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
};


const stripRecorderLocatorPrefix = (locator) => {
  const normalized = ports.normalizeText(locator);

  if (!normalized) {
    return null;
  }

  return normalized;
};


const getRecorderRepositoryMember = (action, repositoryModel) =>
  repositoryModel?.byActionIndex?.get(Number(action?.index)) || null;


const resolveRecorderTarget = (action, repositoryModel) => {
  const repositoryMember = getRecorderRepositoryMember(action, repositoryModel);
  // A newly named object is not durable until optional learning succeeds.
  // Save its observed locator directly so a successful recording can replay
  // even when repository storage is temporarily unavailable.
  if (repositoryMember?.reference && repositoryMember.persisted) {
    return repositoryMember.reference;
  }

  const locator = stripRecorderLocatorPrefix(action.locator);

  if (locator && !ports.NON_REPOSITORY_RECORDING_LOCATORS.has(locator)) {
    return locator;
  }

  return null;
};


const quoteCodeString = (value) => JSON.stringify(String(value || ""));

const playwrightLocatorCode = (target, formatter) => {
  if (formatter) return formatter(target);
  const normalized = String(target || "").trim();
  if (/^(?:page\.)?(?:getBy\w+|locator)\s*\(/i.test(normalized)) throw new Error('The recorded semantic locator requires the shared locator compiler.');
  return `page.locator(${quoteCodeString(normalized)})`;
};

const playwrightLocatorBlock = (target, lines = [], formatter) => [
  "{",
  `  const target = ${playwrightLocatorCode(target, formatter)};`,
  ...lines.map((line) => `  ${line}`),
  "}"
].join("\n");

const inferRecorderFillValue = (action) => {
  // A recorder captures actual data, including a deliberately empty input.
  // Parameter names come from the mapped source step, never field-name guesses.
  return typeof action.value === 'string' ? action.value : '';
};


const recorderParameterHint = action => {
  const {referenceKey,parameterReference}=require("../../lib/parameters/automationBrowserParameters");
  const name=referenceKey(inferRecorderFillValue(action));
  return name?parameterReference(name):null;
};


const describeRecorderTarget = (action, fallback, repositoryModel) =>
  getRecorderRepositoryMember(action, repositoryModel)?.field_name
  || ports.normalizeText(action.text)
  || stripRecorderLocatorPrefix(action.locator)
  || fallback;


const keywordComment = (keyword, args = []) =>
  `// Keyword: ${keyword}(${args.map((arg) => quoteCodeString(arg)).join(", ")})`;


const buildRecorderStepCandidate = (action, order, repositoryModel) => {
  const locatorBlock = (target, lines) => playwrightLocatorBlock(target, lines, repositoryModel?.locatorExpression);
  const type = String(action.type || "").toLowerCase();
  const target = resolveRecorderTarget(action, repositoryModel);
  const targetLabel = describeRecorderTarget(action, "recorded target", repositoryModel);
  const url = ports.normalizeText(action.url);
  const key = ports.normalizeText(action.text || action.value);
  const keyword = type === 'navigation' && action.replay_navigation === 'observed' ? 'page.waitForURL' : ports.inferKeywordForAction(action);

  if (type === 'submit') throw Object.assign(new Error('A form submission needs its recorded click or Enter key action. Existing instructions were retained.'), { code: 'AUTOMATION_RECORDER_REPLAY_UNSUPPORTED', statusCode: 422 });
  if (['click','dblclick','rightclick','fill','change','upload','select','check','uncheck'].includes(type) && !target) {
    if (type === 'click' && [action.x, action.y].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
      return { source_action_index: action.index, step_order: order, action: `Click recorded screen position at ${action.x}, ${action.y}`,
        expected_result: '', step_type: 'web', keyword: 'page.mouse.click', keyword_arguments: [String(action.x), String(action.y)],
        automation_code: `await page.mouse.click(${action.x}, ${action.y});` };
    }
    throw Object.assign(new Error('A recorded interaction is missing its element locator. Existing instructions were retained; inspect the target or use Automation Engineer to author this flow.'), { code: 'AUTOMATION_RECORDER_REPLAY_UNSUPPORTED', statusCode: 422 });
  }

  if (type === "navigation") {
    if (!url || url === "about:blank") {
      return null;
    }

    return {
      source_action_index: action.index,
      step_order: order,
      action: `${action.replay_navigation === 'observed' ? 'Wait for URL' : 'Open'} ${url}`,
      expected_result: "",
      step_type: "web",
      keyword,
      keyword_arguments: [url],
      automation_code: [
        keywordComment(keyword, [url]),
        action.replay_navigation === 'observed'
          ? `await page.waitForURL(${quoteCodeString(url)}, { waitUntil: "commit" });`
          : `await page.goto(${quoteCodeString(url)});`
      ].join("\n")
    };
  }

  if (type === "click") {

    return {
      source_action_index: action.index,
      step_order: order,
      action: type === "submit" ? `Submit ${targetLabel}` : `Click ${targetLabel}`,
      expected_result: "",
      step_type: "web",
      keyword,
      keyword_arguments: [target],
      automation_code: [
        keywordComment(keyword, [target]),
        locatorBlock(target, [`await target.click();`])
      ].join("\n")
    };
    }

  if (type === "dblclick" || type === "rightclick") {
    if (!target) {
      return null;
    }

    const verb = type === "dblclick" ? "Double click" : "Right click";

    return {
      source_action_index: action.index,
      step_order: order,
      action: `${verb} ${targetLabel}`,
      expected_result: "",
      step_type: "web",
      keyword,
      keyword_arguments: [target],
      automation_code: [
        keywordComment(keyword, [target]),
        locatorBlock(target, [type === "dblclick" ? `await target.dblclick();` : `await target.click({ button: "right" });`])
      ].join("\n")
    };
  }

  if (type === "fill" || type === "change") {
    const value = inferRecorderFillValue(action);


    return {
      source_action_index: action.index,
      step_order: order,
      action: `Fill ${targetLabel}`,
      expected_result: "",
      step_type: "web",
      keyword,
      keyword_arguments: [target, value],
      automation_code: [
        keywordComment(keyword, [target, value]),
        locatorBlock(target, [`await target.fill(${quoteCodeString(value)});`])
      ].join("\n")
    };
    }

  if (type === "upload") {
    const value = typeof action.value === 'string' ? action.value : '';


    return {
      source_action_index: action.index,
      step_order: order,
      action: `Upload file to ${targetLabel}`,
      expected_result: "",
      step_type: "web",
      keyword,
      keyword_arguments: [target, value],
      automation_code: [
        keywordComment(keyword, [target, value]),
        locatorBlock(target, [`await target.setInputFiles(${quoteCodeString(value)});`])
      ].join("\n")
    };
    }

  if (type === "select") {
    const value = typeof action.value === 'string' ? action.value : ports.normalizeRichText(action.text) || '';


    return {
      source_action_index: action.index,
      step_order: order,
      action: `Select ${describeRecorderTarget(action, value, repositoryModel)} in ${targetLabel}`,
      expected_result: "",
      step_type: "web",
      keyword,
      keyword_arguments: [target, value],
      automation_code: [
        keywordComment(keyword, [target, value]),
        locatorBlock(target, [`await target.selectOption(${quoteCodeString(value)});`])
      ].join("\n")
    };
    }

  if (type === "check" || type === "uncheck") {
    if (!target) {
      return null;
    }

    return {
      source_action_index: action.index,
      step_order: order,
      action: `${type === "check" ? "Check" : "Uncheck"} ${targetLabel}`,
      expected_result: "",
      step_type: "web",
      keyword,
      keyword_arguments: [target],
      automation_code: [
        keywordComment(keyword, [target]),
        locatorBlock(target, [`await target.${type}();`])
      ].join("\n")
    };
  }

  if (type === "press") {
    const normalizedKey = key || "Enter";

    return {
      source_action_index: action.index,
      step_order: order,
      action: `Press ${normalizedKey}`,
      expected_result: "",
      step_type: "web",
      keyword,
      keyword_arguments: [normalizedKey],
      automation_code: [
        keywordComment(keyword, [normalizedKey]),
        `await page.keyboard.press(${quoteCodeString(normalizedKey)});`
      ].join("\n")
    };
  }

  if (type === "tab") {
    return {
      source_action_index: action.index,
      step_order: order,
      action: "Press Tab",
      expected_result: "",
      step_type: "web",
      keyword,
      keyword_arguments: ["Tab"],
      automation_code: [
        keywordComment(keyword, ["Tab"]),
        `await page.keyboard.press("Tab");`
      ].join("\n")
    };
  }

  if (type === "scroll") {
    const position = action.replay_scroll || require("../../lib/recording/automationRecorderReplayPlan").scrollPosition(action);
    const code = position.absolute
      ? position.element
        ? locatorBlock(target, [`await target.evaluate((element, position) => element.scrollTo({ left: position.x, top: position.y, behavior: "instant" }), { x: ${position.x}, y: ${position.y} });`])
        : `await page.evaluate(({ x, y }) => window.scrollTo({ left: x, top: y, behavior: "instant" }), { x: ${position.x}, y: ${position.y} });`
      : `await page.mouse.wheel(${position.x}, ${position.y});`;
    return { source_action_index: action.index, step_order: order,
      action: position.absolute ? `Scroll ${position.element ? targetLabel : 'page'} to ${position.x}, ${position.y}` : 'Scroll page',
      expected_result: '', step_type: 'web', keyword: position.absolute ? position.element ? 'page.locator.evaluate' : 'page.evaluate' : 'web.scroll', keyword_arguments: [String(position.x), String(position.y)], automation_code: code };
  }

  return null;
};


const isRecorderActionSuperseded = (action, actions, index) => {
  const type = String(action.type || "").toLowerCase();

  if (type === "click" && action.source === "remote-control") {
    const timestamp = parseActionTimestamp(action.timestamp);
    return actions.slice(index + 1, index + 4).some((candidate) =>
      String(candidate.type || "").toLowerCase() === "click"
      && (candidate.locator || candidate.text)
      && candidate.source !== "remote-control"
      && (!timestamp || Math.abs(parseActionTimestamp(candidate.timestamp) - timestamp) < 2_000)
    );
  }

  if ((type === "change" || type === "fill" || type === "upload" || type === "select" || type === "check" || type === "uncheck") && action.locator) {
    return Boolean(require("../../lib/recording/automationRecorderActions").supersedingInputAction(action, actions, index));
  }

  if (type === "navigation") {
    const url = ports.normalizeText(action.url);

    if (!url || url === "about:blank") {
      return true;
    }

    return actions.slice(0, index).some((candidate) =>
      String(candidate.type || "").toLowerCase() === "navigation"
      && ports.normalizeText(candidate.url) === url
      && Math.abs(parseActionTimestamp(candidate.timestamp) - parseActionTimestamp(action.timestamp)) < 1_500
    );
  }

  return false;
};


const buildRecorderStepCandidates = (actions = [], repositoryModel = null) => {
  actions = require("../../lib/recording/automationRecorderReplayPlan").prepareRecorderReplayActions(actions);
  const allowedTypes = new Set(["navigation", "click", "dblclick", "rightclick", "fill", "change", "upload", "select", "check", "uncheck", "submit", "press", "tab", "scroll"]);
  const candidates = [];

  actions.forEach((action, index) => {
    const type = String(action.type || "").toLowerCase();

    if (!allowedTypes.has(type) || isRecorderActionSuperseded(action, actions, index)) {
      return;
    }

    const candidate = buildRecorderStepCandidate(action, candidates.length + 1, repositoryModel);

    if (candidate) {
      candidates.push(candidate);
    }
  });

  return candidates;
};


const tokenizeMappingText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9@._-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !["the", "and", "for", "with", "into", "from"].includes(token));


const scoreRecorderMapping = (manualStep, candidate) => {
  const manualTokens = new Set(tokenizeMappingText(`${manualStep.action || ""} ${manualStep.expected_result || ""}`));
  const candidateTokens = tokenizeMappingText(`${candidate.action || ""} ${candidate.automation_code || ""}`);

  if (!manualTokens.size || !candidateTokens.length) {
    return 0;
  }

  const overlap = candidateTokens.filter((token) => manualTokens.has(token)).length;
  return overlap / Math.max(candidateTokens.length, manualTokens.size);
};


const buildFallbackRecorderMappings = (manualSteps = [], stepCandidates = []) => {
  if (!manualSteps.length || !stepCandidates.length) {
    return [];
  }

  const groups = manualSteps.map((step) => ({
    step,
    candidates: [],
    mapping_source: "fallback"
  }));

  stepCandidates.forEach((candidate, index) => {
    let targetIndex = Math.min(groups.length - 1, Math.floor((index * groups.length) / stepCandidates.length));
    let bestScore = 0;

    groups.forEach((group, groupIndex) => {
      const score = scoreRecorderMapping(group.step, candidate);

      if (score > bestScore) {
        bestScore = score;
        targetIndex = groupIndex;
      }
    });

    groups[targetIndex].candidates.push(candidate);
  });

  return groups.filter((group) => group.candidates.length);
};


const orderRecorderCandidates = (candidates = []) => {
  const seen = new Set();
  return candidates.filter(Boolean).map((candidate, position) => {
    const rawIndex = candidate.source_action_index;
    const index = rawIndex !== null && rawIndex !== undefined && rawIndex !== "" && Number.isFinite(Number(rawIndex))
      ? Number(rawIndex) : null;
    return { candidate, index, position };
  }).filter(({ index }) => {
    // Missing identities are not interchangeable: retain their original order.
    if (index === null) return true;
    if (seen.has(index)) return false;
    seen.add(index);
    return true;
  }).sort((left, right) => (left.index ?? Infinity) - (right.index ?? Infinity) || left.position - right.position)
    .map(({ candidate }) => candidate);
};


const mergeRecorderMappingGroups = (groups = []) => {
  const byStepId = new Map();

  groups.forEach((group) => {
    if (!group?.step?.id || !Array.isArray(group.candidates) || !group.candidates.length) {
      return;
    }

    const current = byStepId.get(group.step.id) || {
      ...group,
      candidates: [],
      confidence: group.confidence || 0
    };

    current.candidates.push(...group.candidates);
    current.confidence = Math.max(Number(current.confidence || 0), Number(group.confidence || 0));
    current.mapping_source =
      current.mapping_source && current.mapping_source !== group.mapping_source
        ? "mixed"
        : current.mapping_source || group.mapping_source;
    byStepId.set(group.step.id, current);
  });

  return [...byStepId.values()]
    .map((group) => ({ ...group, candidates: orderRecorderCandidates(group.candidates) }))
    .sort((left, right) => Number(left.step.step_order || 0) - Number(right.step.step_order || 0));
};


const buildRecorderMappingPrompt = ({
  testCase,
  manualSteps,
  stepCandidates,
  capturedActions,
  additionalContext
}) => [
  ports.aiInstructionBlock("ai.automation.recorder_mapping", "aiAutomationBuilder.service.js.buildRecorderMappingPrompt.final.1"),
  "",
  ports.aiInstructionBlock("ai.automation.recorder_mapping", "aiAutomationBuilder.service.js.buildRecorderMappingPrompt.final.2"),
  "",
  ports.aiInstructionBlock("ai.automation.recorder_mapping", "aiAutomationBuilder.service.js.buildRecorderMappingPrompt.final.8"),
  "{",
  ports.aiInstructionBlock("ai.automation.recorder_mapping", "aiAutomationBuilder.service.js.buildRecorderMappingPrompt.final.9"),
  "}",
  "",
  [ports.aiInstructionBlock("ai.automation.recorder_mapping", "aiAutomationBuilder.service.buildRecorderMappingPrompt.segment.3"),String(testCase.title),""].join(''),
  [ports.aiInstructionBlock("ai.automation.recorder_mapping", "aiAutomationBuilder.service.buildRecorderMappingPrompt.segment.4"),String(testCase.description || "No description provided."),""].join(''),
  "",
  ports.aiInstructionBlock("ai.automation.recorder_mapping", "aiAutomationBuilder.service.js.buildRecorderMappingPrompt.final.17"),
  JSON.stringify(manualSteps.map(ports.summarizeStep), null, 2),
  "",
  ports.aiInstructionBlock("ai.automation.recorder_mapping", "aiAutomationBuilder.service.js.buildRecorderMappingPrompt.final.18"),
  JSON.stringify(stepCandidates.map((candidate) => ({
    source_action_index: candidate.source_action_index,
    generated_order: candidate.step_order,
    action: candidate.action,
    expected_result: candidate.expected_result,
    automation_code: candidate.automation_code
  })), null, 2),
  "",
  ports.aiInstructionBlock("ai.automation.recorder_mapping", "aiAutomationBuilder.service.js.buildRecorderMappingPrompt.final.19"),
  JSON.stringify(capturedActions.slice(0, ports.MAX_CAPTURED_ACTIONS), null, 2),
  additionalContext ? `\nAdditional guidance:\n${additionalContext}` : ""
].filter(Boolean).join("\n");


const normalizeRecorderAiMappings = (payload, manualSteps = [], stepCandidates = []) => {
  const stepsById = new Map(manualSteps.map((step) => [step.id, step]));
  const stepsByOrder = new Map(manualSteps.map((step) => [Number(step.step_order || 0), step]));
  const candidatesBySourceIndex = new Map(stepCandidates.map((candidate) => [Number(candidate.source_action_index), candidate]));
  const candidatesByGeneratedOrder = new Map(stepCandidates.map((candidate) => [Number(candidate.step_order), candidate]));
  const usedSourceIndexes = new Set();
  const groupsByStepId = new Map();
  const mappings = Array.isArray(payload?.mappings) ? payload.mappings : [];

  mappings.forEach((mapping) => {
    if (!ports.isPlainObject(mapping)) {
      return;
    }

    const stepId = ports.normalizeText(mapping.manual_step_id || mapping.step_id || mapping.id);
    const stepOrder = Number(mapping.manual_step_order || mapping.step_order || mapping.order);
    const step = stepId ? stepsById.get(stepId) : stepsByOrder.get(stepOrder);

    if (!step) {
      return;
    }

    const rawReferences = [
      ...(Array.isArray(mapping.source_action_indexes) ? mapping.source_action_indexes : []),
      ...(Array.isArray(mapping.source_action_indices) ? mapping.source_action_indices : []),
      ...(Array.isArray(mapping.recorder_action_indexes) ? mapping.recorder_action_indexes : []),
      ...(Array.isArray(mapping.action_indexes) ? mapping.action_indexes : []),
      ...(Array.isArray(mapping.candidate_orders) ? mapping.candidate_orders : []),
      ...(Array.isArray(mapping.generated_orders) ? mapping.generated_orders : [])
    ];
    const candidates = rawReferences
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .map((value) => candidatesBySourceIndex.get(value) || candidatesByGeneratedOrder.get(value))
      .filter(Boolean)
      .filter((candidate) => {
        const sourceIndex = Number(candidate.source_action_index);

        if (usedSourceIndexes.has(sourceIndex)) {
          return false;
        }

        usedSourceIndexes.add(sourceIndex);
        return true;
      });

    if (!candidates.length) {
      return;
    }

    const current = groupsByStepId.get(step.id) || {
      step,
      candidates: [],
      mapping_source: "ai",
      confidence: 0
    };

    current.candidates.push(...candidates);
    current.confidence = Math.max(current.confidence, Math.max(0, Math.min(1, ports.clampNumber(mapping.confidence, 0))));
    groupsByStepId.set(step.id, current);
  });

  return {
    summary: ports.normalizeRichText(payload?.summary) || "Recorder automation mapped to existing manual steps.",
    mappings: [...groupsByStepId.values()].map((group) => ({ ...group, candidates: orderRecorderCandidates(group.candidates) }))
  };
};


const buildAiRecorderMappings = async ({
  testCase,
  manualSteps,
  stepCandidates,
  capturedActions,
  integrationId,
  userId,
  additionalContext,
  transactionId,
  projectPrompt = value => value
}) => {
  let integration = null;

  try {
    integration = await ports.resolveLlmIntegration(integrationId, {
      userId,
      projectId: testCase.project_id,
      usageKey: "ai.automation.recorder_mapping"
    });
  } catch (error) {
    return {
      mappings: [],
      summary: null,
      integration: null,
      fallback_reason: error instanceof Error ? error.message : "Unable to resolve LLM integration"
    };
  }

  if (!integration) {
    return {
      mappings: [],
      summary: null,
      integration: null,
      fallback_reason: "No active LLM integration is configured"
    };
  }

  try {
    const content = await ports.requestChatCompletion({
      integration,
      featureKey: "ai.automation.recorder_mapping",
      prompt: projectPrompt(buildRecorderMappingPrompt({
        testCase,
        manualSteps,
        stepCandidates,
        capturedActions,
        additionalContext: ports.normalizeRichText(additionalContext)
      }))
    });
    const normalized = normalizeRecorderAiMappings(ports.extractJsonPayload(content), manualSteps, stepCandidates);

    if (!normalized.mappings.length && stepCandidates.length) {
      throw new Error("LLM did not return usable recorder step mappings");
    }

    await ports.appendEvent(transactionId, {
      phase: "recorder.ai.mapping.completed",
      message: `AI mapped recorder automation onto ${normalized.mappings.length} manual step${normalized.mappings.length === 1 ? "" : "s"}.`,
      details: {
        integration_id: integration.id,
        model: integration.model,
        mapped_steps: normalized.mappings.length,
        mapped_interactions: normalized.mappings.reduce((total, group) => total + group.candidates.length, 0)
      }
    });

    return {
      mappings: normalized.mappings,
      summary: normalized.summary,
      integration,
      fallback_reason: null
    };
  } catch (error) {
    return {
      mappings: [],
      summary: null,
      integration,
      fallback_reason: error instanceof Error ? error.message : "LLM recorder mapping failed"
    };
  }
};


const createRecorderAutomationCode = (candidates = []) =>
  orderRecorderCandidates(candidates)
    .map((candidate) => [
      `// Recorded: ${candidate.action || "browser interaction"}`,
      candidate.automation_code
    ].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n");
return { normalizeCapturedActions, normalizeCapturedNetwork, parseActionTimestamp, stripRecorderLocatorPrefix, getRecorderRepositoryMember, resolveRecorderTarget, quoteCodeString, playwrightLocatorCode, playwrightLocatorBlock, inferRecorderFillValue, recorderParameterHint, describeRecorderTarget, keywordComment, buildRecorderStepCandidate, isRecorderActionSuperseded, buildRecorderStepCandidates, tokenizeMappingText, scoreRecorderMapping, buildFallbackRecorderMappings, orderRecorderCandidates, mergeRecorderMappingGroups, buildRecorderMappingPrompt, normalizeRecorderAiMappings, buildAiRecorderMappings, createRecorderAutomationCode };
}
module.exports = { createRecordedProgram };
