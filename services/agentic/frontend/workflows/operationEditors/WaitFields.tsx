import type { WorkflowOperationEditorProps } from "./operationEditorTypes";

export function WaitFields(props:WorkflowOperationEditorProps){
const {data,onChange}=props;

const number=(key:string,label:string,min:number,max:number,fallback:number)=><label><span>{label}</span><input type="number" aria-label={label} min={min} max={max} step={1} value={String(data[key]??fallback)} onChange={event=>onChange({[key]:event.target.value===''?'':Number(event.target.value),...(Number(event.target.value)>=Number(data.timeoutMs||30000)?{timeoutMs:String(Number(event.target.value)+1000)}:{})})}/></label>;
return (<>{number("waitMs", "Wait duration (ms)", 0, 60000, 1000)}<p className="studio-caption">Pauses this branch for up to 60 seconds. Other independent branches can continue in parallel. The timeout increases when needed to include the wait.</p></>);
}
