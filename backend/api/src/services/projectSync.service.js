const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const db = require("../db");
const obsDb = require("../obsDb");
const integrationService = require("./integration.service");
const workspaceTransactionService = require("./workspaceTransaction.service");

const execFileAsync = promisify(execFile);
const SYNC_INTEGRATION_TYPES = new Set(["google_drive", "github"]);
const SCHEDULE_INTERVAL_MS = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000
};

const selectProject = db.prepare(`
  SELECT *
  FROM projects
  WHERE id = ?
`);

const selectProjectAppTypes = db.prepare(`
  SELECT id, name, type
  FROM app_types
  WHERE project_id = ?
  ORDER BY LOWER(name) ASC, id ASC
`);

const selectProjectRequirements = db.prepare(`
  SELECT id, display_id, title, description, priority, status, created_at, updated_at
  FROM requirements
  WHERE project_id = ?
  ORDER BY LOWER(title) ASC, id ASC
`);

const selectProjectTestCases = db.prepare(`
  SELECT
    test_cases.id,
    test_cases.display_id,
    test_cases.app_type_id,
    app_types.name AS app_type_name,
    app_types.type AS app_type_type,
    test_cases.title,
    test_cases.description,
    test_cases.parameter_values,
    test_cases.automated,
    test_cases.priority,
    test_cases.status,
    test_cases.created_at,
    test_cases.updated_at
  FROM test_cases
  JOIN app_types ON app_types.id = test_cases.app_type_id
  WHERE app_types.project_id = ?
  ORDER BY LOWER(test_cases.title) ASC, test_cases.id ASC
`);

const selectProjectTestSteps = db.prepare(`
  SELECT
    test_steps.id,
    test_steps.test_case_id,
    test_steps.step_order,
    test_steps.action,
    test_steps.expected_result,
    test_steps.step_type,
    test_steps.automation_code
  FROM test_steps
  JOIN test_cases ON test_cases.id = test_steps.test_case_id
  JOIN app_types ON app_types.id = test_cases.app_type_id
  WHERE app_types.project_id = ?
  ORDER BY test_steps.test_case_id ASC, test_steps.step_order ASC, test_steps.id ASC
`);

const selectProjectRequirementMappings = db.prepare(`
  SELECT
    requirement_test_cases.test_case_id,
    requirements.id AS requirement_id,
    requirements.title AS requirement_title
  FROM requirement_test_cases
  JOIN requirements ON requirements.id = requirement_test_cases.requirement_id
  WHERE requirements.project_id = ?
  ORDER BY requirements.title ASC
`);

const selectProjectSuiteMappings = db.prepare(`
  SELECT
    suite_test_cases.test_case_id,
    test_suites.id AS suite_id,
    test_suites.name AS suite_name
  FROM suite_test_cases
  JOIN test_suites ON test_suites.id = suite_test_cases.suite_id
  JOIN app_types ON app_types.id = test_suites.app_type_id
  WHERE app_types.project_id = ?
  ORDER BY suite_test_cases.sort_order ASC, test_suites.name ASC
`);

const selectQueuedSyncTransactions = obsDb.prepare(`
  SELECT *
  FROM workspace_transactions
  WHERE category = 'backup'
    AND status = 'queued'
  ORDER BY created_at ASC, id ASC
  LIMIT 6
`);

const selectPendingSyncTransaction = obsDb.prepare(`
  SELECT id
  FROM workspace_transactions
  WHERE category = 'backup'
    AND status IN ('queued', 'running')
    AND metadata->>'integration_id' = ?
  ORDER BY created_at DESC
  LIMIT 1
`);

let isQueueProcessing = false;

const parseJsonValue = (value, fallback) => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return value;
};

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const toCsvCell = (value) => {
  const normalized = String(value ?? "");
  return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, "\"\"")}"` : normalized;
};

const toSlug = (value) =>
  String(value || "artifact")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "artifact";

const serializeCsv = (headers, rows) => {
  return [headers, ...rows].map((row) => row.map((value) => toCsvCell(value)).join(",")).join("\n");
};

const scheduleModeLabel = (value) => {
  const normalized = normalizeText(value);
  return normalized && Object.prototype.hasOwnProperty.call(SCHEDULE_INTERVAL_MS, normalized) ? normalized : "manual";
};

