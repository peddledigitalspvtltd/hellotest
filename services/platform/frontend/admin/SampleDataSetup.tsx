import { LoadingState } from "../src/shared/components/LoadingState";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconArrowRight, IconCheck, IconDatabase, IconRefresh, IconSearch, IconAlertCircle, IconLayersIntersect } from '@tabler/icons-react';
import { adminApi, workspaceUrl, type Overview, type SampleCatalog, type SampleInstallResult, type SampleSetupJob, type SampleSetupState } from './api';
import { SetupRoles } from './SetupRoles';
import { PerformanceIndexing } from './PerformanceIndexing';
import './sample-data-setup.css';

type Props = { schema: Overview['schema']; notify: (message: string, tone?: 'success' | 'error') => void; refresh: () => void };
export function resolveSampleSelection(catalog: SampleCatalog | null, selected: string[]) {
  const included = new Set<string>();
  const byKey = new Map(catalog?.modules.map(module => [module.key, module]));
  const visit = (key: string) => { if (included.has(key) || !byKey.has(key)) return; included.add(key); byKey.get(key)?.depends_on.forEach(visit); };
  selected.forEach(visit);
  return included;
}
export function SampleDataSetup({ schema, notify, refresh }: Props) {
  const [catalog, setCatalog] = useState<SampleCatalog | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('All modules');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [operation, setBusy] = useState<'schema' | 'samples' | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<SampleInstallResult | null>(null);
  const [job, setJob] = useState<SampleSetupJob | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [statusRevision, setStatusRevision] = useState(0);
  const initialized = useRef(false);
  const mounted = useRef(true);
  const jobId = useRef<string | undefined>();
  const requestGeneration = useRef(0);
  const actionController = useRef<AbortController | null>(null);
  const recoveringRequest = useRef<{ previousJobId: string | undefined; retry: boolean } | null>(null);
  const completedNotice = useRef('');
  const callbacks = useRef({ notify, refresh });
  callbacks.current = { notify, refresh };
  const running = job?.status === 'queued' || job?.status === 'running' || (job?.status === 'completed' && !job.result);
  const busy = operation || (running ? 'samples' : null);
  const setupUnavailable = Boolean(busy) || statusLoading || Boolean(statusError);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; actionController.current?.abort(); }; }, []);
  const acceptStatus = useCallback((state: SampleSetupState) => {
    const next = state.job;
    const changedJob = next?.id !== jobId.current;
    const recovery = recoveringRequest.current;
    recoveringRequest.current = null;
    jobId.current = next?.id;
    setJob(next); setStatusLoading(false); setStatusError('');
    // A rejected new request may leave the previous completed/failed job as the
    // latest record. Its result must not replace this request's error or selection.
    if (recovery && !recovery.retry && next?.id === recovery.previousJobId && (next?.status === 'completed' || next?.status === 'failed')) return;
    if (next && (changedJob || next.status === 'queued' || next.status === 'running')) {
      initialized.current = true;
      setSelected(next.requested_modules);
      if (next.status === 'queued' || next.status === 'running') setError('');
    }
    if (next?.status === 'completed' && next.result) {
      setResult(next.result);
      const noticeKey = `${next.id}:${next.finished_at}`;
      if (completedNotice.current !== noticeKey) {
        completedNotice.current = noticeKey;
        const value = next.result;
        setError('');
        callbacks.current.notify(`${value.inserted_records} sample records added across ${value.installed.length} modules.${value.project_id ? ` ${value.administrator_memberships} administrator memberships added.` : ''}`);
        callbacks.current.refresh(); setReload(current => current + 1);
      }
    } else {
      setResult(null);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const generation = requestGeneration.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const poll = async () => {
      try {
        const state = await adminApi.sampleSetupStatus({ jobId: jobId.current, signal: controller.signal });
        if (controller.signal.aborted || requestGeneration.current !== generation) return;
        acceptStatus(state); failures = 0;
        // A completed status without a final result is not a successful installation.
        if (state.running || state.job?.status === 'queued' || state.job?.status === 'running' || (state.job?.status === 'completed' && !state.job.result)) {
          timer = setTimeout(() => void poll(), 1500);
        }
      } catch (reason) {
        if (controller.signal.aborted || requestGeneration.current !== generation) return;
        setStatusLoading(false);
        setStatusError(reason instanceof Error ? reason.message : 'Setup status could not be loaded.');
        // Read status again after a connection failure; never resubmit an uncertain install.
        failures += 1;
        timer = setTimeout(() => void poll(), Math.min(1500 * 2 ** failures, 15000));
      }
    };
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [acceptStatus, statusRevision]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void adminApi.sampleCatalog({ signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setCatalog(value);
      if (!initialized.current) { setSelected(value.modules.map(module => module.key)); initialized.current = true; }
      setLoading(false);
    }).catch(reason => {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : 'Sample catalog could not be loaded.'); setLoading(false);
    });
    return () => controller.abort();
  }, [reload]);
  const included = useMemo(() => resolveSampleSelection(catalog, selected), [catalog, selected]);
  const modules = catalog?.modules || [];
  const dependencies = modules.filter(module => included.has(module.key) && !selected.includes(module.key));
  const totalRecords = modules.filter(module => included.has(module.key)).reduce((sum, module) => sum + module.expected_record_count, 0);
  const missingRecords = modules.filter(module => included.has(module.key)).reduce((sum, module) => sum + Math.max(0, module.expected_record_count - module.record_count), 0);
  const installed = modules.filter(module => module.status === 'installed').length;
  const groups = [...new Set(modules.map(module => module.group))];
  const query = search.trim().toLowerCase();
  const filtered = modules.filter(module => (group === 'All modules' || module.group === group) && `${module.label} ${module.description} ${module.features.join(' ')}`.toLowerCase().includes(query));
  const selectPreset = (preset: 'all' | 'qa' | 'ai' | 'people') => {
    setSelected(preset === 'all' ? modules.map(module => module.key) : preset === 'qa' ? ['dashboards', 'testops'] : preset === 'people' ? ['workspace_roles'] : ['agents']);
    setResult(null);
  };
  const applySchema = async () => {
    setBusy('schema'); setError('');
    try { await adminApi.applySchema(); if (!mounted.current) return; notify('Schema validation completed.'); refresh(); setReload(value => value + 1); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Schema setup failed.'); }
    finally { if (mounted.current) setBusy(null); }
  };
  const install = async (retry = false) => {
    if (setupUnavailable || indexing || (!retry && (!selected.length || loading))) return;
    const retryId = retry ? job?.id : undefined;
    if (retry && (!retryId || job?.status !== 'failed')) return;
    requestGeneration.current += 1;
    actionController.current?.abort();
    const controller = new AbortController();
    actionController.current = controller;
    const previousJobId = jobId.current;
    setBusy('samples'); setError(''); setResult(null);
    try {
      const state = retryId ? await adminApi.retrySampleSetup(retryId, { signal: controller.signal }) : await adminApi.seedSamples(selected, { signal: controller.signal });
      if (controller.signal.aborted || !mounted.current) return;
      acceptStatus(state);
    } catch (reason) {
      if (controller.signal.aborted || !mounted.current) return;
      setError(reason instanceof Error ? reason.message : 'The setup request could not be confirmed. Your selection is retained.');
      // The server may have accepted a request whose response was lost. Recover the
      // durable job first, including when this was a retry of an existing job.
      jobId.current = undefined;
      recoveringRequest.current = { previousJobId, retry };
      setStatusLoading(true);
    } finally {
      if (mounted.current && !controller.signal.aborted) { setBusy(null); setStatusRevision(current => current + 1); }
    }
  };
  const phaseLabel = job?.status === 'failed' ? 'Setup needs attention'
    : job?.status === 'completed' && job.result ? 'All files verified'
      : job?.status === 'queued' ? 'Waiting to start'
        : job?.phase === 'validating' ? 'Validating dataset'
          : job?.phase === 'verifying' || job?.status === 'completed' ? 'Verifying relationships' : 'Installing records';
  const currentFile = job?.files.find(file => file.key === job.current_file || file.path === job.current_file);
  const installLabel = statusLoading ? 'Checking setup…' : operation === 'samples' ? 'Starting setup…' : running ? 'Installing samples…' : 'Install selected samples';
  return <div className="sample-setup">
    <section className="surface sample-schema"><div className="sample-schema-icon"><IconDatabase size={23} aria-hidden="true" /></div><div><p className="kicker">Foundation</p><h3>Shared database schema</h3><p>{schema.missing_tables.length ? `${schema.missing_tables.length} required tables need attention.` : 'Database, permissions and audit tables are ready.'}</p></div><span className="safe-chip">{schema.available_tables}/{schema.required_tables} tables</span><button className="secondary-button" disabled={setupUnavailable || indexing} onClick={() => void applySchema()} type="button">{busy === 'schema' ? <LoadingState label="Validating schema" /> : <IconRefresh size={16} aria-hidden="true" />}{busy === 'schema' ? 'Validating…' : 'Validate schema'}</button><PerformanceIndexing disabled={setupUnavailable || schema.status !== 'ready'} onRunningChange={setIndexing} /></section>
    <section className="surface sample-intro"><div><p className="kicker">Explore the product</p><h3>Module sample data</h3><p>{catalog?.description || 'Explore HelloTest feature planning, workspace roles and connected sample journeys across Web, API and Mobile.'}</p></div><div className="sample-stats" aria-label="Sample coverage"><div><strong>{modules.length || '—'}</strong><span>Module Groups</span></div><div><strong>{modules.reduce((sum, module) => sum + module.features.length, 0) || '—'}</strong><span>Feature Examples</span></div><div><strong>{installed}/{modules.length}</strong><span>Fully Installed</span></div></div></section>
    {error ? <div className="sample-message is-error" role="alert"><IconAlertCircle size={20} aria-hidden="true" /><div><strong>{catalog ? 'The request could not be completed' : 'Sample catalog is unavailable'}</strong><p>{error}</p></div><button className="secondary-button" disabled={Boolean(busy)} onClick={() => setReload(value => value + 1)} type="button">Reload catalog</button></div> : null}
    {statusError ? <div className="sample-message is-error" role="alert"><IconAlertCircle size={20} aria-hidden="true" /><div><strong>Reconnecting to setup</strong><p>{statusError} Status checks will retry automatically. Any accepted setup continues on the server.</p></div><button className="secondary-button" type="button" onClick={() => setStatusRevision(current => current + 1)}><IconRefresh size={16} aria-hidden="true" />Check status</button></div> : null}
    {job ? <section className={`surface sample-job is-${job.status}`} aria-label="Instance setup progress" aria-busy={running}>
      <header><div><p className="kicker">Repository dataset · Version {job.dataset_version}</p><h3>{phaseLabel}</h3></div><span className="safe-chip">{job.completed_files}/{job.total_files} files processed</span></header>
      <p className="sample-job-status" role="status">{job.status === 'failed' ? job.error?.message || 'Setup stopped before all files could be verified. Your selection and completed records are retained.' : job.status === 'completed' && job.result ? 'All selected files have been processed and their required relationships checked.' : job.phase === 'verifying' || job.status === 'completed' ? 'Checking the saved records and relationships before marking setup as passed.' : currentFile ? `Processing ${currentFile.path}` : job.status === 'queued' ? 'Setup is queued. You can leave this page and return to follow progress.' : 'Checking the selected files and their dependencies.'}</p>
      <progress aria-label="Instance setup file progress" value={job.completed_files} max={Math.max(1, job.total_files)} />
      {job.status === 'failed' ? <div className="sample-job-recovery"><p>{job.error?.file ? <>File: <code>{job.error.file}</code>. </> : null}{job.error?.retryable ? 'Retry resumes this installation and retains existing records.' : 'Resolve the reported problem, then retry. Existing records are retained.'}</p><button className="secondary-button" type="button" disabled={setupUnavailable || indexing} onClick={() => void install(true)}><IconRefresh size={16} aria-hidden="true" />Retry setup</button></div> : null}
      <details className="sample-job-files"><summary>View file results ({job.files.length})</summary><ol>{job.files.map(file => <li key={file.key} className={`is-${file.status}`}><div><strong>{file.path}</strong><span>{modules.find(module => module.key === file.module)?.label || file.module}{file.attempts > 1 ? ` · Attempt ${file.attempts}` : ''}{file.status === 'completed' ? ` · ${file.inserted_records || 0} added · ${file.existing_records || 0} retained` : ''}</span>{file.error ? <p>{file.error}</p> : null}</div><span className="sample-file-status">{file.status === 'completed' ? 'Processed' : file.status === 'retrying' ? 'Retrying' : file.status === 'running' ? 'Processing' : file.status === 'failed' ? 'Failed' : 'Pending'}</span></li>)}</ol></details>
    </section> : null}
    {result ? <div className="sample-message is-success" role="status"><IconCheck size={22} aria-hidden="true" /><div><strong>{result.inserted_records || result.administrator_memberships ? result.project_id ? 'Your sample workspace is ready' : 'Workspace roles are ready' : 'Your samples are already up to date'}</strong><p>{result.inserted_records} records added · {result.existing_records} existing records retained · {result.installed.length} module groups covered.{result.project_id ? ` ${result.administrator_memberships} administrator memberships added. Existing member roles retained.` : ''}{result.roles && result.installed.includes('workspace_roles') ? ` ${result.roles.created.length} roles created · ${result.roles.retained.length} existing roles retained.` : ""}</p>
      {result.installed.includes('testops') ? <p><a href={workspaceUrl('/testops')} target="_blank" rel="noopener noreferrer">Open TestOps activity</a>, select {catalog?.project_name || 'HelloTest Launchpad'}, and open “HelloTest feature blueprint · sample” to download the reusable JSON and Markdown.</p> : null}
      {result.installed.includes('knowledge') ? <p><a href={workspaceUrl('/knowledge-repo')} target="_blank" rel="noopener noreferrer">Open Knowledge Repository</a>, select {catalog?.project_name || 'HelloTest Launchpad'}, and find “{catalog?.blueprint?.title || 'HelloTest core feature and acceptance-story blueprint'}”.</p> : null}
    </div><span className="safe-chip">{result.project_id ? catalog?.project_name || 'HelloTest Launchpad' : 'People & access'}</span></div> : null}
    <div className="sample-workspace"><section className="sample-catalog" aria-busy={loading}>
      <div className="sample-presets" aria-label="Sample selection presets"><span>Start with</span><button disabled={!catalog || Boolean(busy)} type="button" onClick={() => selectPreset('all')}>Full product</button><button disabled={!catalog || Boolean(busy)} type="button" onClick={() => selectPreset('qa')}>QA essentials</button><button disabled={!catalog || Boolean(busy)} type="button" onClick={() => selectPreset('people')}>People &amp; access</button><button disabled={!catalog || Boolean(busy)} type="button" onClick={() => selectPreset('ai')}>AI & automation</button></div>
      <div className="sample-discovery"><label className="search"><IconSearch size={17} aria-hidden="true" /><input aria-label="Search sample modules and features" value={search} placeholder="Search modules or features" onChange={event => setSearch(event.target.value)} /></label><label className="sample-group-filter"><span className="sample-sr-only">Module group</span><select value={group} onChange={event => setGroup(event.target.value)}><option>All modules</option>{groups.map(value => <option key={value}>{value}</option>)}</select></label></div>
      <div className="sample-selection-line"><span>{filtered.length} module groups shown</span><div><button type="button" disabled={!filtered.length || Boolean(busy)} onClick={() => setSelected(current => [...new Set([...current, ...filtered.map(module => module.key)])])}>Select shown</button><button type="button" disabled={!selected.length || Boolean(busy)} onClick={() => setSelected([])}>Clear selection</button></div></div>
      {loading && !catalog ? <LoadingState label="Loading sample coverage" /> : null}
      {groups.map(category => { const items = filtered.filter(module => module.group === category); return items.length ? <section className="sample-category" key={category}><h4>{category}</h4><div className="sample-module-grid">{items.map(module => {
        const required = included.has(module.key) && !selected.includes(module.key);
        return <article className={`sample-choice${included.has(module.key) ? ' is-selected' : ''}${module.key === 'workspace_roles' ? ' sample-choice--roles' : ''}`} key={module.key}>
          <label className="sample-choice-label"><input type="checkbox" checked={included.has(module.key)} disabled={Boolean(busy) || required} onChange={event => { setSelected(current => event.target.checked ? [...current, module.key] : current.filter(key => key !== module.key)); setResult(null); }} /><span><strong>{module.label}</strong><small>{required ? 'Included dependency' : module.status === 'installed' ? 'Installed' : module.status === 'partial' ? 'More samples available' : 'Ready to install'}</small></span></label>
          <p>{module.description}</p><div className="sample-features">{module.features.map(feature => <span key={feature}>{feature}</span>)}</div>
          {module.key === 'planning' && catalog?.blueprint ? <p className="sample-blueprint-summary">{catalog.blueprint.story_count} HelloTest stories · {catalog.blueprint.backlog_count} in Backlog · {catalog.blueprint.sprint_count} sprints · {catalog.blueprint.release_count} releases.</p> : null}
          {module.key === 'workspace_roles' ? <details className="sample-role-details"><summary>Review role responsibilities and permissions</summary><SetupRoles roles={catalog?.roles || []} /></details> : null}
          {module.key === 'workspace' && catalog?.workspace ? <details className="sample-workspace-details"><summary>Project, applications and membership</summary><p>{catalog.workspace.description}</p><ul>{catalog.workspace.applications.map(app => <li key={app.id}><strong>{app.name}</strong> · {app.is_unified ? 'Unified mobile' : app.type === 'api' ? 'API' : app.type === 'web' ? 'Web' : app.type}</li>)}</ul><p>{catalog.workspace.membership}</p><p>{catalog.workspace.member_count} existing project members retained.</p></details> : null}
          <footer><span>{module.record_count}/{module.expected_record_count} {module.key === 'workspace_roles' ? 'role presets' : 'sample records'}</span><span>{module.available ? `${module.tables.length} data areas` : 'Feature disabled'}</span></footer>
        </article>;
      })}</div></section> : null; })}
      {!loading && catalog && !filtered.length ? <div className="surface empty-state"><IconSearch aria-hidden="true" /><h3>No matching modules</h3><p>Try a feature such as history, parameters or API.</p><button className="secondary-button" onClick={() => { setSearch(''); setGroup('All modules'); }} type="button">Clear filters</button></div> : null}
    </section>
    <aside className="surface sample-install-summary"><div className="sample-summary-icon"><IconLayersIntersect size={23} aria-hidden="true" /></div><p className="kicker">Installation preview</p><h3>{included.has('workspace') ? 'One connected workspace' : 'Workspace access roles'}</h3><p>{included.has('workspace') ? <>Samples live in <strong>{catalog?.project_name || 'HelloTest Launchpad'}</strong>. Repeat an install to fill missing records while retaining edits.</> : 'Install reusable role presets while retaining customized grants and assignments.'}</p><dl><div><dt>Module groups</dt><dd>{included.size}</dd></div><div><dt>Sample records</dt><dd>{totalRecords}</dd></div><div><dt>New records available</dt><dd>{missingRecords}</dd></div></dl>
      {dependencies.length ? <div className="sample-dependencies"><strong>Required modules included</strong><p>{dependencies.map(module => module.label).join(', ')}</p></div> : null}
      {modules.some(module => included.has(module.key) && !module.available) ? <p className="sample-availability">Some selected features are disabled. Their samples can be installed; feature settings stay as configured.</p> : null}
      <button className="primary-button" disabled={!selected.length || setupUnavailable || indexing || loading || !catalog || schema.status !== 'ready'} onClick={() => void install()} type="button">{busy === 'samples' ? <LoadingState label="Installing samples" /> : <IconArrowRight size={17} aria-hidden="true" />}{installLabel}</button>
      {schema.status !== 'ready' ? <p className="sample-availability">Validate the schema before installing samples.</p> : null}
      <p className="sample-fineprint">{catalog?.dataset ? `Repository dataset v${catalog.dataset.version} · ${catalog.dataset.file_count} object files. ` : ''}Synthetic examples with realistic relationships. Draft workflows and disabled schedules run only when you choose to configure and start them.</p>
      <details><summary>Connected service features</summary><p>AI responses, live telemetry, device sessions and external connection tests use your configured services. Sample integrations contain no credentials and remain inactive.</p></details>
    </aside></div>
    <div className="sample-mobile-install" aria-label="Install selection"><span>{included.size} modules · {running ? `${job?.completed_files || 0}/${job?.total_files || 0} files` : `${missingRecords} new records`}</span><button className="primary-button" disabled={!selected.length || setupUnavailable || indexing || loading || !catalog || schema.status !== 'ready'} onClick={() => void install()} type="button">{statusLoading ? 'Checking…' : busy === 'samples' ? 'Installing…' : 'Install samples'}</button></div>
  </div>;
}
