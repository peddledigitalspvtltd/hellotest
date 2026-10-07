import { useEffect, useState } from 'react';
import { IconArrowsHorizontal, IconDownload, IconPhoto, IconRefresh } from '@tabler/icons-react';
import { agenticApi } from '../api.client';
import type { QualityAgentArtifact, QualityAgentBaseline, QualityAgentRun } from '../lib/qualityAgentContracts';

export function QualityArtifactImage({ runId, artifact, baseline, alt, className = '' }: { runId?: string; artifact?: QualityAgentArtifact; baseline?: QualityAgentBaseline; alt: string; className?: string }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = '';
    setUrl(''); setError('');
    const load = baseline ? agenticApi.qualityAgents.baselineImage(baseline.id, { signal: controller.signal }) : runId && artifact ? agenticApi.qualityAgents.artifact(runId, artifact.id, { signal: controller.signal }) : null;
    if (!load) return;
    void load.then(blob => {
      if (controller.signal.aborted) return;
      if (!/^image\/(?:png|jpeg|webp)$/.test(blob.type)) throw new Error('This artifact is not a supported screenshot. Download it to inspect its original format.');
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Screenshot could not be loaded.'); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [runId, artifact?.id, baseline?.id, retry]);
  return <div className={`quality-image ${className}`}>
    {url ? <img src={url} alt={alt} /> : error ? <div className="quality-image-message" role="alert"><IconPhoto size={24} /><p>{error}</p><button type="button" className="quality-text-button" onClick={() => setRetry(value => value + 1)}><IconRefresh size={14} />Retry image</button></div> : <div className="quality-image-message" role="status"><span className="quality-pulse" />Loading recorded screenshot…</div>}
  </div>;
}

export function QualityArtifacts({ run, baselines, onApprove, canApprove }: { run: QualityAgentRun; baselines: QualityAgentBaseline[]; onApprove: (artifact: QualityAgentArtifact) => void; canApprove: boolean }) {
  const images = run.artifacts.filter(artifact => artifact.type === 'screenshot' || artifact.type === 'visual_diff');
  const [selectedId, setSelectedId] = useState('');
  const [compare, setCompare] = useState(false);
  const [position, setPosition] = useState(50);
  const [notice, setNotice] = useState('');
  const selected = images.find(artifact => artifact.id === selectedId) || images[0];
  const baseline = baselines.find(item => item.id === run.baseline_id);
  useEffect(() => { setSelectedId(''); setCompare(false); setNotice(''); }, [run.id]);
  const download = async (artifact: QualityAgentArtifact) => {
    try {
      const blob = await agenticApi.qualityAgents.artifact(run.id, artifact.id);
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = artifact.name.split(/[\\/]/).pop() || 'quality-artifact';
      document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Artifact downloaded.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Artifact download failed.'); }
  };
  return <section className="quality-artifacts" aria-label="Recorded visual evidence">
    <div className="quality-section-heading"><div><span className="quality-kicker">Observed pixels</span><h3>Visual evidence</h3></div>{selected && <div className="quality-inline-actions">{baseline && selected.type === 'screenshot' && <button type="button" className="quality-text-button" aria-pressed={compare} onClick={() => setCompare(value => !value)}><IconArrowsHorizontal size={16} />{compare ? 'Single image' : 'Compare baseline'}</button>}<button type="button" className="quality-text-button" onClick={() => void download(selected)}><IconDownload size={16} />Download</button></div>}</div>
    {images.length ? <>
      <div className="quality-artifact-tabs" role="group" aria-label="Choose screenshot">{images.map(artifact => <button type="button" key={artifact.id} aria-pressed={selected?.id === artifact.id} onClick={() => { setSelectedId(artifact.id); setCompare(false); }}><IconPhoto size={15} />{artifact.type === 'visual_diff' ? 'Pixel difference' : artifact.name}<small>{Math.round(artifact.bytes / 1024)} KB</small></button>)}</div>
      {selected && <figure className="quality-screen-frame">
        <div className="quality-screen-bar"><span /><span /><span /><small>{run.target_url}</small></div>
        {compare && baseline ? <div className="quality-image-comparison"><QualityArtifactImage runId={run.id} artifact={selected} alt="Current recorded screenshot" /><div className="quality-baseline-layer" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}><QualityArtifactImage baseline={baseline} alt="Approved baseline screenshot" /></div><div className="quality-compare-divider" style={{ left: `${position}%` }} /><span className="quality-compare-label is-before">Approved baseline</span><span className="quality-compare-label is-after">Current</span><input type="range" min={0} max={100} value={position} onChange={event => setPosition(Number(event.target.value))} aria-label="Compare screenshots" /></div> : <QualityArtifactImage runId={run.id} artifact={selected} alt={selected.type === 'visual_diff' ? 'Recorded pixel difference from the approved baseline' : 'Screenshot captured during this agent run'} />}
        <figcaption><code>{selected.sha256.slice(0, 12)}</code><span>{run.options.viewport?.width || 'Recorded'} × {run.options.viewport?.height || 'viewport'}</span>{canApprove && run.kind === 'visual' && run.status === 'completed' && selected.type === 'screenshot' && <button type="button" className="quality-text-button" onClick={() => onApprove(selected)}>Review as baseline →</button>}</figcaption>
      </figure>}
    </> : <div className="quality-output-empty"><IconPhoto size={25} /><h3>{['running', 'queued'].includes(run.status) ? 'Screenshots appear as they are recorded' : 'No screenshot was recorded'}</h3><p>Only artifacts returned by the browser engine appear here.</p></div>}
    {run.artifacts.filter(item => item.type === 'report').map(artifact => <button className="quality-report-download" type="button" key={artifact.id} onClick={() => void download(artifact)}><IconDownload size={17} /><span><strong>{artifact.name}</strong><small>Recorded engine report · {Math.round(artifact.bytes / 1024)} KB</small></span></button>)}
    {notice && <p className="quality-inline-notice" role="status">{notice}</p>}
  </section>;
}
