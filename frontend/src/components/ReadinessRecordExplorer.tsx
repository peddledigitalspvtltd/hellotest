import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { IconArrowRight, IconChevronDown, IconChevronUp, IconTestPipe, IconBug } from "@tabler/icons-react";
import { useLocalization } from "../context/LocalizationContext";
import { isCriticalReadinessIssue, type ReleaseReadinessModel, type ReadinessCaseEvidence } from "../lib/releaseReadiness";
import type { Issue } from "../types";
import { HierarchyAutoLoadSentinel } from "./HierarchyLoadMoreButton";
import { StatusBadge } from "./StatusBadge";
import "./ReadinessRecordExplorer.css";

type Text = (key: string, values?: Record<string, string | number>) => string;
type Props = {
  kind: "cases" | "bugs";
  model: ReleaseReadinessModel;
  projectId: string;
  filter: string;
  search: string;
  canStories: boolean;
  canCases: boolean;
  canRuns: boolean;
  canBugs: boolean;
  text: Text;
  onInspectStory?: (id: string) => void;
};

export { READINESS_EXPLORER_MESSAGES, READINESS_EXPLORER_MESSAGES_ES } from "../lib/readinessRecordExplorerMessages";

export function matchesReadinessCaseFilter(item: ReadinessCaseEvidence, filter: string) {
  if (filter === "passed") return item.status === "passed";
  if (filter === "failed") return item.results.some(row => row.status === "failed");
  if (filter === "blocked") return item.results.some(row => row.status === "blocked");
  if (filter === "unassessed") return !item.assessed;
  if (filter === "not-run") return item.results.length === 0;
  if (filter === "executed") return item.assessed;
  return true;
}

export function matchesReadinessBugFilter(item: Issue, filter: string, linkedIds: ReadonlySet<string>) {
  if (filter === "critical") return isCriticalReadinessIssue(item);
  if (filter === "high") return !isCriticalReadinessIssue(item) && /high/i.test(`${item.severity || ""} ${item.priority || ""}`);
  if (filter === "linked") return linkedIds.has(item.id);
  return true;
}

