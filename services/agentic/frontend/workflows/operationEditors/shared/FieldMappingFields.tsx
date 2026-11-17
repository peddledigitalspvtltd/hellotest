import type { WorkflowOperationEditorProps } from "../operationEditorTypes";
import {workflowFieldInputs} from './fieldInputs';
export function FieldMappingFields({data,onChange,itemScope=false}:Pick<WorkflowOperationEditorProps,'data'|'onChange'>&{itemScope?:boolean}){const {field}=workflowFieldInputs(data,onChange);return(<>
          {field("transformMapping", "Field mapping JSON", true)}
          <p className="studio-caption">
            Map values with <code>"$input.title"</code>,{" "}
            <code>"$request.id"</code>
            {itemScope ? (
              <>
                {" "}
                or <code>"$item.title"</code>
              </>
            ) : null}
            . Literal values are preserved. No code is evaluated.
          </p>
        </>);}