const computeNextSyncAt = (scheduleMode, anchor = new Date()) => {
  const normalizedMode = scheduleModeLabel(scheduleMode);

  if (normalizedMode === "manual") {
    return null;
  }

  const intervalMs = SCHEDULE_INTERVAL_MS[normalizedMode];
  return new Date(anchor.getTime() + intervalMs).toISOString();
};

const parseTimestamp = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatStepSummary = (steps) =>
  steps
    .map((step) => {
      const action = normalizeText(step.action) || "No action";
      const expected = normalizeText(step.expected_result);
      return expected ? `${step.step_order}. ${action} -> ${expected}` : `${step.step_order}. ${action}`;
    })
    .join(" | ");

const resolveCaseType = (testCase, steps) => {
  const types = [...new Set((steps || []).map((step) => normalizeText(step.step_type)).filter(Boolean))];

  if (types.length === 1) {
    return types[0];
  }

  if (types.length > 1) {
    return types.join("+");
  }

  return normalizeText(testCase.app_type_type) || "web";
};

const buildAutomationFileContent = ({
  project,
  testCase,
  steps,
  requirements,
  suites
}) => {
  const caseType = resolveCaseType(testCase, steps);
  const header = [
    `// HelloTest synced automation artifact`,
    `// Project: ${project.name}`,
    `// Test case: ${testCase.display_id || testCase.id} · ${testCase.title}`,
    `// Type: ${caseType}`,
    requirements.length ? `// Requirements: ${requirements.join(", ")}` : `// Requirements: none`,
    suites.length ? `// Suites: ${suites.join(", ")}` : `// Suites: none`,
    ""
  ];
  const codeBlocks = steps
    .map((step) => normalizeText(step.automation_code))
    .filter(Boolean)
    .map((code, index) => `// Step ${index + 1}\n${code}`);

  if (codeBlocks.length) {
    return [...header, ...codeBlocks].join("\n\n");
  }

  const fallback = steps.length
    ? steps.map((step) => `// ${step.step_order}. ${normalizeText(step.action) || "No action"}${step.expected_result ? ` -> ${step.expected_result}` : ""}`).join("\n")
    : "// No steps are defined for this test case yet.";

  return [...header, "// Automation code has not been authored yet.", fallback].join("\n");
};

const integrationSummary = (integration) => {
  if (integration.type === "google_drive") {
    return "Google Drive project artifact backup";
  }

  if (integration.type === "github") {
    return "GitHub automation code sync";
  }

  return integration.name;
};

const getIntegrationToken = (integration) => {
  return normalizeText(integration.api_key) || normalizeText(integration.config?.access_token);
};

async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(60000)
  });

  const payload = await response.text();
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const parsed = isJson && payload ? JSON.parse(payload) : payload;

  if (!response.ok) {
    const message =
      (parsed && typeof parsed === "object" && parsed !== null && (parsed.error?.message || parsed.message)) ||
      response.statusText ||
      "Request failed";
    throw new Error(message);
  }

  return parsed;
}

async function loadProjectArtifactData(projectId) {
  const project = await selectProject.get(projectId);

  if (!project) {
    throw new Error("Project not found");
  }

  const [appTypes, requirements, testCases, steps, requirementMappings, suiteMappings] = await Promise.all([
    selectProjectAppTypes.all(projectId),
    selectProjectRequirements.all(projectId),
    selectProjectTestCases.all(projectId),
    selectProjectTestSteps.all(projectId),
    selectProjectRequirementMappings.all(projectId),
    selectProjectSuiteMappings.all(projectId)
  ]);

  const stepsByCaseId = steps.reduce((map, step) => {
    map[step.test_case_id] = map[step.test_case_id] || [];
    map[step.test_case_id].push(step);
    return map;
  }, {});
  const requirementTitlesByCaseId = requirementMappings.reduce((map, row) => {
    map[row.test_case_id] = map[row.test_case_id] || [];
    map[row.test_case_id].push(row.requirement_title);
    return map;
  }, {});
  const suiteNamesByCaseId = suiteMappings.reduce((map, row) => {
    map[row.test_case_id] = map[row.test_case_id] || [];
    map[row.test_case_id].push(row.suite_name);
    return map;
  }, {});

  return {
    project,
    appTypes,
    requirements,
    testCases: testCases.map((testCase) => ({
      ...testCase,
      parameter_values: parseJsonValue(testCase.parameter_values, {})
    })),
    stepsByCaseId,
    requirementTitlesByCaseId,
    suiteNamesByCaseId
  };
}

