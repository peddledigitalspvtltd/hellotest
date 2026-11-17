import type {AgenticWorkflowNodeData} from '@hellotest/platform/frontend/src/types';
export type WorkflowOperationEditorProps={data:AgenticWorkflowNodeData;projectId:string;appTypeId:string;canRun:boolean;triggerInput?:Record<string,unknown>;onChange:(patch:Partial<AgenticWorkflowNodeData>)=>void;};