export function ReadinessRecordExplorer({ kind, model, projectId, filter, search, canStories, canCases, canRuns, canBugs, text, onInspectStory }: Props) {
  const { formatNumber, formatDate } = useLocalization();
  const [limit, setLimit] = useState(25);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [resultLimits, setResultLimits] = useState<Record<string, number>>({});
  useEffect(() => { setLimit(25); setExpanded(new Set()); setResultLimits({}); }, [kind, projectId, filter, search]);
  const n = (value: number) => formatNumber(value);
  const link = (path: string, key: string, id: string) => `${path}?${new URLSearchParams({ [key]: id, project_id: projectId })}`;
  const stories = useMemo(() => new Map(model.requirements.map(item => [item.id, item])), [model.requirements]);
  const cases = useMemo(() => new Map(model.caseEvidence.map(item => [item.id, item])), [model.caseEvidence]);
  const caseDetails = useMemo(() => new Map(model.testCases.map(item => [item.id, item])), [model.testCases]);
  const runs = useMemo(() => new Map(model.executions.map(item => [item.id, item])), [model.executions]);
  const linkedIssueIds = useMemo(() => new Set(model.linkedIssueIds), [model.linkedIssueIds]);
  const query = search.trim().toLocaleLowerCase();
  const matches = (...values: unknown[]) => values.filter(Boolean).join(" ").toLocaleLowerCase().includes(query);
  const caseRows = canCases ? model.caseEvidence.filter(item => matchesReadinessCaseFilter(item, filter) && matches(
    item.id, item.displayId, item.title,
    canStories ? item.storyIds.map(id => `${stories.get(id)?.display_id || id} ${stories.get(id)?.title || ""}`).join(" ") : "",
    canRuns ? item.runIds.map(id => `${id} ${runs.get(id)?.name || ""}`).join(" ") : "",
  )) : [];
  const bugs = canBugs ? model.openIssues.filter(item => matchesReadinessBugFilter(item, filter, linkedIssueIds) && matches(item.id, item.display_id, item.jira_bug_key, item.title, item.severity, item.priority, item.status)) : [];
  const recordsAvailable = kind === "cases" ? canCases : canBugs;
  const filterAvailable = kind === "cases" ? filter === "all" || !filter || canRuns : filter !== "linked" || canStories || canCases || canRuns;
  if (!recordsAvailable || !filterAvailable) return <div className="rr-empty rr-record-empty" role="status"><h3>{text("source.unavailable")}</h3><p>{text(!recordsAvailable ? kind === "cases" ? "explorer.caseUnavailable" : "explorer.bugUnavailable" : kind === "cases" ? "explorer.runUnavailable" : "explorer.linksUnavailable")}</p></div>;
  const total = kind === "cases" ? caseRows.length : bugs.length;
  if (!total) return <div className="rr-empty rr-record-empty" role="status">{kind === "cases" ? <IconTestPipe size={28} /> : <IconBug size={28} />}<h3>{text(search.trim() || filter && filter !== "all" ? "noMatches" : kind === "cases" ? "explorer.noCases" : "explorer.noBugs")}</h3><p>{text("refineSearch")}</p></div>;

  const toggle = (id: string) => setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const storyLink = (id: string) => onInspectStory
    ? <button className="rr-record-reference" onClick={() => onInspectStory(id)} type="button">{stories.get(id)?.display_id || id}<span>{stories.get(id)?.title}</span></button>
    : <Link className="rr-record-reference" to={link("/stories", "requirement", id)}>{stories.get(id)?.display_id || id}<span>{stories.get(id)?.title}</span></Link>;
  const runLink = (id: string) => <Link className="rr-record-reference" to={link("/executions", "execution", id)}>{runs.get(id)?.name || id}<IconArrowRight size={12} /></Link>;
  const groupLinks = (item: ReadinessCaseEvidence) => <div className="rr-record-references">
    {canStories && item.storyIds.length > 0 && <div><strong>{text("explorer.stories", { count: n(item.storyIds.length) })}</strong><ul>{item.storyIds.map(id => <li key={id}>{storyLink(id)}</li>)}</ul></div>}
    {canRuns && item.runIds.length > 0 && <div><strong>{text("explorer.runs", { count: n(item.runIds.length) })}</strong><ul>{item.runIds.map(id => <li key={id}>{runLink(id)}</li>)}</ul></div>}
    {!canStories && !canRuns ? <p>{text("explorer.linksUnavailable")}</p> : !(canStories && item.storyIds.length || canRuns && item.runIds.length) ? <p>{text("explorer.noLinks")}</p> : null}
  </div>;

  return <div className={`rr-record-explorer rr-record-explorer--${kind}`}>
    <table className="rr-record-table"><caption className="rr-record-caption">{text(kind === "cases" ? "source.cases" : "source.bugs")}</caption><thead><tr>
      <th scope="col">{text(kind === "cases" ? "explorer.case" : "explorer.bug")}</th><th scope="col">{text(kind === "cases" ? "explorer.status" : "explorer.severity")}</th><th scope="col">{text("explorer.relationships")}</th><th scope="col">{text(kind === "cases" ? "explorer.outcomes" : "explorer.status")}</th>
    </tr></thead><tbody>
      {kind === "cases" ? caseRows.slice(0, limit).map(item => {
        const isExpanded = expanded.has(item.id);
        const title = item.title || item.displayId;
        const detailId = `rr-case-evidence-${encodeURIComponent(item.id)}`;
        const passed = item.results.filter(row => row.status === "passed").length;
        const failed = item.results.filter(row => row.status === "failed").length;
        const blocked = item.results.filter(row => row.status === "blocked").length;
        const unassessed = item.results.length - passed - failed + item.missingRows;
        return <Fragment key={item.id}><tr className={isExpanded ? "is-expanded" : ""}>
          <td data-label={text("explorer.case")}><span className="rr-record-id">{item.displayId}</span><Link className="rr-record-title" to={link("/test-cases", "case", item.id)}>{title}<IconArrowRight size={13} /></Link>{!item.detailsAvailable && <small className="rr-record-warning">{text("explorer.detailsUnavailable")}</small>}<button className="rr-record-expand" aria-expanded={isExpanded} aria-controls={detailId} aria-label={text(isExpanded ? "explorer.hideCase" : "explorer.inspectCase", { case: title })} onClick={() => toggle(item.id)} type="button">{isExpanded ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}{text(isExpanded ? "explorer.hideEvidence" : "explorer.showEvidence")}</button></td>
          <td data-label={text("explorer.status")}>{canRuns ? <span className={`rr-case-state is-${item.status}`}>{text(`explorer.caseStatus.${item.status}`)}</span> : <span className="rr-record-muted">{text("source.unavailable")}</span>}</td>
          <td data-label={text("explorer.relationships")}><div className="rr-record-link-counts">{canStories && <span>{text("explorer.stories", { count: n(item.storyIds.length) })}</span>}{canRuns && <span>{text("explorer.runs", { count: n(item.runIds.length) })}</span>}{!canStories && !canRuns && <span>{text("source.unavailable")}</span>}</div></td>
          <td data-label={text("explorer.outcomes")}>{canRuns ? <div className="rr-record-outcomes"><span className="is-passed">{text("passed", { count: n(passed) })}</span>{failed > 0 && <span className="is-failed">{text("failed", { count: n(failed) })}</span>}{blocked > 0 && <span className="is-blocked">{text("blocked", { count: n(blocked) })}</span>}{unassessed > 0 && <span>{text("notAssessed", { count: n(unassessed) })}</span>}</div> : <span className="rr-record-muted">{text("source.unavailable")}</span>}</td>
        </tr>{isExpanded && <tr className="rr-record-detail-row" id={detailId}><td colSpan={4}><section className="rr-case-evidence" aria-label={text("explorer.evidenceFor", { case: title })}>
          {groupLinks(item)}
          {canRuns ? <div className="rr-case-run-evidence"><h3>{text("explorer.latestRows", { count: n(item.results.length) })}</h3>{!item.results.length && <p>{text("explorer.noRows")}</p>}
            {item.runEvidence.map(evidence => {
              const resultKey = `${item.id}:${evidence.runId}`;
              const rowLimit = resultLimits[resultKey] || 25;
              return <section className="rr-case-run" key={evidence.runId}><header>{runLink(evidence.runId)}<span>{text("explorer.runRows", { observed: n(evidence.results.length), expected: n(evidence.expectedRows), missing: n(evidence.missingRows) })}</span></header>
                {evidence.results.length > 0 && <ol className="rr-case-result-list">{evidence.results.slice(0, rowLimit).map(result => <li key={result.id}><div><strong>{result.data_set_iteration_key || (result.data_set_iteration_index != null ? text("explorer.dataRow", { number: n(result.data_set_iteration_index + 1) }) : text("explorer.defaultRow"))}</strong><small>{result.id}</small>{(result.test_data_set_name || result.test_data_set_id) && <small>{text("dataSet")}: {result.test_data_set_name || result.test_data_set_id}</small>}</div><StatusBadge value={result.status} /><time dateTime={result.created_at || undefined}>{result.created_at ? formatDate(result.created_at) : text("notRecorded")}</time></li>)}</ol>}
                {evidence.results.length > rowLimit && <button className="rr-link-button" onClick={() => setResultLimits(current => ({ ...current, [resultKey]: rowLimit + 25 }))} type="button">{text("explorer.showMore")}</button>}
              </section>;
            })}
          </div> : <p className="rr-record-muted">{text("explorer.runUnavailable")}</p>}
        </section></td></tr>}</Fragment>;
      }) : bugs.slice(0, limit).map(issue => {
        const issueIds = new Set([issue.id, issue.jira_bug_key].filter(Boolean).map(id => String(id).trim().toLocaleLowerCase()));
        const referencesIssue = (ids: string[] | undefined) => (ids || []).some(id => issueIds.has(id.trim().toLocaleLowerCase()));
        const storyIds = canStories ? model.hotspots.filter(story => story.openIssueIds.includes(issue.id)).map(story => story.id) : [];
        const caseIds = canCases ? model.caseEvidence.filter(item => issue.linked_test_case_ids?.includes(item.id)
          || referencesIssue(caseDetails.get(item.id)?.defect_ids)
          || canRuns && item.results.some(result => referencesIssue(result.defects))).map(item => item.id) : [];
        const runIds = canRuns ? [...new Set([
          ...(issue.linked_test_run_id && runs.has(issue.linked_test_run_id) ? [issue.linked_test_run_id] : []),
          ...model.latestCaseResults.filter(result => referencesIssue(result.defects)).map(result => result.execution_id),
        ])] : [];
        const hasLinks = storyIds.length + caseIds.length + runIds.length > 0;
        return <tr key={issue.id}><td data-label={text("explorer.bug")}><span className="rr-record-id">{issue.jira_bug_key || issue.display_id || issue.id}</span><Link className="rr-record-title" to={link("/issues", "issue", issue.id)}>{issue.title}<IconArrowRight size={13} /></Link></td>
          <td data-label={text("explorer.severity")}><span className={isCriticalReadinessIssue(issue) ? "rr-record-critical" : ""}>{issue.severity || issue.priority || text("notRecorded")}</span>{issue.severity && issue.priority && issue.severity !== issue.priority && <small className="rr-record-muted">{issue.priority}</small>}</td>
          <td data-label={text("explorer.relationships")}>{!canStories && !canCases && !canRuns ? <span className="rr-record-muted">{text("source.unavailable")}</span> : hasLinks ? <details className="rr-bug-links"><summary>{[storyIds.length ? text("explorer.stories", { count: n(storyIds.length) }) : "", caseIds.length ? text("explorer.cases", { count: n(caseIds.length) }) : "", runIds.length ? text("explorer.runs", { count: n(runIds.length) }) : ""].filter(Boolean).join(" · ")}<IconChevronDown size={13} /></summary><div className="rr-record-references"><ul>{storyIds.map(id => <li key={`story:${id}`}>{storyLink(id)}</li>)}{caseIds.map(id => <li key={`case:${id}`}><Link className="rr-record-reference" to={link("/test-cases", "case", id)}>{cases.get(id)?.title || cases.get(id)?.displayId || id}<IconArrowRight size={12} /></Link></li>)}{runIds.map(id => <li key={`run:${id}`}>{runLink(id)}</li>)}</ul></div></details> : <span className="rr-record-muted">{text("explorer.noLinks")}</span>}</td>
          <td data-label={text("explorer.status")}><StatusBadge value={issue.status} /></td></tr>;
      })}
    </tbody></table>
    <footer className="rr-record-footer"><span>{text("explorer.showing", { shown: n(Math.min(limit, total)), total: n(total) })}</span><span>{text("explorer.linksScope")}</span></footer>
    {total > limit && <HierarchyAutoLoadSentinel isLoading={false} onLoad={() => setLimit(value => value + 25)} progressKey={`${kind}:${limit}`} scopeLabel={text(kind === "cases" ? "source.cases" : "source.bugs")} />}
  </div>;
}
