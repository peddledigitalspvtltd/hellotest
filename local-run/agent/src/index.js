const QAIRA_API_BASE_URL = (process.env.QAIRA_API_BASE_URL || "http://api:3000").replace(/\/+$/, "");
const TESTENGINE_SHARED_SECRET = process.env.TESTENGINE_SHARED_SECRET || process.env.QAIRA_TESTENGINE_SECRET || "qaira-testengine-dev-secret";
const LLM_BASE_URL = (process.env.LLM_BASE_URL || "http://qaira-local-llm:11434").replace(/\/+$/, "");
const LLM_MODEL = process.env.LLM_MODEL || "llama3.2";
const POLL_INTERVAL_MS = Math.max(5000, Number(process.env.GENERATOR_POLL_INTERVAL_MS || 30000));
const WORKER_ID = process.env.GENERATOR_WORKER_ID || `qaira-local-agent:${process.pid}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function qairaRequest(path, options = {}) {
  const response = await fetch(`${QAIRA_API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-qaira-testengine-secret": TESTENGINE_SHARED_SECRET,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`QAira ${response.status}: ${text || response.statusText}`);
  }

  return response.json();
}

function buildFallbackPlan(job) {
  const payload = job?.payload || {};
  return [
    `Build automation for "${payload.title || job.test_case_title || job.test_case_id}".`,
    "Use Playwright-style resilient locators in this priority: role/name, label, placeholder, text, test id, then CSS.",
    "Execute high-level manual steps through TestEngine, cache successful locators, collect network calls, and create API candidates for meaningful fetch/XHR calls.",
    "Prefer waiting for user-visible state changes instead of fixed sleeps. Preserve test data tokens and captured output params."
  ].join("\n");
}

async function askLocalLlm(job) {
  const prompt = [
    "You are QAira's local automation generation agent.",
    "Create a concise execution/build plan for converting this manual web test case into robust automation.",
    "Return practical guidance only.",
    "",
    JSON.stringify({
      job_id: job.id,
      test_case_id: job.test_case_id,
      payload: job.payload
    }, null, 2)
  ].join("\n");

  try {
    const response = await fetch(`${LLM_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 700
        }
      })
    });

    if (!response.ok) {
      throw new Error(`LLM ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json();
    return String(payload.response || "").trim() || buildFallbackPlan(job);
  } catch (error) {
    console.warn("Local LLM unavailable, using deterministic generator plan:", error.message);
    return buildFallbackPlan(job);
  }
}

async function pollOnce() {
  const leased = await qairaRequest("/automation-generator/internal/jobs/lease", {
    method: "POST",
    body: JSON.stringify({
      worker_id: WORKER_ID,
      lease_seconds: 240
    })
  });
  const job = leased.job;

  if (!job) {
    return false;
  }

  console.log(`leased automation generator job ${job.id} for case ${job.test_case_id}`);
  const plan = await askLocalLlm(job);
  const result = await qairaRequest(`/automation-generator/internal/jobs/${encodeURIComponent(job.id)}/run`, {
    method: "POST",
    body: JSON.stringify({
      worker_id: WORKER_ID,
      llm_model: LLM_MODEL,
      agent_plan: plan
    })
  });

  console.log(`completed automation generator job ${job.id}: ${result.status}`);
  return true;
}

async function main() {
  console.log(`QAira local automation generator agent started as ${WORKER_ID}`);
  console.log(`QAira API: ${QAIRA_API_BASE_URL}`);
  console.log(`LLM: ${LLM_BASE_URL} (${LLM_MODEL})`);

  for (;;) {
    try {
      const worked = await pollOnce();
      if (!worked) {
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (error) {
      console.error("generator poll failed:", error);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
