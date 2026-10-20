import { useEffect, useRef, useState } from 'react';
import { FormField } from '@hellotest/platform/frontend/src/shared/components/FormField';
import type { AiDesignImageInput } from '@hellotest/platform/frontend/src/types';
import { mergeAiReferenceImagesWithinBudget, readImageFiles } from '../lib/aiDesignStudio';
import './AiPromptContextPanel.css';

/** Shared bounded screenshot input. Originals never enter the model payload. */
export function AiReferenceImages({ images, onChange, disabled=false, onBusyChange }: { images:AiDesignImageInput[]; onChange:(images:AiDesignImageInput[])=>void; disabled?:boolean; onBusyChange?:(busy:boolean)=>void }) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const add=async(files:FileList|null)=>{
    if(!files?.length)return;
    setBusy(true);onBusyChange?.(true);setError('');
    try { const prepared=await readImageFiles(files);if(!mounted.current)return;const result=mergeAiReferenceImagesWithinBudget(images,prepared);if(result.message)setError(result.message);else onChange(result.images); }
    catch(reason){setError(reason instanceof Error?reason.message:'Unable to prepare reference images.');}
    finally{if(mounted.current){setBusy(false);onBusyChange?.(false);}}
  };
  return <div className="ai-reference-photos-field"><FormField label="Reference images" hint="Screenshots are compressed and sent to the selected vision-capable model. Crop to relevant content; higher detail can use more tokens." hintVisible><input accept="image/png,image/jpeg,image/webp" disabled={disabled||busy} multiple type="file" onChange={event=>{void add(event.target.files);event.target.value='';}}/></FormField>{busy?<p role="status">Preparing screenshots…</p>:null}{error?<p role="alert">{error}</p>:null}{images.length?<div className="ai-reference-image-list">{images.map(image=><article className="ai-reference-image-card" key={image.url}><div className="ai-reference-image-preview"><img alt={image.name||'Reference screenshot'} src={image.url}/></div><strong>{image.name}</strong><button className="ghost-button danger compact" disabled={disabled||busy} type="button" onClick={()=>onChange(images.filter(item=>item.url!==image.url))}>Remove</button></article>)}</div>:null}</div>;
}
