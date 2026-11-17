import { Input } from "@hellotest/platform/frontend/src/shared/components/Input";
import { useRef, useState } from 'react';
import { API_SOURCE_LIMITS, parseApiSourceIntake, type ApiAutomationSourceResult, type ApiSourceFormat } from '../../shared/apiSourceIntake.mjs';
import './ApiAutomationSourceIntake.css';

export type { ApiAutomationSourceResult };

/** Source parsing is local and deterministic; applying a draft never sends a target request. */
export function ApiAutomationSourceIntake({disabled = false,hasSteps = false,onApply}: {
  disabled?: boolean;
  hasSteps?: boolean;
  onApply: (result: ApiAutomationSourceResult, mode: 'append' | 'replace') => void | boolean;
}) {
  const [source,setSource]=useState('');
  const [format,setFormat]=useState<ApiSourceFormat>('auto');
  const [result,setResult]=useState<ApiAutomationSourceResult|null>(null);
  const [error,setError]=useState('');
  const [fileName,setFileName]=useState('');
  const [mode,setMode]=useState<'append'|'replace'>('append');
  const [reading,setReading]=useState(false);
  const revision=useRef(0);
  const changeSource=(value:string)=>{revision.current++;setSource(value);setResult(null);setError('');setFileName('');};
  return <section className="api-source-intake" aria-label="API source intake">
    <div className="api-source-intake-heading"><strong>Start from API requests</strong><p>One API case, one step per request. Import a contract or captured journey, then review the request order and assertions before building or running.</p></div>
    <div className="api-source-intake-controls">
      <label className="form-field"><span>Source format</span><select aria-label="API source format" disabled={disabled||reading} value={format} onChange={event=>{revision.current++;setFormat(event.target.value as ApiSourceFormat);setResult(null);setError('');}}>
        <option value="auto">Auto detect</option><option value="openapi">OpenAPI / Swagger JSON or YAML</option><option value="postman">Postman collection</option><option value="curl">cURL requests</option><option value="har">HAR capture</option>
      </select></label>
      <label className="form-field"><span>Source file</span><Input aria-label="API source file" disabled={disabled||reading} type="file" accept=".json,.yaml,.yml,.har,.txt,.curl,.sh" onChange={async event=>{
        const file=event.target.files?.[0];if(!file)return;
        const current=++revision.current;setResult(null);setSource('');setFileName('');setError('');setReading(true);
        try{if(file.size>API_SOURCE_LIMITS.maxBytes)throw new Error('API sources are limited to 2 MB. Split this source into smaller cases.');const value=await file.text();if(current===revision.current){setSource(value);setFileName(file.name);}}
        catch(failure){if(current===revision.current)setError(failure instanceof Error?failure.message:'The API source could not be read.');}
        finally{if(current===revision.current)setReading(false);event.target.value='';}
      }}/></label>
    </div>
    <label className="form-field"><span>API source{fileName?` · ${fileName}`:''}</span><textarea aria-label="API source" spellCheck={false} disabled={disabled||reading} rows={7} value={source} placeholder={'curl https://api.example.com/items\ncurl -X POST https://api.example.com/items -H "Content-Type: application/json" --data-raw \'{"name":"Example"}\''} onChange={event=>changeSource(event.target.value)}/></label>
    <small>Up to 200 requests and 2 MB. This prepares steps locally. Files and commands are never executed. Credentials are replaced with private parameter references.</small>
    <div className="api-source-intake-actions"><button className="ghost-button" type="button" disabled={disabled||reading||!source.trim()} onClick={()=>{
      try{setResult(parseApiSourceIntake(source,{format}));setError('');}catch(failure){setResult(null);setError(failure instanceof Error?failure.message:'This API source could not be parsed.');}
    }}>{reading?'Reading source…':'Review requests'}</button>{source?<button className="ghost-button" type="button" disabled={disabled||reading} onClick={()=>changeSource('')}>Clear source</button>:null}</div>
    {error?<p role="alert" className="api-source-intake-error">{error}</p>:null}
    {result?<div className="api-source-intake-review" aria-label="Imported API request preview">
      <strong>{result.steps.length} request{result.steps.length===1?'':'s'} prepared · {result.title}</strong>
      <ol>{result.steps.map(step=><li key={step.step_order}><span className="api-source-method">{step.api_request.method}</span><span>{step.action}</span><code className="api-source-url">{step.api_request.url}</code><small>{step.api_request.validations.length?`${step.api_request.validations.length} response assertion${step.api_request.validations.length===1?'':'s'} retained`:'No response assertion supplied'}{step.api_request.captures.length?` · ${step.api_request.captures.length} response capture${step.api_request.captures.length===1?'':'s'}`:''}</small></li>)}</ol>
      {result.warnings.length?<ul className="api-source-warnings" aria-label="API source review notes">{result.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul>:null}
      {result.private_parameter_names.length?<p>Private inputs to set before running: {result.private_parameter_names.map(name=><code key={name}>@{name} </code>)}</p>:null}
      {hasSteps?<label className="form-field"><span>Apply to current draft</span><select aria-label="Apply API requests" value={mode} disabled={disabled} onChange={event=>setMode(event.target.value as 'append'|'replace')}><option value="append">Add after the current steps</option><option value="replace">Replace the current draft steps</option></select></label>:null}
      <button className="primary-button" type="button" disabled={disabled} onClick={()=>{if(onApply(result,hasSteps?mode:'replace')===false)return;setResult(null);setSource('');setFileName('');}}>{hasSteps&&mode==='append'?'Add':'Use'} {result.steps.length} API request step{result.steps.length===1?'':'s'}</button>
    </div>:null}
  </section>;
}
