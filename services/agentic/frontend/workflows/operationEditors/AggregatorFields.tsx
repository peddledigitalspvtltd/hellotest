import { workflowFieldInputs } from "./shared/fieldInputs";
import type { WorkflowOperationEditorProps } from "./operationEditorTypes";

export function AggregatorFields(props:WorkflowOperationEditorProps){
const {data,onChange}=props;

const patch:WorkflowOperationEditorProps['onChange']=change=>onChange({...change,...(change.mergeMode==='combineMatching'&&data.mergeMatchFields==null?{mergeMatchFields:'[{"left":"id","right":"id"}]'}:{})});
const {field,select,checkbox}=workflowFieldInputs(data,patch);
return (<>
        {select("mergeMode", "Merge inputs", [["waitAllAppend", "Append items"], ["combinePosition", "Combine by position"], ["combineMatching", "Combine by matching fields"], ["combineAll", "All combinations"], ["chooseInput", "Choose one input"], ["waitAllMerge", "Combine branch objects (legacy)"]], "waitAllAppend")}
        {data.mergeMode === "combineMatching" && <>
          {field("mergeMatchFields", "Matching fields JSON", true, '[{"left":"id","right":"id"}]')}
          {select("mergeJoin", "Include matches", [["inner", "Matching items"], ["left", "All input 1 items"], ["right", "All input 2 items"], ["outer", "All items"], ["nonMatches", "Only unmatched items"]], "inner")}
          {select("mergeMultiple", "Multiple matches", [["all", "Keep all matches"], ["first", "Use the first match"]], "all")}
        </>}
        {data.mergeMode === "combinePosition" && checkbox("mergeIncludeUnpaired", "Include unpaired items")}
        {["combinePosition", "combineMatching", "combineAll"].includes(String(data.mergeMode)) && <>
          {select("mergeClash", "When fields have the same name", [["preferLast", "Prefer input 2"], ["preferFirst", "Prefer input 1"], ["keepBoth", "Keep both values"]], "preferLast")}
          {checkbox("mergeDeep", "Merge nested objects", true)}
        </>}
        {data.mergeMode === "chooseInput" && select("mergeChooseInput", "Return input", [["1", "Input 1"], ["2", "Input 2"]], "1")}
        <p className="studio-caption">Waits until connected branches finish or are skipped. Append preserves connection order. Combine and choose operations use two inputs; connect them to the numbered ports. Skipped branches contribute no items.</p>
        {data.mergeMode === "combineAll" && <p className="studio-notice">Pairs every item from input 1 with every item from input 2. Output grows with both inputs and must stay within the execution item limit.</p>}
      </>);
}
