import { workflowFieldInputs } from "./shared/fieldInputs";
import {FieldMappingFields} from "./shared/FieldMappingFields";
import type { WorkflowOperationEditorProps } from "./operationEditorTypes";

export function LoopFields(props:WorkflowOperationEditorProps){
const {data,onChange}=props;

const patch:WorkflowOperationEditorProps['onChange']=change=>onChange({...change,...(change.loopAction==='transform'&&data.transformMapping==null?{transformMapping:'{\n  "item": "$item"\n}'}:{})});
const {field,select,number}=workflowFieldInputs(data,patch);
return (<><>
          {select(
            "loopAction",
            "Action for each item",
            [
              ["workflow", "Connected workflow steps"],
              ["transform", "Map fields"],
              ["customAI", "AI review"],
              ["storyPackets", "Native Story pipeline"],
            ],
            "transform",
          )}
          {field("loopSourceKey", "Items path", false, "input.items")}
          {number("loopMaxIterations", "Maximum items", 1, 100, 10)}
          {['customAI','transform'].includes(String(data.loopAction)) && <>
            {number("loopBatchSize", "Read-only batch size", 1, 100, 1)}
            <p className="studio-caption">Each batch is passed as an array when its size is above one. Reviews and field mappings share the workflow's 100-batch limit and remaining deadline.</p>
          </>}
          {data.loopAction === "workflow" && <>
            {number("loopBatchSize", "Batch size", 1, 100, 1)}
            {select("loopItemFailure", "When a batch fails", [["stop", "Stop workflow"], ["continue", "Record failure and continue"]], "stop")}
            {data.loopItemFailure === "continue" && <p className="studio-caption">Completed batches remain available in Output. Workflow cancellation, deadline, access, provider and uncertain-operation failures still stop execution.</p>}
            <p className="studio-caption">Connect <strong>loop</strong> to the first body step and return the last body step to <strong>continue</strong>. Connect <strong>done</strong> to the step that receives all completed batch results. Batches run in order; the body must return before the next batch starts.</p>
            <p className="studio-caption"><code>$input</code> is the current batch array. With batch size 1, <code>$item</code> is the item. Iteration metadata includes index, number, total and batch_size. The item limit rejects larger inputs instead of silently dropping items.</p>
            <p className="studio-caption">This node's timeout covers every batch and body step. The remaining workflow deadline also applies; adjust both in Execution settings and Workflow settings for longer jobs.</p>
          </>}
          {data.loopAction === "customAI" ? (
            <>
              <p className="studio-caption">
                The current item and its index are passed to your configured
                project model. Each result remains available in Output.
              </p>
            </>
          ) : null}
          {data.loopAction !== "workflow" && <p className="studio-caption">
            Items run sequentially inside this node. Native Story pipelines support up to 100 Stories; other actions support 10 items, within
            this node's timeout. The next node receives the collected results.
          </p>}
        </>{!["workflow","customAI","storyPackets"].includes(String(data.loopAction))?<FieldMappingFields data={data} onChange={onChange} itemScope/>:null}</>);
}