async function buildProjectArtifactArchive(integration, projectId) {
  const artifact = await loadProjectArtifactData(projectId);
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hellotest-artifact-"));
  const artifactDir = path.join(tempRoot, "artifact");
  const manifestDir = path.join(artifactDir, "manifest");
  const exportDir = path.join(artifactDir, "exports");
  const automationDir = path.join(artifactDir, "automation");
  const timestamp = new Date();
  const fileName = `${toSlug(artifact.project.display_id || artifact.project.name)}-${timestamp.toISOString().replace(/[:.]/g, "-")}.zip`;
  const zipPath = path.join(tempRoot, fileName);

  try {
    await fs.mkdir(manifestDir, { recursive: true });
    await fs.mkdir(exportDir, { recursive: true });
    await fs.mkdir(automationDir, { recursive: true });

    const requirementsCsv = serializeCsv(
      ["ID", "Title", "Description", "Priority", "Status", "Created At", "Updated At"],
      artifact.requirements.map((requirement) => [
        requirement.display_id || requirement.id,
        requirement.title,
        requirement.description || "",
        requirement.priority ?? "",
        requirement.status || "",
        requirement.created_at || "",
        requirement.updated_at || ""
      ])
    );
    const testCasesCsv = serializeCsv(
      ["ID", "Title", "Description", "App Type", "Type", "Requirements", "Suites", "Test Steps", "Test Data", "Automated", "Priority", "Status", "Created At", "Updated At"],
      artifact.testCases.map((testCase) => {
        const steps = artifact.stepsByCaseId[testCase.id] || [];
        return [
          testCase.display_id || testCase.id,
          testCase.title,
          testCase.description || "",
          testCase.app_type_name || "",
          resolveCaseType(testCase, steps),
          (artifact.requirementTitlesByCaseId[testCase.id] || []).join(" | "),
          (artifact.suiteNamesByCaseId[testCase.id] || []).join(" | "),
          formatStepSummary(steps),
          Object.entries(testCase.parameter_values || {}).map(([key, value]) => `${key}=${value}`).join(" | "),
          testCase.automated || "no",
          testCase.priority ?? "",
          testCase.status || "",
          testCase.created_at || "",
          testCase.updated_at || ""
        ];
      })
    );
    const testStepsCsv = serializeCsv(
      ["Test Case ID", "Step Order", "Action", "Expected Result", "Step Type", "Has Automation"],
      artifact.testCases.flatMap((testCase) =>
        (artifact.stepsByCaseId[testCase.id] || []).map((step) => [
          testCase.display_id || testCase.id,
          step.step_order,
          step.action || "",
          step.expected_result || "",
          step.step_type || "",
          normalizeText(step.automation_code) ? "yes" : "no"
        ])
      )
    );
    const automationManifestCsv = serializeCsv(
      ["Test Case ID", "Test Case", "App Type", "Type", "Automation File", "Requirement Count", "Suite Count"],
      artifact.testCases.map((testCase) => {
        const safeAppType = toSlug(testCase.app_type_name || "shared");
        const safeCase = `${testCase.display_id || testCase.id}-${toSlug(testCase.title)}`;
        return [
          testCase.display_id || testCase.id,
          testCase.title,
          testCase.app_type_name || "",
          resolveCaseType(testCase, artifact.stepsByCaseId[testCase.id] || []),
          `automation/${safeAppType}/${safeCase}.spec.ts`,
          (artifact.requirementTitlesByCaseId[testCase.id] || []).length,
          (artifact.suiteNamesByCaseId[testCase.id] || []).length
        ];
      })
    );

    if (integration.config?.include_requirements_csv !== false) {
      await fs.writeFile(path.join(exportDir, "requirements.csv"), requirementsCsv, "utf8");
    }

    if (integration.config?.include_test_cases_csv !== false) {
      await fs.writeFile(path.join(exportDir, "test-cases.csv"), testCasesCsv, "utf8");
    }

    await fs.writeFile(path.join(exportDir, "test-steps.csv"), testStepsCsv, "utf8");
    await fs.writeFile(path.join(exportDir, "automation-manifest.csv"), automationManifestCsv, "utf8");
    await fs.writeFile(
      path.join(manifestDir, "project-summary.json"),
      JSON.stringify({
        project: {
          id: artifact.project.id,
          display_id: artifact.project.display_id || null,
          name: artifact.project.name
        },
        generated_at: timestamp.toISOString(),
        counts: {
          app_types: artifact.appTypes.length,
          requirements: artifact.requirements.length,
          test_cases: artifact.testCases.length,
          test_steps: Object.values(artifact.stepsByCaseId).reduce((total, steps) => total + steps.length, 0)
        }
      }, null, 2),
      "utf8"
    );

    await execFileAsync("zip", ["-rq", zipPath, "."], { cwd: artifactDir });
    const buffer = await fs.readFile(zipPath);

    return {
      fileName,
      buffer,
      artifact
    };
  } catch (error) {
    if (error instanceof Error && /ENOENT|not found/i.test(error.message)) {
      throw new Error("The system zip command is not available. Install zip on the API host to enable Google Drive artifact backups.");
    }
    throw error;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function uploadArtifactToGoogleDrive(integration, projectId) {
  const token = getIntegrationToken(integration);

  if (!token) {
    throw new Error("Google Drive integration is missing an access token");
  }

  const folderId = normalizeText(integration.config?.folder_id);

  if (!folderId) {
    throw new Error("Google Drive integration is missing a folder ID");
  }

  const { fileName, buffer, artifact } = await buildProjectArtifactArchive(integration, projectId);
  const metadata = {
    name: fileName,
    parents: [folderId]
  };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", new Blob([buffer], { type: "application/zip" }), fileName);

  const response = await requestJson("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: form
  });

  return {
    summary: `${artifact.requirements.length} requirements and ${artifact.testCases.length} test cases packaged into ${fileName}.`,
    metadata: {
      file_id: response.id,
      file_name: response.name || fileName,
      web_view_link: response.webViewLink || null,
      requirements_count: artifact.requirements.length,
      test_cases_count: artifact.testCases.length
    }
  };
}

async function syncAutomationToGithub(integration, projectId) {
  const token = getIntegrationToken(integration);

  if (!token) {
    throw new Error("GitHub integration is missing an access token");
  }

  const owner = normalizeText(integration.config?.owner);
  const repo = normalizeText(integration.config?.repo);
  const branch = normalizeText(integration.config?.branch) || "main";
  const directory = normalizeText(integration.config?.directory) || "hellotest-sync";
  const extension = normalizeText(integration.config?.file_extension) || "ts";

  if (!owner || !repo) {
    throw new Error("GitHub integration is missing repository owner or name");
  }

  const artifact = await loadProjectArtifactData(projectId);
  const files = [];

  artifact.testCases.forEach((testCase) => {
    const steps = artifact.stepsByCaseId[testCase.id] || [];
    const safeAppType = toSlug(testCase.app_type_name || "shared");
    const safeCase = `${testCase.display_id || testCase.id}-${toSlug(testCase.title)}`;
    const filePath = `${directory}/automation/${safeAppType}/${safeCase}.spec.${extension.replace(/^\./, "")}`;

    files.push({
      path: filePath,
      content: buildAutomationFileContent({
        project: artifact.project,
        testCase,
        steps,
        requirements: artifact.requirementTitlesByCaseId[testCase.id] || [],
        suites: artifact.suiteNamesByCaseId[testCase.id] || []
      })
    });
  });

  files.push({
    path: `${directory}/manifests/test-cases.csv`,
    content: serializeCsv(
      ["ID", "Title", "App Type", "Type", "Requirement Count", "Suite Count", "Step Count"],
      artifact.testCases.map((testCase) => [
        testCase.display_id || testCase.id,
        testCase.title,
        testCase.app_type_name || "",
        resolveCaseType(testCase, artifact.stepsByCaseId[testCase.id] || []),
        (artifact.requirementTitlesByCaseId[testCase.id] || []).length,
        (artifact.suiteNamesByCaseId[testCase.id] || []).length,
        (artifact.stepsByCaseId[testCase.id] || []).length
      ])
    )
  });

  const apiBaseUrl = normalizeText(integration.base_url) || "https://api.github.com";
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const ref = await requestJson(`${apiBaseUrl}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, {
    headers
  });
  const baseCommitSha = ref.object?.sha;

  if (!baseCommitSha) {
    throw new Error(`GitHub branch "${branch}" could not be resolved`);
  }

  const commit = await requestJson(`${apiBaseUrl}/repos/${owner}/${repo}/git/commits/${baseCommitSha}`, {
    headers
  });
  const baseTreeSha = commit.tree?.sha;

  if (!baseTreeSha) {
    throw new Error("GitHub base tree could not be resolved");
  }

  const tree = await requestJson(`${apiBaseUrl}/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: files.map((file) => ({
        path: file.path,
        mode: "100644",
        type: "blob",
        content: file.content
      }))
    })
  });
  const commitResponse = await requestJson(`${apiBaseUrl}/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: `HelloTest sync: ${artifact.project.name} (${new Date().toISOString()})`,
      tree: tree.sha,
      parents: [baseCommitSha]
    })
  });

  await requestJson(`${apiBaseUrl}/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    headers: {
      ...headers,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sha: commitResponse.sha,
      force: false
    })
  });

  return {
    summary: `Synced ${files.length} project automation artifact file${files.length === 1 ? "" : "s"} to ${owner}/${repo}@${branch}.`,
    metadata: {
      repository: `${owner}/${repo}`,
      branch,
      commit_sha: commitResponse.sha,
      file_count: files.length
    }
  };
}

