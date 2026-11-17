import {QualityMetricStrip} from '@hellotest/dashboard/frontend/components/QualityMetricStrip';

type Coverage = {totalCases: number; coveragePercent: number; testCaseTotal: number; testCasePassed: number; bugTotal: number; bugResolved: number};
const rate = (passed: number, total: number) => total ? `${Math.round(passed / total * 100)}%` : '—';

export function ProjectQualityMetrics({coverage, ready, onInspect}: {coverage: Coverage; ready: boolean; onInspect: () => void}) {
  return <QualityMetricStrip ariaLabel="Project quality evidence" metrics={[
    {label: 'Quality confidence', criteriaKey: 'metric.project.quality_confidence', population: 'project_finalized_cases_and_defects', unit: 'percent',
      value: ready && coverage.totalCases ? `${coverage.coveragePercent}%` : '—',
      detail: `${coverage.testCasePassed}/${coverage.testCaseTotal} finalized case identities passed; ${coverage.bugResolved}/${coverage.bugTotal} Defects resolved. This combines two populations.`, onClick: onInspect},
    {label: 'Case pass rate', criteriaKey: 'metric.project.case_pass_rate', population: 'project_latest_finalized_cases', unit: 'percent',
      value: ready ? rate(coverage.testCasePassed, coverage.testCaseTotal) : '—', detail: `${coverage.testCasePassed} passed of ${coverage.testCaseTotal} case identities with a latest finalized result.`, onClick: onInspect},
    {label: 'Defect resolution', criteriaKey: 'metric.project.defect_resolution', population: 'project_defects', unit: 'percent',
      value: ready ? rate(coverage.bugResolved, coverage.bugTotal) : '—', detail: `${coverage.bugResolved} resolved of ${coverage.bugTotal} linked Defects. No Defects produces no resolution rate.`, onClick: onInspect}
  ]} />;
}
