import { useCurrentProject } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { useEffect, useRef, useState } from "react";
import { CopyIcon, AddIcon, TrashIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { IconArrowUp, IconArrowDown } from "@tabler/icons-react";
import { joinAutomationInstructions, readAutomationInstructions } from "../lib/automationInstructions";

const clipboards = new Map<string,string[]>();

/** Source mode edits physical lines; instruction mode keeps complete JavaScript statements together. */
export function AutomationCodeLines({value,onChange,mode="source"}: {value:string;onChange:(value:string)=>void;mode?:"source"|"instructions"}) {
  const [projectId] = useCurrentProject();
  const clipboardKey = `${projectId}:${mode}`;
  const [clipboard,setClipboard]=useState(() => ({key:clipboardKey,lines:clipboards.get(clipboardKey) || [] as string[]}));
  const copied=clipboard.key===clipboardKey ? clipboard.lines : clipboards.get(clipboardKey) || [];
  const copy = (lines: string[]) => { clipboards.set(clipboardKey,lines); setClipboard({key:clipboardKey,lines}); };
  const [selected,setSelected]=useState<number[]>([]);
  const [document,setDocument]=useState(()=>readAutomationInstructions(value,{unwrapEntry:true}));
  const lastEmitted = useRef(value);
  const lastMode = useRef(mode);
  useEffect(()=>{
    if(value!==lastEmitted.current || mode!==lastMode.current){lastEmitted.current=value;lastMode.current=mode;setDocument(readAutomationInstructions(value,{unwrapEntry:true}));setSelected([]);}
  },[value,mode]);
  const instructions = mode === "instructions";
  const lines=instructions ? document.instructions.map(item=>item.source) : value.split("\n");
  const noun=instructions ? "instruction" : "code line";
  const plural=instructions ? "instructions" : "lines";
  const emit=(next: typeof document.instructions,clear=true)=>{
    const nextDocument={...document,instructions:next};setDocument(nextDocument);
    const text=joinAutomationInstructions(nextDocument);lastEmitted.current=text;onChange(text);if(clear)setSelected([]);
  };
  const commit=(next:string[])=>{const text=next.join("\n");lastEmitted.current=text;onChange(text);setSelected([]);};
  const insert=(at:number,content:string[])=>{
    if(instructions){const next=[...document.instructions];next.splice(at,0,...content.map(source=>({before:"\n",source})));emit(next);}
    else {const next=[...lines];next.splice(at,0,...content);commit(next);}
  };
  const move=(index:number,delta:number)=>{
    if(instructions){const next=[...document.instructions];[next[index],next[index+delta]]=[next[index+delta],next[index]];emit(next);}
    else {const next=[...lines];[next[index],next[index+delta]]=[next[index+delta],next[index]];commit(next);}
  };
  const edit=(index:number,source:string)=>{
    if(instructions)emit(document.instructions.map((item,at)=>at===index?{...item,source}:item),false);
    else {const next=[...lines];next[index]=source;const text=next.join("\n");lastEmitted.current=text;onChange(text);}
  };
  const remove=(index:number)=>instructions?emit(document.instructions.filter((_,at)=>at!==index)):commit(lines.filter((_,at)=>at!==index));
  return <section className={`automation-code-lines${instructions?" automation-instruction-editor":""}`} aria-label={instructions?"Instruction editor":"Code line editor"}>
    <div className="automation-plan-actions">
      <button className="ghost-button compact" type="button" disabled={!selected.length} onClick={()=>copy([...selected].sort((a,b)=>a-b).filter(index=>index<lines.length).map(index=>lines[index]))}><CopyIcon size={14}/>Copy selected {plural}</button>
      <button className="ghost-button compact" type="button" disabled={!copied.length} onClick={()=>insert(selected.length?Math.max(...selected)+1:lines.length,copied)}>Paste {plural}</button>
      <button className="ghost-button compact" type="button" onClick={()=>insert(selected.length?Math.max(...selected)+1:lines.length,[""])}><AddIcon size={14}/>Insert {instructions?"instruction":"line"}</button>
    </div>
    {instructions && !document.valid ? <p className="muted automation-instruction-draft-note">This draft contains incomplete JavaScript. It stays together so multiline syntax is preserved. Complete the source or use Automation code to edit the full program.</p> : null}
    {instructions && document.framed ? <p className="muted automation-instruction-draft-note">Editing the entry's instructions. Imports, hooks and the surrounding wrapper are preserved.</p> : null}
    {lines.map((line,index)=><div className="automation-code-line" key={index}>
      <input aria-label={`Select ${noun} ${index+1}`} type="checkbox" checked={selected.includes(index)} onChange={event=>setSelected(current=>event.target.checked?[...current,index]:current.filter(item=>item!==index))}/>
      <span className="automation-code-line-number">{index+1}</span><textarea aria-label={`${instructions?"Instruction":"Code line"} ${index+1}`} spellCheck={false} rows={Math.min(12,Math.max(1,line.split("\n").length))} value={line} onChange={event=>edit(index,event.target.value)}/>
      <div className="automation-code-line-actions">
        <button type="button" aria-label={`Copy ${noun} ${index+1}`} onClick={()=>copy([line])}><CopyIcon size={14}/></button>
        <button type="button" aria-label={`Paste after ${noun} ${index+1}`} disabled={!copied.length} onClick={()=>insert(index+1,copied)}><AddIcon size={14}/></button>
        <button type="button" aria-label={`Move ${noun} ${index+1} up`} disabled={!index} onClick={()=>move(index,-1)}><IconArrowUp size={14}/></button>
        <button type="button" aria-label={`Move ${noun} ${index+1} down`} disabled={index===lines.length-1} onClick={()=>move(index,1)}><IconArrowDown size={14}/></button>
        <button type="button" aria-label={`Remove ${noun} ${index+1}`} onClick={()=>remove(index)}><TrashIcon size={14}/></button>
      </div>
    </div>)}
    <small>{instructions?"Each row keeps a complete instruction or JavaScript block together. Save to apply changes.":"Line operations edit source literally. Save automation to apply the changes."}</small>
  </section>;
}
