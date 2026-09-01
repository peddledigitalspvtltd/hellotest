import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon } from "./AppIcons";
import { DisplayIdBadge } from "./DisplayIdBadge";
import { EvidenceFlipCard } from "./EvidenceFlipCard";
import type { AppType, Issue, Requirement, RequirementIteration, TestCase, TestCaseModule } from "../types";

type NodeKind = "requirement" | "module" | "case" | "bug";
type TraceabilityView = "all" | "gaps";

const includesText = (values: Array<string | null | undefined>, search: string) =>
  !search || values.some((value) => String(value || "").toLowerCase().includes(search));

const normalizeReference = (value?: string | null) => String(value || "").trim().toLowerCase();

export function ProjectTraceabilityMap({
  appTypes,
  selectedAppTypeId,
  onAppTypeChange,
  requirements,
  sprints,
  modules,
  testCases,
  bugs,
  onOpen,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  loadMoreError = false
}: {
  appTypes: AppType[];
  selectedAppTypeId: string;
  onAppTypeChange: (id: string) => void;
  requirements: Requirement[];
  sprints: RequirementIteration[];
  modules: TestCaseModule[];
  testCases: TestCase[];
  bugs: Issue[];
  onOpen: (kind: NodeKind, id: string) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  loadMoreError?: boolean;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedSprintIds, setExpandedSprintIds] = useState<string[]>([]);
  const [expandedRequirementIds, setExpandedRequirementIds] = useState<string[]>([]);
  const [view, setView] = useState<TraceabilityView>("all");
  const initializedExpansionRef = useRef(false);
  const search = searchTerm.trim().toLowerCase();

  const scopedCases = useMemo(
    () => testCases.filter((item) => item.app_type_id === selectedAppTypeId),
    [selectedAppTypeId, testCases]
  );
  const scopedModules = useMemo(
    () => modules.filter((item) => item.app_type_id === selectedAppTypeId),
    [modules, selectedAppTypeId]
  );

  const graph = useMemo(() => {
    const requirementAlias = new Map<string, string>();
    const moduleAlias = new Map<string, string>();
    const caseAlias = new Map<string, string>();
    const bugAlias = new Map<string, string>();
    requirements.forEach((item) => [item.id, item.display_id].filter(Boolean).forEach((alias) => requirementAlias.set(String(alias), item.id)));
    scopedModules.forEach((item) => [item.id, item.display_id].filter(Boolean).forEach((alias) => moduleAlias.set(String(alias), item.id)));
    scopedCases.forEach((item) => [item.id, item.display_id].filter(Boolean).forEach((alias) => caseAlias.set(String(alias), item.id)));
    bugs.forEach((item) => [item.id, item.jira_bug_key].filter(Boolean).forEach((alias) => bugAlias.set(String(alias), item.id)));

    const requirementCases = new Map(requirements.map((item) => [item.id, new Set<string>()]));
    const moduleCases = new Map(scopedModules.map((item) => [item.id, new Set<string>()]));
    const caseModules = new Map(scopedCases.map((item) => [item.id, new Set<string>()]));
    const caseBugs = new Map(scopedCases.map((item) => [item.id, new Set<string>()]));
    const bugRequirements = new Map(bugs.map((item) => [item.id, new Set<string>()]));
    const bugModules = new Map(bugs.map((item) => [item.id, new Set<string>()]));

    const linkRequirementCase = (requirementReference: string, caseReference: string) => {
      const requirementId = requirementAlias.get(String(requirementReference));
      const caseId = caseAlias.get(String(caseReference));
      if (requirementId && caseId) requirementCases.get(requirementId)?.add(caseId);
    };
    const linkModuleCase = (moduleReference: string, caseReference: string) => {
      const moduleId = moduleAlias.get(String(moduleReference));
      const caseId = caseAlias.get(String(caseReference));
      if (!moduleId || !caseId) return;
      moduleCases.get(moduleId)?.add(caseId);
      caseModules.get(caseId)?.add(moduleId);
    };
    const linkBugCase = (bugReference: string, caseReference: string) => {
      const bugId = bugAlias.get(String(bugReference));
      const caseId = caseAlias.get(String(caseReference));
      if (bugId && caseId) caseBugs.get(caseId)?.add(bugId);
    };

    scopedCases.forEach((testCase) => {
      [...(testCase.requirement_ids || []), testCase.requirement_id].filter(Boolean).forEach((id) => linkRequirementCase(String(id), testCase.id));
      (testCase.module_ids || []).forEach((id) => linkModuleCase(String(id), testCase.id));
      (testCase.defect_ids || []).forEach((id) => linkBugCase(String(id), testCase.id));
    });
    requirements.forEach((requirement) => (requirement.test_case_ids || []).forEach((id) => linkRequirementCase(requirement.id, String(id))));
    scopedModules.forEach((module) => (module.test_case_ids || []).forEach((id) => linkModuleCase(module.id, String(id))));
    bugs.forEach((bug) => {
      (bug.linked_test_case_ids || []).forEach((id) => linkBugCase(bug.id, String(id)));
      (bug.linked_requirement_ids || []).forEach((reference) => {
        const id = requirementAlias.get(String(reference));
        if (id) bugRequirements.get(bug.id)?.add(id);
      });
      (bug.linked_module_ids || []).forEach((reference) => {
        const id = moduleAlias.get(String(reference));
        if (id) bugModules.get(bug.id)?.add(id);
      });
    });

    return {
      requirementCases,
      moduleCases,
      caseModules,
      caseBugs,
      bugRequirements,
      bugModules,
      moduleById: new Map(scopedModules.map((item) => [item.id, item])),
      caseById: new Map(scopedCases.map((item) => [item.id, item])),
      bugById: new Map(bugs.map((item) => [item.id, item]))
    };
  }, [bugs, requirements, scopedCases, scopedModules]);

  const requirementPaths = useMemo(() => requirements.map((requirement) => {
    const caseIds = [...(graph.requirementCases.get(requirement.id) || [])];
    const moduleIds = new Set<string>();
    caseIds.forEach((caseId) => graph.caseModules.get(caseId)?.forEach((moduleId) => moduleIds.add(moduleId)));
    const bugIds = new Set<string>();
    caseIds.forEach((caseId) => graph.caseBugs.get(caseId)?.forEach((bugId) => bugIds.add(bugId)));
    graph.bugRequirements.forEach((requirementIds, bugId) => {
      if (requirementIds.has(requirement.id)) bugIds.add(bugId);
    });
    graph.bugModules.forEach((linkedModuleIds, bugId) => {
      if ([...moduleIds].some((moduleId) => linkedModuleIds.has(moduleId))) bugIds.add(bugId);
    });
    const linkedModules = [...moduleIds].map((id) => graph.moduleById.get(id)).filter((item): item is TestCaseModule => Boolean(item));
    const linkedCases = caseIds.map((id) => graph.caseById.get(id)).filter((item): item is TestCase => Boolean(item));
    const linkedBugs = [...bugIds].map((id) => graph.bugById.get(id)).filter((item): item is Issue => Boolean(item));
    return { requirement, modules: linkedModules, cases: linkedCases, bugs: linkedBugs, isGap: !linkedModules.length || !linkedCases.length };
  }), [graph, requirements]);

  const sprintGroups = useMemo(() => {
    const sprintAliases = new Map<string, string>();
    const sprintByRequirement = new Map<string, string>();
    sprints.forEach((sprint) => {
      [sprint.id, sprint.jira_sprint_id, sprint.name, sprint.jira_sprint_name]
        .filter(Boolean)
        .forEach((alias) => sprintAliases.set(normalizeReference(alias), sprint.id));
      (sprint.requirement_ids || []).forEach((requirementId) => sprintByRequirement.set(normalizeReference(requirementId), sprint.id));
    });
    const groups = new Map(sprints.map((sprint) => [sprint.id, { sprint, paths: [] as typeof requirementPaths }]));
    const backlog: typeof requirementPaths = [];
    requirementPaths.forEach((path) => {
      const sprintId = sprintByRequirement.get(normalizeReference(path.requirement.id))
        || sprintByRequirement.get(normalizeReference(path.requirement.display_id))
        || [path.requirement.iteration_id, path.requirement.sprint_id, path.requirement.sprint]
        .map(normalizeReference)
        .map((alias) => sprintAliases.get(alias))
        .find(Boolean);
      if (sprintId && groups.has(sprintId)) groups.get(sprintId)?.paths.push(path);
      else backlog.push(path);
    });
    const ordered = [...groups.values()].sort((left, right) => {
      const stateRank = (state?: string | null) => state === "active" ? 0 : state === "future" ? 1 : 2;
      return stateRank(left.sprint.state || left.sprint.status) - stateRank(right.sprint.state || right.sprint.status)
        || String(right.sprint.start_date || "").localeCompare(String(left.sprint.start_date || ""));
    });
    if (backlog.length || !ordered.length) {
      ordered.push({
        sprint: { id: "__backlog__", project_id: requirements[0]?.project_id || "", name: "Backlog / No sprint", state: "backlog" },
        paths: backlog
      });
    }
    return ordered;
  }, [requirementPaths, requirements, sprints]);

  useEffect(() => {
    if (initializedExpansionRef.current || !sprintGroups.length) return;
    const initialSprint = sprintGroups.find((group) => (group.sprint.state || group.sprint.status) === "active") || sprintGroups.find((group) => group.paths.length) || sprintGroups[0];
    setExpandedSprintIds(initialSprint ? [initialSprint.sprint.id] : []);
    initializedExpansionRef.current = true;
  }, [sprintGroups]);

  const visibleSprintGroups = useMemo(() => sprintGroups.map((group) => {
    const paths = group.paths.filter((path) => {
      if (view === "gaps" && !path.isGap) return false;
      return includesText([
        group.sprint.name,
        group.sprint.jira_sprint_name,
        path.requirement.display_id,
        path.requirement.title,
        path.requirement.status,
        ...path.modules.flatMap((item) => [item.display_id, item.name]),
        ...path.cases.flatMap((item) => [item.display_id, item.title]),
        ...path.bugs.flatMap((item) => [item.jira_bug_key, item.title])
      ], search);
    });
    return { ...group, paths };
  }).filter((group) => group.paths.length || (!search && view === "all")), [search, sprintGroups, view]);

  const linkedRequirementCount = requirementPaths.filter((path) => path.cases.length).length;
  const linkedCaseCount = scopedCases.filter((item) => {
    const hasRequirement = requirementPaths.some((path) => path.cases.some((testCase) => testCase.id === item.id));
    return hasRequirement && Boolean(graph.caseModules.get(item.id)?.size);
  }).length;
  const connectedBugIds = new Set(requirementPaths.flatMap((path) => path.bugs.map((bug) => bug.id)));
  const gapCount = requirementPaths.filter((path) => path.isGap).length
    + scopedModules.filter((module) => !(graph.moduleCases.get(module.id)?.size)).length
    + scopedCases.filter((testCase) => !graph.caseModules.get(testCase.id)?.size || !requirementPaths.some((path) => path.cases.some((item) => item.id === testCase.id))).length;

  const toggleSprint = (sprintId: string) => setExpandedSprintIds((current) =>
    current.includes(sprintId) ? current.filter((id) => id !== sprintId) : [...current, sprintId]
  );
  const toggleRequirement = (requirementId: string) => setExpandedRequirementIds((current) =>
    current.includes(requirementId) ? current.filter((id) => id !== requirementId) : [...current, requirementId]
  );

  return (
    <section className="project-traceability-map">
      <div className="project-traceability-toolbar">
        <div className="project-traceability-toolbar-copy">
          <strong>End-to-end traceability</strong>
          <span>Expand a sprint to follow each Story through its derived modules, test cases, and Bugs.</span>
        </div>
        <label className="project-traceability-app-filter">
          <span>Application</span>
          <select aria-label="Filter traceability by application" value={selectedAppTypeId} onChange={(event) => onAppTypeChange(event.target.value)}>
            {appTypes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.type}</option>)}
          </select>
        </label>
        <div className="search-input-with-icon project-traceability-search">
          <SearchIcon />
          <input aria-label="Search traceability map" placeholder="Search sprints, Stories, modules, cases or Bugs" type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
        </div>
      </div>

      <div className="project-traceability-health metric-strip page-metric-strip" aria-label="Traceability health metrics" role="group">
        <EvidenceFlipCard caption="Delivery windows" evidence={["Sprints represented by the currently selected application scope; Backlog is excluded."]} label="Sprints" value={sprintGroups.filter((group) => group.sprint.id !== "__backlog__").length} />
        <EvidenceFlipCard caption="Story traceability" evidence={[`${linkedRequirementCount} of ${requirements.length} Stories connect to downstream Test Case evidence.`]} label="Stories covered" tone={linkedRequirementCount === requirements.length ? "success" : "warning"} value={`${linkedRequirementCount}/${requirements.length}`} />
        <EvidenceFlipCard caption="Coverage structure" evidence={[`${scopedModules.length} modules organize the selected application's Test Case scope.`]} label="Modules" value={scopedModules.length} />
        <EvidenceFlipCard caption="End-to-end paths" evidence={[`${linkedCaseCount} of ${scopedCases.length} Test Cases connect to a Story and traceability path.`]} label="Fully traced cases" tone={linkedCaseCount === scopedCases.length ? "success" : "warning"} value={`${linkedCaseCount}/${scopedCases.length}`} />
        <EvidenceFlipCard caption="Defect evidence" evidence={[`${connectedBugIds.size} distinct Bugs are linked into the visible Story-to-Test Case paths.`]} label="Linked Bugs" tone={connectedBugIds.size ? "warning" : "success"} value={connectedBugIds.size} />
        <EvidenceFlipCard actionLabel={view === "gaps" ? "Show all paths" : "Show mapping gaps"} caption="Open filter from evidence" evidence={[`${gapCount} visible paths are missing a downstream Story, module, Test Case, or Bug mapping.`]} label="Mapping gaps" onAction={() => setView((current) => current === "gaps" ? "all" : "gaps")} tone={gapCount ? "danger" : "success"} value={gapCount} />
      </div>

      <div className="project-traceability-sprints" aria-label="Sprint traceability paths">
        {visibleSprintGroups.map((group) => {
          const isExpanded = expandedSprintIds.includes(group.sprint.id) || Boolean(search);
          const moduleCount = new Set(group.paths.flatMap((path) => path.modules.map((item) => item.id))).size;
          const caseCount = new Set(group.paths.flatMap((path) => path.cases.map((item) => item.id))).size;
          const bugCount = new Set(group.paths.flatMap((path) => path.bugs.map((item) => item.id))).size;
          const sprintState = group.sprint.state || group.sprint.status || "unplanned";
          return (
            <section className={`project-traceability-sprint${isExpanded ? " is-expanded" : ""}`} key={group.sprint.id}>
              <button aria-expanded={isExpanded} className="project-traceability-sprint-toggle" onClick={() => toggleSprint(group.sprint.id)} type="button">
                <span className="project-traceability-sprint-chevron" aria-hidden="true">›</span>
                <span className="project-traceability-sprint-title">
                  <strong>{group.sprint.jira_sprint_name || group.sprint.name}</strong>
                  <small>{sprintState}{group.sprint.goal ? ` · ${group.sprint.goal}` : ""}</small>
                </span>
                <span className="project-traceability-sprint-facts">
                  <span><strong>{group.paths.length}</strong> Stories</span>
                  <span><strong>{moduleCount}</strong> Modules</span>
                  <span><strong>{caseCount}</strong> Cases</span>
                  <span><strong>{bugCount}</strong> Bugs</span>
                </span>
              </button>
              {isExpanded ? (
                <div className="project-traceability-sprint-body">
                  <div className="project-traceability-path-head" aria-hidden="true">
                    <span>Story</span><span>Linked modules</span><span>Linked test cases</span><span>Linked Bugs</span>
                  </div>
                  {group.paths.map((path) => {
                    const isRequirementExpanded = expandedRequirementIds.includes(path.requirement.id);
                    return (
                      <article className={`project-traceability-path${path.isGap ? " is-gap" : ""}`} key={path.requirement.id}>
                        <div className="project-traceability-path-story">
                          <button aria-expanded={isRequirementExpanded} onClick={() => toggleRequirement(path.requirement.id)} type="button">
                            <span className="project-traceability-path-chevron" aria-hidden="true">›</span>
                            <span>
                              {path.requirement.display_id ? <DisplayIdBadge value={path.requirement.display_id} /> : null}
                              <strong>{path.requirement.title}</strong>
                              <small>{path.requirement.status || "No status"}</small>
                            </span>
                          </button>
                          <button aria-label={`Open ${path.requirement.title}`} className="project-traceability-open" onClick={() => onOpen("requirement", path.requirement.id)} title="Open Story" type="button">↗</button>
                        </div>
                        <div className="project-traceability-path-links">
                          <TraceabilityLinkList empty="No linked module" items={path.modules.map((item) => ({ id: item.id, displayId: item.display_id, title: item.name, meta: `${graph.moduleCases.get(item.id)?.size || 0} cases` }))} kind="module" onOpen={onOpen} />
                          <TraceabilityLinkList empty="No linked test case" items={path.cases.map((item) => ({ id: item.id, displayId: item.display_id, title: item.title, meta: item.automated === "yes" ? "Automated" : "Manual" }))} kind="case" onOpen={onOpen} />
                          <TraceabilityLinkList empty="No linked Bug" items={path.bugs.map((item) => ({ id: item.id, displayId: item.jira_bug_key, title: item.title, meta: `${item.status || "No status"}${item.severity ? ` · ${item.severity}` : ""}` }))} kind="bug" onOpen={onOpen} />
                        </div>
                        {isRequirementExpanded ? (
                          <div className="project-traceability-path-summary">
                            <strong>Derived path</strong>
                            <span>{path.modules.length} module{path.modules.length === 1 ? "" : "s"} · {path.cases.length} test case{path.cases.length === 1 ? "" : "s"} · {path.bugs.length} Bug{path.bugs.length === 1 ? "" : "s"}</span>
                            <small>Module links are derived from the Story’s linked cases. Bugs include direct Story, module, and test-case references.</small>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                  {!group.paths.length ? <div className="project-traceability-empty">No Stories match this sprint and filter.</div> : null}
                </div>
              ) : null}
            </section>
          );
        })}
        {!visibleSprintGroups.length ? <div className="project-traceability-empty">No sprint traceability paths match the current filters.</div> : null}
      </div>
      {hasMore ? (
        <div className={`project-traceability-continuation${loadMoreError ? " is-error" : ""}`} role="status">
          <span><strong>{loadMoreError ? "The next work-item page could not be loaded." : "More work items are available."}</strong> {loadMoreError ? "The visible paths remain usable but incomplete; retry when ready." : "Coverage remains provisional until every page is loaded."}</span>
          <button className="ghost-button compact" disabled={isLoadingMore} onClick={onLoadMore} type="button">{isLoadingMore ? "Loading…" : "Load more records"}</button>
        </div>
      ) : null}
      <p className="project-traceability-footnote">Sprint membership comes from loaded connected-workspace and HelloTest sprint assignments. Module and Bug relationships are derived through direct Story, module, and test-case links; unloaded pages are never treated as complete coverage.</p>
    </section>
  );
}

function TraceabilityLinkList({
  empty,
  items,
  kind,
  onOpen
}: {
  empty: string;
  items: Array<{ id: string; displayId?: string | null; title: string; meta: string }>;
  kind: Exclude<NodeKind, "requirement">;
  onOpen: (kind: NodeKind, id: string) => void;
}) {
  if (!items.length) return <div className="project-traceability-link-empty">{empty}</div>;
  return (
    <div className="project-traceability-link-list">
      {items.map((item) => (
        <button key={item.id} onClick={() => onOpen(kind, item.id)} title={`Open ${item.title}`} type="button">
          <span>{item.displayId ? <DisplayIdBadge value={item.displayId} /> : null}<strong>{item.title}</strong></span>
          <small>{item.meta}</small>
        </button>
      ))}
    </div>
  );
}