async function runQueuedSync(transaction) {
  const metadata = parseJsonValue(transaction.metadata, {});
  const integrationId = normalizeText(metadata.integration_id);
  const provider = normalizeText(metadata.provider);
  const projectId = normalizeText(transaction.project_id) || normalizeText(metadata.project_id);

  if (!integrationId || !provider || !projectId) {
    throw new Error("Queued sync is missing provider, project, or integration metadata");
  }

  const integration = await integrationService.getIntegration(integrationId);

  if (!integration.is_active) {
    throw new Error("The selected integration is inactive");
  }

  await workspaceTransactionService.updateTransaction(transaction.id, {
    status: "running",
    started_at: new Date().toISOString(),
    description: `Running ${integrationSummary(integration)}.`,
    metadata: {
      current_phase: "running",
      total_items: 1,
      processed_items: 0,
      progress_percent: 25
    }
  });
  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    phase: "run",
    message: `Running ${integrationSummary(integration)}.`,
    details: {
      provider: integration.type,
      integration_id: integration.id,
      project_id: projectId
    }
  });

  const result =
    provider === "google_drive"
      ? await uploadArtifactToGoogleDrive(integration, projectId)
      : await syncAutomationToGithub(integration, projectId);

  const completedAt = new Date();
  const nextSyncAt = computeNextSyncAt(integration.config?.schedule_mode, completedAt);

  await integrationService.mergeIntegrationConfig(integration.id, {
    last_synced_at: completedAt.toISOString(),
    last_sync_status: "completed",
    last_sync_transaction_id: transaction.id,
    last_sync_summary: result.summary,
    next_sync_at: nextSyncAt
  });
  await workspaceTransactionService.updateTransaction(transaction.id, {
    status: "completed",
    description: result.summary,
    metadata: {
      provider,
      integration_id: integration.id,
      project_id: projectId,
      total_items: 1,
      processed_items: 1,
      progress_percent: 100,
      current_phase: "completed",
      ...result.metadata
    },
    completed_at: completedAt.toISOString()
  });
  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    level: "success",
    phase: "complete",
    message: result.summary,
    details: result.metadata
  });

  return { completed: true };
}

