import type { WorkflowOperationEditorProps } from "./operationEditorTypes";

export function ErrorHandlerFields(props:WorkflowOperationEditorProps){



return (<p className="studio-caption">
          Connect a node whose error policy is “Route to error handler”. This
          branch runs only when that node fails; permission failures always stop
          execution.
        </p>);
}
