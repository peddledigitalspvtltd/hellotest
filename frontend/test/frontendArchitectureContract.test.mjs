import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("the application query client retries only transient reads and never retries mutations", async () => {
  const [app, queryClient] = await Promise.all([
    readSource("../src/App.tsx"),
    readSource("../src/lib/appQueryClient.ts")
  ]);

  assert.match(app, /createAppQueryClient/);
  assert.match(queryClient, /failureCount >= 1/);
  assert.match(queryClient, /status >= 500 \|\| TRANSIENT_HTTP_STATUSES\.has\(status\)/);
  assert.match(queryClient, /mutations:[\s\S]*retry: false/);
  assert.match(queryClient, /refetchOnReconnect: true/);
  assert.match(queryClient, /refetchOnWindowFocus: false/);
});

test("workspace and catalog navigation preserve scroll without synchronous scroll event work", async () => {
  const [shell, restoration, pane] = await Promise.all([
    readSource("../src/components/AppShell.tsx"),
    readSource("../src/hooks/useWorkspaceScrollRestoration.ts"),
    readSource("../src/components/TileBrowserPane.tsx")
  ]);

  assert.match(shell, /useWorkspaceScrollRestoration\(\)/);
  assert.match(restoration, /scrollRestoration = "manual"/);
  assert.match(restoration, /navigationTypeRef\.current === "POP"/);
  assert.match(restoration, /ResizeObserver/);
  assert.match(restoration, /\}, \[location\.pathname\]\)/);
  assert.match(pane, /scrollKey\?: string/);
  assert.match(pane, /requestAnimationFrame/);
  assert.match(pane, /\{ passive: true \}/);
  assert.match(pane, /MAX_REMEMBERED_SCROLL_POSITIONS/);
});

test("route loading uses the shared accessible loading indicator", async () => {
  const [shell, skeleton, loader, styles] = await Promise.all([
    readSource("../src/components/AppShell.tsx"),
    readSource("../src/components/WorkspacePageSkeleton.tsx"),
    readSource("../src/components/LoadingState.tsx"),
    readSource("../src/components/LoadingState.css")
  ]);

  assert.match(shell, /Suspense fallback=\{<WorkspacePageSkeleton/);
  assert.match(skeleton, /<LoadingState label=\{label\}/);
  assert.match(loader, /aria-live="polite"[\s\S]*role="status"/);
  assert.match(styles, /prefers-reduced-motion/);
});

test("release readiness is loaded in one project request instead of one browser request per release", async () => {
  const [page, api] = await Promise.all([
    readSource("../src/pages/ReleasesPage.tsx"),
    readSource("../src/lib/api.ts")
  ]);

  assert.match(page, /api\.requirementReleases\.listReadiness/);
  assert.doesNotMatch(page, /useQueries/);
  assert.match(page, /isReadinessLoading \|\| isReadinessUnavailable \? "—"/);
  assert.match(page, /Release evidence unavailable/);
  assert.match(page, /canReadReadiness && !releaseReadinessQuery\.isError \? asArray\(releaseReadinessQuery\.data\) : \[\]/);
  assert.match(page, /readinessByReleaseId\.get\(expandedRelease\.id\)\?\.story_metrics\?\.\[story\.id\]/);
  assert.equal((page.match(/api\.requirementReleases\.listReadiness\(/g) || []).length, 1);
  assert.doesNotMatch(page, /api\.(executionResults|testCases)\.(list|releaseReadiness)\(/);
  assert.match(page, /hasMissingReleaseEvidence/);
  assert.match(api, /\/requirement-releases\/readiness/);
});

test("unused duplicate entity panels stay removed in favor of canonical integration panels", async () => {
  for (const relativePath of [
    "../src/components/EntityAttachmentPanel.tsx",
    "../src/components/EntityCommentsPanel.tsx"
  ]) {
    await assert.rejects(access(new URL(relativePath, import.meta.url)));
  }
});