exports.queueProjectSync = async ({ project_id, provider, created_by, trigger_mode = "manual", integration_id } = {}) => {
  const normalizedProjectId = normalizeText(project_id);
  const normalizedProvider = normalizeText(provider);

  if (!normalizedProjectId || !normalizedProvider) {
    throw new Error("project_id and provider are required");
  }

  if (!SYNC_INTEGRATION_TYPES.has(normalizedProvider)) {
    throw new Error(`Unsupported project sync provider: ${normalizedProvider}`);
  }

  const project = await selectProject.get(normalizedProjectId);

  if (!project) {
    throw new Error("Project not found");
  }

  const integrations = await integrationService.getIntegrations({ type: normalizedProvider, is_active: true });
  const integration = integrations.find((item) => item.id === integration_id) || integrations.find((item) => normalizeText(item.config?.project_id) === normalizedProjectId);

  if (!integration) {
    throw new Error(`No active ${normalizedProvider === "google_drive" ? "Google Drive" : "GitHub"} integration is linked to this project`);
  }

  const pendingTransaction = await selectPendingSyncTransaction.get(integration.id);

  if (pendingTransaction) {
    return { id: pendingTransaction.id, duplicate: true };
  }

  const title = normalizedProvider === "google_drive" ? "Google Drive project backup" : "GitHub automation sync";
  const transaction = await workspaceTransactionService.createTransaction({
    project_id: normalizedProjectId,
    category: "backup",
    action: normalizedProvider === "google_drive" ? "project_artifact_backup" : "project_code_sync",
    status: "queued",
    title,
    description: `${title} queued for ${project.name}.`,
    metadata: {
      integration_id: integration.id,
      provider: integration.type,
      project_id: normalizedProjectId,
      trigger_mode,
      total_items: 1,
      processed_items: 0,
      progress_percent: 0,
      current_phase: "queued"
    },
    created_by,
    related_kind: "integration",
    related_id: integration.id
  });

  await integrationService.mergeIntegrationConfig(integration.id, {
    last_sync_status: "queued",
    last_sync_transaction_id: transaction.id,
    next_sync_at:
      trigger_mode === "schedule"
        ? computeNextSyncAt(integration.config?.schedule_mode, new Date())
        : integration.config?.next_sync_at || null
  });
  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    phase: "queue",
    message: `${title} queued via ${trigger_mode === "schedule" ? "scheduled" : "manual"} sync.`,
    details: {
      integration_id: integration.id,
      provider: integration.type,
      project_id: normalizedProjectId,
      trigger_mode
    }
  });

  return { id: transaction.id, duplicate: false };
};

