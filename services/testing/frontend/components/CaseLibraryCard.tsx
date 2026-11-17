import type { ComponentProps, ReactNode } from "react";
import { CaseEvidenceLineage } from "./CaseEvidenceLineage";
import { useNavigate } from "react-router-dom";
import { StoryIcon, TestCaseIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { CatalogActionMenu } from "@hellotest/platform/frontend/src/shared/components/CatalogActionMenu";
import { CatalogCardDescription } from "@hellotest/platform/frontend/src/shared/components/CatalogCardDescription";
import { DisplayIdBadge } from "@hellotest/platform/frontend/src/shared/components/DisplayIdBadge";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { TileCardMetric, TileCardProgress } from "@hellotest/platform/frontend/src/shared/components/TileCardPrimitives";
import { buildHistoryStatusBreakdown, buildReadinessScoreBreakdown } from "@hellotest/platform/frontend/src/shared/lib/tileProgressBreakdown";
import type { ExecutionResult, TestCase } from "@hellotest/platform/frontend/src/types";

type CaseLibraryCardProps = {
 testCase: TestCase & { latest_manual_result?: ExecutionResult | null; latest_automation_result?: ExecutionResult | null }; history: ExecutionResult[]; tileActions: ComponentProps<typeof CatalogActionMenu>["actions"]; reviewDecision: ReactNode;
 isActive: boolean; isSelectedForAction: boolean; isFailedCase: boolean; isUnlinkedCase: boolean; isModuleChild: boolean;
 canUpdateTestCases: boolean; isDeletingSelectedTestCases: boolean; isBulkReviewRunning: boolean; canUseAutomationWorkspace: boolean;
 requirementDisplayId: string; requirementTitle: string; statusLabel: string; stepCount?: number;
 automationReadiness: number | null; stabilityScore: number; passedRuns: number; linkedDefectCount: number; qualityScore: number | null; failedRunCount: number;
 aiInsightTone: string; aiInsight: string;
 onOpen: () => void; onDragEnd: () => void; onDragStart: (transfer: DataTransfer) => void; onToggleSelected: (checked: boolean) => void; openLibraryCase: (id: string) => void;
};

export function CaseLibraryCard({ testCase, history, tileActions, reviewDecision, isActive, isSelectedForAction, isFailedCase, isUnlinkedCase, isModuleChild, canUpdateTestCases, isDeletingSelectedTestCases, isBulkReviewRunning, canUseAutomationWorkspace, requirementDisplayId, requirementTitle, statusLabel, stepCount, automationReadiness, stabilityScore, passedRuns, linkedDefectCount, qualityScore, failedRunCount, aiInsightTone, aiInsight, onOpen, onDragEnd, onDragStart, onToggleSelected, openLibraryCase }: CaseLibraryCardProps) {
 const navigate = useNavigate();
 return (<article
                        aria-label={`Open test case ${testCase.display_id || testCase.id}: ${testCase.title}`}
                        aria-current={isActive ? "true" : undefined}
                        className={[
                          "record-card tile-card test-case-card test-case-catalog-card",
                          isFailedCase ? "is-risk" : isUnlinkedCase || stabilityScore < 60 ? "is-warning" : "is-healthy",
                          isActive ? "is-active" : "",
                          isSelectedForAction ? "is-marked-for-delete" : "",
                          isModuleChild ? "is-module-child" : ""
                        ].filter(Boolean).join(" ")}
                        draggable={canUpdateTestCases && !isDeletingSelectedTestCases}
                        onClick={onOpen}
                        onDragEnd={onDragEnd}
                        onDragStart={(event) => {
                          onDragStart(event.dataTransfer);
                        }}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) {
                            return;
                          }

                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onOpen();
                          }
                        }}
                      >
                        <div className="tile-card-main">
                          <div className="tile-card-select-row test-case-card-header">
                            <label className="checkbox-field test-case-delete-checkbox" onClick={(event) => event.stopPropagation()}>
	                              <input
	                                checked={isSelectedForAction}
                                aria-label={`Select Test Case ${testCase.title}`}
                                disabled={isBulkReviewRunning}
                                onChange={event => onToggleSelected(event.target.checked)}
		                                type="checkbox"
		                              />
		                            </label>
		                            <span className="test-case-identity">
		                              <TestCaseIcon size={16} />
		                              <DisplayIdBadge value={testCase.display_id || testCase.id} />
		                            </span>
	                            <div className="catalog-inline-actions test-case-top-actions">
	                              {reviewDecision}
	                              <StatusBadge value={statusLabel} />
	                              <div onClick={(event) => event.stopPropagation()}>
	                                <CatalogActionMenu actions={tileActions} label={`${testCase.title} actions`} />
	                              </div>
	                            </div>
		                          </div>
		                          <div className="test-case-requirement-block">
		                            <span className="test-case-requirement-label">Story</span>
		                            <p>
		                              {requirementDisplayId ? (
                                        <span className="test-case-linked-story-id requirement-story-identity">
                                          <StoryIcon size={14} />
                                          <DisplayIdBadge value={requirementDisplayId} />
                                        </span>
                                      ) : null}
		                              <strong title={requirementTitle || "No story linked"}>{requirementTitle || "No story linked"}</strong>
		                            </p>
		                          </div>
		                          <div className="tile-card-title-group test-case-card-title-group test-case-card-title-group--identity">
		                            <button className="tile-card-open-button" onClick={event => { event.stopPropagation(); onOpen(); }} type="button"><strong>{testCase.title}</strong></button>
		                          </div>
	                          <CatalogCardDescription
	                            fallback="No description yet for this test case."
	                            profile="test-case"
	                            value={testCase.description}
	                          />
                          <div className="test-case-readiness-grid test-case-card-progress-stack">
                            {canUseAutomationWorkspace ? <TileCardProgress
                              breakdown={buildReadinessScoreBreakdown(automationReadiness)}
                              displayValue={automationReadiness === null ? "On open" : `${automationReadiness}%`}
                              criteriaKey="metric.library.automation_candidate" population="catalog_case_authoring_signals" unit="percent" label="Automation candidate"
                              title={automationReadiness === null ? "Automation readiness available on open" : `${automationReadiness}% automation readiness score`}
                              value={automationReadiness}
                            /> : null}
                            <TileCardProgress
                              breakdown={buildHistoryStatusBreakdown(history)}
                              displayValue={history.length ? `${stabilityScore}%` : "No runs"}
                              criteriaKey="metric.library.observed_stability" population="recent_case_observations" unit="percent" label="Stability"
                              title={history.length ? `${passedRuns} of the last ${history.length} case results passed` : "No recent run stability"}
                              tone={!history.length ? "neutral" : stabilityScore >= 80 ? "success" : stabilityScore >= 60 ? "warning" : "danger"}
                              value={history.length ? stabilityScore : null}
                            />
                          </div>
                          {testCase.automated === "yes" ? <span>Latest automation outcome: {history[0]?.status || "No runs"}</span> : <CaseEvidenceLineage history={history} channels={"latest_manual_result" in testCase ? {manual: testCase.latest_manual_result, automation: testCase.latest_automation_result} : undefined} onOpen={result => navigate(`/executions?${new URLSearchParams({ execution: result.execution_id, testCase: result.source_test_case_id || result.test_case_id })}`)} />}
                          {testCase.automated !== "yes" && canUseAutomationWorkspace ? <button className="link-button" type="button" onClick={event => { event.stopPropagation(); navigate(`/automation?create=1&manual=${encodeURIComponent(testCase.id)}&editor=api`); }}>Create automation twin{testCase.automation_coverage?.linked_case_count ? ` · ${testCase.automation_coverage.linked_case_count} linked` : ""}</button> : null}
                          {testCase.linked_automation_cases?.map(twin => <button className="link-button" key={twin.id} type="button" onClick={event => { event.stopPropagation(); navigate(`/automation?case=${encodeURIComponent(twin.id)}`); }}>Twin {twin.display_id || twin.title}</button>)}
                          {testCase.manual_test_case_id ? <button className="link-button" type="button" onClick={event => { event.stopPropagation(); openLibraryCase(testCase.manual_test_case_id!); }}>Manual origin</button> : null}
                          <div className="tile-card-facts test-case-tile-metrics" aria-label={`${testCase.title} facts`}>
                            <TileCardMetric
                              className="test-case-tile-metric"
                              label="Steps"
                              title={stepCount === undefined ? "Open this case to load step details" : `${stepCount} step${stepCount === 1 ? "" : "s"}`}
                              tone={stepCount ? "success" : "neutral"}
                              value={stepCount ?? "—"}
                            />
                            <TileCardMetric
                              className="test-case-tile-metric"
                              label="Defect density"
                              title={`${linkedDefectCount} distinct linked defect${linkedDefectCount === 1 ? "" : "s"} per Test Case`}
                              tone={linkedDefectCount ? "warning" : "success"}
                              value={linkedDefectCount.toFixed(2)}
                            />
                            <TileCardMetric
                              className="test-case-tile-metric"
                              label="Test Quality"
                              title={qualityScore === null ? "Open this case to calculate its Test Quality Score" : `${qualityScore}% Test Quality Score`}
                              tone={qualityScore === null ? "neutral" : qualityScore >= 80 ? "success" : qualityScore >= 60 ? "info" : "warning"}
                              value={qualityScore === null ? "—" : `${qualityScore}%`}
                            />
                            <TileCardMetric
                              className="test-case-tile-metric"
                              label="Failed"
                              title={`${failedRunCount} failed or blocked recent run${failedRunCount === 1 ? "" : "s"}`}
                              tone={failedRunCount ? "danger" : "success"}
                              value={failedRunCount ? `${failedRunCount}x` : "0x"}
                            />
                          </div>
                          <div className="tile-card-footer test-case-card-footer">
                            <div className={`test-case-ai-note ${aiInsightTone}`}>
                              <span aria-hidden="true">{isFailedCase ? "!" : "S"}</span>
                              <p>{aiInsight}</p>
                            </div>
                          </div>
                        </div>
                      </article>);
}
