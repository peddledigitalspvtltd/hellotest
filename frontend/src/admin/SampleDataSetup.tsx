import { useEffect, useMemo, useRef, useState } from 'react';
import { IconArrowRight, IconCheck, IconDatabase, IconRefresh, IconSearch, IconAlertCircle, IconLayersIntersect } from '@tabler/icons-react';
import { adminApi, type Overview, type SampleCatalog, type SampleInstallResult } from './api';
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
  const [busy, setBusy] = useState<'schema' | 'samples' | null>(null);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<SampleInstallResult | null>(null);
  const initialized = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
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
  const selectPreset = (preset: 'all' | 'qa' | 'ai') => {
    setSelected(preset === 'all' ? modules.map(module => module.key) : preset === 'qa' ? ['dashboards', 'testops'] : ['agents']);
    setResult(null);
  };
  const applySchema = async () => {
    setBusy('schema'); setError('');
    try { await adminApi.applySchema(); if (!mounted.current) return; notify('Schema validation completed.'); refresh(); setReload(value => value + 1); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Schema setup failed.'); }
    finally { if (mounted.current) setBusy(null); }
  };
  const install = async () => {
    if (busy || !selected.length || loading) return;
    setBusy('samples'); setError(''); setResult(null);
    try {
      const value = await adminApi.seedSamples(selected);
      if (!mounted.current) return;
      setResult(value); notify(`${value.inserted_records} sample records added across ${value.installed.length} modules.`);
      refresh(); setReload(current => current + 1);
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Installation failed. Your selection is retained.'); }
    finally { if (mounted.current) setBusy(null); }
  };
  return <div className="sample-setup">
    <section className="surface sample-schema"><div className="sample-schema-icon"><IconDatabase size={23} aria-hidden="true" /></div><div><p className="kicker">Foundation</p><h3>Shared database schema</h3><p>{schema.missing_tables.length ? `${schema.missing_tables.length} required tables need attention.` : 'Database, permissions and audit tables are ready.'}</p></div><span className="safe-chip">{schema.available_tables}/{schema.required_tables} tables</span><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void applySchema()} type="button"><IconRefresh size={16} className={busy === 'schema' ? 'spin' : ''} aria-hidden="true" />{busy === 'schema' ? 'Validating…' : 'Validate schema'}</button></section>
    <section className="surface sample-intro"><div><p className="kicker">Explore the product</p><h3>Module sample data</h3><p>Bring Commerce Launchpad to life with connected stories, tests, evidence and insights across Web, API and Mobile.</p></div><div className="sample-stats" aria-label="Sample coverage"><div><strong>{modules.length || '—'}</strong><span>module groups</span></div><div><strong>{modules.reduce((sum, module) => sum + module.features.length, 0) || '—'}</strong><span>feature examples</span></div><div><strong>{installed}/{modules.length}</strong><span>fully installed</span></div></div></section>
    {error ? <div className="sample-message is-error" role="alert"><IconAlertCircle size={20} aria-hidden="true" /><div><strong>{catalog ? 'The request could not be completed' : 'Sample catalog is unavailable'}</strong><p>{error}</p></div><button className="secondary-button" disabled={Boolean(busy)} onClick={() => setReload(value => value + 1)} type="button">Reload catalog</button></div> : null}
    {result ? <div className="sample-message is-success" role="status"><IconCheck size={22} aria-hidden="true" /><div><strong>{result.inserted_records ? 'Your sample workspace is ready' : 'Your samples are already up to date'}</strong><p>{result.inserted_records} records added · {result.existing_records} existing records retained · {result.installed.length} module groups covered.</p></div><span className="safe-chip">{catalog?.project_name || 'HelloTest Launchpad'}</span></div> : null}
    <div className="sample-workspace"><section className="sample-catalog" aria-busy={loading}>
      <div className="sample-presets" aria-label="Sample selection presets"><span>Start with</span><button disabled={!catalog || Boolean(busy)} type="button" onClick={() => selectPreset('all')}>Full product</button><button disabled={!catalog || Boolean(busy)} type="button" onClick={() => selectPreset('qa')}>QA essentials</button><button disabled={!catalog || Boolean(busy)} type="button" onClick={() => selectPreset('ai')}>AI & automation</button></div>
      <div className="sample-discovery"><label className="search"><IconSearch size={17} aria-hidden="true" /><input aria-label="Search sample modules and features" value={search} placeholder="Search modules or features" onChange={event => setSearch(event.target.value)} /></label><label className="sample-group-filter"><span className="sample-sr-only">Module group</span><select value={group} onChange={event => setGroup(event.target.value)}><option>All modules</option>{groups.map(value => <option key={value}>{value}</option>)}</select></label></div>
      <div className="sample-selection-line"><span>{filtered.length} module groups shown</span><div><button type="button" disabled={!filtered.length || Boolean(busy)} onClick={() => setSelected(current => [...new Set([...current, ...filtered.map(module => module.key)])])}>Select shown</button><button type="button" disabled={!selected.length || Boolean(busy)} onClick={() => setSelected([])}>Clear selection</button></div></div>
      {loading && !catalog ? <div className="surface loading" role="status"><IconRefresh className="spin" aria-hidden="true" /><span>Loading sample coverage…</span></div> : null}
      {groups.map(category => { const items = filtered.filter(module => module.group === category); return items.length ? <section className="sample-category" key={category}><h4>{category}</h4><div className="sample-module-grid">{items.map(module => {
        const required = included.has(module.key) && !selected.includes(module.key);
        return <article className={`sample-choice${included.has(module.key) ? ' is-selected' : ''}`} key={module.key}>
          <label className="sample-choice-label"><input type="checkbox" checked={included.has(module.key)} disabled={Boolean(busy) || required} onChange={event => { setSelected(current => event.target.checked ? [...current, module.key] : current.filter(key => key !== module.key)); setResult(null); }} /><span><strong>{module.label}</strong><small>{required ? 'Included dependency' : module.status === 'installed' ? 'Installed' : module.status === 'partial' ? 'More samples available' : 'Ready to install'}</small></span></label>
          <p>{module.description}</p><div className="sample-features">{module.features.map(feature => <span key={feature}>{feature}</span>)}</div>
          <footer><span>{module.record_count}/{module.expected_record_count} sample records</span><span>{module.available ? `${module.tables.length} data areas` : 'Feature disabled'}</span></footer>
        </article>;
      })}</div></section> : null; })}
      {!loading && catalog && !filtered.length ? <div className="surface empty-state"><IconSearch aria-hidden="true" /><h3>No matching modules</h3><p>Try a feature such as history, parameters or API.</p><button className="secondary-button" onClick={() => { setSearch(''); setGroup('All modules'); }} type="button">Clear filters</button></div> : null}
    </section>
    <aside className="surface sample-install-summary"><div className="sample-summary-icon"><IconLayersIntersect size={23} aria-hidden="true" /></div><p className="kicker">Installation preview</p><h3>One connected workspace</h3><p>Samples live in <strong>{catalog?.project_name || 'HelloTest Launchpad'}</strong>. Repeat an install to fill missing records while retaining edits.</p><dl><div><dt>Module groups</dt><dd>{included.size}</dd></div><div><dt>Sample records</dt><dd>{totalRecords}</dd></div><div><dt>New records available</dt><dd>{missingRecords}</dd></div></dl>
      {dependencies.length ? <div className="sample-dependencies"><strong>Required modules included</strong><p>{dependencies.map(module => module.label).join(', ')}</p></div> : null}
      {modules.some(module => included.has(module.key) && !module.available) ? <p className="sample-availability">Some selected features are disabled. Their samples can be installed; feature settings stay as configured.</p> : null}
      <button className="primary-button" disabled={!selected.length || Boolean(busy) || loading || !catalog || schema.status !== 'ready'} onClick={() => void install()} type="button">{busy === 'samples' ? <IconRefresh className="spin" size={17} aria-hidden="true" /> : <IconArrowRight size={17} aria-hidden="true" />}{busy === 'samples' ? 'Installing samples…' : 'Install selected samples'}</button>
      {schema.status !== 'ready' ? <p className="sample-availability">Validate the schema before installing samples.</p> : null}
      <p className="sample-fineprint">Synthetic examples with realistic relationships. Draft workflows and disabled schedules run only when you choose to configure and start them.</p>
      <details><summary>Connected service features</summary><p>AI responses, live telemetry, device sessions and external connection tests use your configured services. Sample integrations contain no credentials and remain inactive.</p></details>
    </aside></div>
    <div className="sample-mobile-install" aria-label="Install selection"><span>{included.size} modules · {missingRecords} new records</span><button className="primary-button" disabled={!selected.length || Boolean(busy) || loading || !catalog || schema.status !== 'ready'} onClick={() => void install()} type="button">{busy === 'samples' ? 'Installing…' : 'Install samples'}</button></div>
  </div>;
}