exports.processScheduledIntegrations = async () => {
  const integrations = await integrationService.getIntegrations();
  const now = new Date();

  for (const integration of integrations) {
    if (!SYNC_INTEGRATION_TYPES.has(integration.type) || !integration.is_active) {
      continue;
    }

    const projectId = normalizeText(integration.config?.project_id);
    const scheduleMode = scheduleModeLabel(integration.config?.schedule_mode);

    if (!projectId || scheduleMode === "manual") {
      continue;
    }

    const nextSyncAt = parseTimestamp(integration.config?.next_sync_at);

    if (nextSyncAt && nextSyncAt.getTime() > now.getTime()) {
      continue;
    }

    await exports.queueProjectSync({
      project_id: projectId,
      provider: integration.type,
      integration_id: integration.id,
      trigger_mode: "schedule"
    });
  }
};

exports.processQueuedSyncs = async () => {
  if (isQueueProcessing) {
    return;
  }

  isQueueProcessing = true;

  try {
    const queuedTransactions = await selectQueuedSyncTransactions.all();

    for (const transaction of queuedTransactions) {
      try {
        await runQueuedSync(transaction);
      } catch (error) {
        const metadata = parseJsonValue(transaction.metadata, {});
        const integrationId = normalizeText(metadata.integration_id);
        const integration = integrationId ? await integrationService.getIntegration(integrationId).catch(() => null) : null;
        const completedAt = new Date().toISOString();

        if (integration) {
          await integrationService.mergeIntegrationConfig(integration.id, {
            last_synced_at: completedAt,
            last_sync_status: "failed",
            last_sync_transaction_id: transaction.id,
            last_sync_summary: error instanceof Error ? error.message : "Unable to process project sync",
            next_sync_at: computeNextSyncAt(integration.config?.schedule_mode, new Date())
          });
        }

        await workspaceTransactionService.updateTransaction(transaction.id, {
          status: "failed",
          description: error instanceof Error ? error.message : "Unable to process project sync",
          metadata: {
            ...metadata,
            error: error instanceof Error ? error.message : "Unable to process project sync"
          },
          completed_at: completedAt
        });
        await workspaceTransactionService.appendTransactionEvent(transaction.id, {
          level: "error",
          phase: "complete",
          message: error instanceof Error ? error.message : "Unable to process project sync",
          details: {
            error: error instanceof Error ? error.message : "Unable to process project sync"
          }
        });
      }
    }
  } finally {
    isQueueProcessing = false;
  }
};

exports.triggerSyncProcessing = () => {
  setTimeout(() => {
    void exports.processQueuedSyncs();
  }, 0);
};
