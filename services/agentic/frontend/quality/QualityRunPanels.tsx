import { useEffect, useState } from 'react';
import { IconCheck, IconX, IconArrowRight, IconCircleCheck, IconAdjustmentsHorizontal } from '@tabler/icons-react';
import { ContextSelect } from '@hellotest/platform/frontend/src/shared/components/ContextSelect';
import { AgentStructuredValue } from '../components/AgentStructuredValue';
import { agentOutputText } from '../lib/agentOutputValue';
import type { QualityAgentRun, QualityAgentFinding } from '../lib/qualityAgentContracts';
import { qualityMetricLabel, qualityMetricValue } from '../lib/qualityAgentExperience';
const running = (run?: QualityAgentRun) => Boolean(run && ['queued','running'].includes(run.status));

export function QualityTimeline({ run }: { run: QualityAgentRun }) {
  const completed = run.stages.filter(stage => stage.status === 'completed').length;
  return <aside className="quality-timeline" aria-label="Observed execution stages">
    <header><span className="quality-kicker">Execution trace</span><strong>{completed}<span> / {run.stages.length} stages</span></strong></header>
    {run.stages.length ? <ol>{run.stages.map((stage, index) => <li className={`is-${stage.status}`} key={stage.id}><span className="quality-stage-marker">{stage.status === 'completed' ? <IconCheck size={13} /> : stage.status === 'failed' ? <IconX size={13} /> : String(index + 1).padStart(2, '0')}</span><div><strong>{stage.label}</strong><small>{stage.status === 'running' ? 'In progress' : stage.status === 'pending' ? 'Waiting' : stage.status === 'failed' ? run.status === 'cancelled' ? 'Stopped' : 'Failed' : 'Recorded'}</small></div></li>)}</ol> : <p className="quality-muted">Waiting for the engine to report its first stage.</p>}
    <div className="quality-trace-receipt"><span>Isolated browser</span><span>{run.options.viewport?.width || 1280} × {run.options.viewport?.height || 720}</span><code title={run.id}>{run.id.slice(0, 16)}</code></div>
  </aside>;
}

export function QualityFindings({ run, canDraft, onDraft }: { run: QualityAgentRun; canDraft: boolean; onDraft: (finding: QualityAgentFinding) => void }) {
  const [severity, setSeverity] = useState('all'); const [selectedId, setSelectedId] = useState('');
  const filtered = run.findings.filter(finding => severity === 'all' || finding.severity === severity);
  const selected = filtered.find(finding => finding.id === selectedId) || filtered[0];
  useEffect(() => { setSeverity('all'); setSelectedId(''); }, [run.id]);
  return <section className="quality-findings" aria-label="Observed findings">
    <div className="quality-section-heading"><div><span className="quality-kicker">From the browser</span><h3>Findings <span>{run.findings.length}</span></h3></div><label className="quality-filter"><span className="sr-only">Finding severity</span><ContextSelect label="Finding severity" aria-label="Finding severity" value={severity} onChange={event => { setSeverity(event.target.value); setSelectedId(''); }}><option value="all">All severity</option>{['critical', 'high', 'medium', 'low', 'info'].map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</ContextSelect></label></div>
    {selected ? <div className="quality-finding-layout"><div className="quality-finding-list" role="group" aria-label="Choose finding">{filtered.map(finding => <button type="button" aria-pressed={selected.id === finding.id} key={finding.id} onClick={() => setSelectedId(finding.id)}><span className={`quality-severity is-${finding.severity}`}>{finding.severity}</span><strong>{finding.title}</strong><small>{finding.category}</small><IconArrowRight size={16} /></button>)}</div><article className="quality-finding-detail"><span className={`quality-severity is-${selected.severity}`}>{selected.severity} · {selected.category}</span><h4>{agentOutputText(selected.title)}</h4><AgentStructuredValue value={selected.description} /><div className="quality-evidence-block"><span className="quality-kicker">Observed evidence</span><AgentStructuredValue value={selected.evidence} />{selected.selector && <code>{selected.selector}</code>}</div>{selected.recommendation && <div className="quality-recommendation"><span className="quality-kicker">Suggested next step</span><AgentStructuredValue value={selected.recommendation} /></div>}{canDraft && <button className="quality-primary-button" type="button" onClick={() => onDraft(selected)}>Draft defect<IconArrowRight size={17} /></button>}</article></div> : <div className="quality-output-empty"><IconCircleCheck size={28} /><h3>{severity !== 'all' ? 'No findings at this severity' : running(run) ? 'Observations are arriving' : run.status === 'completed' ? 'No findings reported' : 'No findings recorded'}</h3><p>{severity !== 'all' ? 'Choose another severity to inspect the recorded findings.' : run.status === 'completed' ? 'These bounded checks reported no findings. Review their scope before drawing a wider conclusion.' : 'Recorded findings will appear here when the browser reports them.'}</p></div>}
  </section>;
}

export function QualityMetrics({ run }: { run: QualityAgentRun }) {
  const entries = Object.entries(run.metrics); const [chosen, setChosen] = useState<string[] | null>(null);
  useEffect(() => setChosen(null), [run.id]);
  const keys = chosen ?? entries.slice(0, 4).map(([key]) => key);
  if (!entries.length) return null;
  return <section className="quality-metrics" aria-label="Measured metrics"><div className="quality-section-heading"><span className="quality-kicker">Measured, not estimated</span><details className="quality-metric-picker"><summary><IconAdjustmentsHorizontal size={15} />Choose metrics</summary><div>{entries.map(([key]) => <label key={key}><input type="checkbox" checked={keys.includes(key)} onChange={event => setChosen(event.target.checked ? [...keys, key] : keys.filter(value => value !== key))} />{qualityMetricLabel(key)}</label>)}</div></details></div><div className="quality-metric-grid">{keys.map(key => <div key={key}><span>{qualityMetricLabel(key)}</span><strong>{qualityMetricValue(key, run.metrics[key])}</strong></div>)}</div></section>;
}
