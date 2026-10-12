import { useEffect, useRef } from 'react';
import { IconChevronDown, IconStack2 } from '@tabler/icons-react';
const options = [['stories','Stories'],['test-cases','Test Cases'],['automation','Automation'],['runs','Runs'],['bugs','Defects'],['knowledge','Knowledge Repo']];
export function AgentContextSources({values,onChange,disabled}:{values:string[];onChange:(values:string[])=>void;disabled?:boolean}) {
 const ref=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{const close=(event:PointerEvent)=>{if(!ref.current?.contains(event.target as Node))ref.current?.removeAttribute('open');};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[]);
 return <details ref={ref} className="agent-command-context" onKeyDown={event=>{if(event.key==='Escape'){ref.current?.removeAttribute('open');ref.current?.querySelector('summary')?.focus();}}}><summary><IconStack2 size={15}/><span>Context sources ({values.length})</span><IconChevronDown size={13}/></summary><div className="agent-command-context__menu"><p>Select the sources the agent can use. Current permissions still apply.</p>{options.map(([key,label])=><label key={key}><input type="checkbox" disabled={disabled} checked={values.includes(key)} onChange={event=>onChange(event.target.checked?[...values,key]:values.filter(value=>value!==key))}/><span>{label}</span></label>)}</div></details>;
}
