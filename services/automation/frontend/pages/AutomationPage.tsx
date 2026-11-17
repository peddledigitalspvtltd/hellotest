import { lazy, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCurrentProject, useCurrentAppType } from '@hellotest/platform/frontend/src/platform/hooks/useCurrentProject';
import { LoadingState } from '@hellotest/platform/frontend/src/shared/components/LoadingState';
import { AutomationAuthoringProvider, useAutomationAuthoring, useAutomationSelection } from '../hooks/AutomationAuthoringProvider';
import { selectionMatchesCaseRoute } from '../lib/automationSelectionState';
import '../components/AutomationWorkspace.css';

const AutomationCasesPage = lazy(() => import('../routes/AutomationCasesPage').then(module => ({ default: module.AutomationCasesPage })));
const AutomationCaseDetailPage = lazy(() => import('../routes/AutomationCaseDetailPage').then(module => ({ default: module.AutomationCaseDetailPage })));
const ObjectRepositoryPage = lazy(() => import('../routes/ObjectRepositoryPage').then(module => ({ default: module.ObjectRepositoryPage })));

/** A live capture belongs to its case, rather than to whichever screen is mounted. */
function RecordingContinuity({ currentCaseId }: { currentCaseId: string }) {
  const authoring = useAutomationAuthoring();
  const selection = useAutomationSelection();
  const active = authoring.activeRecording();
  if (!active || selectionMatchesCaseRoute(selection.state, active.caseId, currentCaseId)) return null;
  return <aside className="automation-recording-continuity" role="status">
    <span>{active.phase === 'record_starting' ? 'A recording is starting in another case.' : 'A recording is open in another case.'}</span>{' '}
    <Link className="ghost-button compact" to={`/automation?case=${encodeURIComponent(active.caseId)}&tab=build&build_method=record`}>Return to recording</Link>
  </aside>;
}

/** Each route loads its own queries, mutations and view state. The shared provider
 * retains only authoring claims, capture context and explicit selections. */
export function AutomationPage({ initialView = 'cases' }: { initialView?: 'cases' | 'repository' } = {}) {
  const [projectId] = useCurrentProject();
  const [appTypeId] = useCurrentAppType(projectId);
  const [params] = useSearchParams();
  const caseId = initialView === 'cases' && params.get('create') !== '1' ? params.get('case') || '' : '';
  return <AutomationAuthoringProvider projectId={projectId} appTypeId={appTypeId}>
    <RecordingContinuity currentCaseId={initialView === 'repository' ? '' : caseId}/>
    <Suspense fallback={<LoadingState label={initialView === 'repository' ? 'Loading object repository' : caseId ? 'Loading automation case' : 'Loading automation cases'}/>}>
      {initialView === 'repository' ? <ObjectRepositoryPage/> : caseId ? <AutomationCaseDetailPage/> : <AutomationCasesPage/>}
    </Suspense>
  </AutomationAuthoringProvider>;
}
