import type {ComponentType} from 'react';
import nodeKinds from '../../../shared/workflowNodeKinds.json';
import type {WorkflowOperationEditorProps} from './operationEditorTypes';
import {ArtifactTaskFields} from './ArtifactTaskFields';
import {ApiToolFields} from './ApiToolFields';
import {ApiAgentFields} from './ApiAgentFields';
import {WebAgentFields} from './WebAgentFields';
import {McpToolFields} from './McpToolFields';
import {KnowledgeToolFields} from './KnowledgeToolFields';
import {RepositoryToolFields} from './RepositoryToolFields';
import {TestOpsToolFields} from './TestOpsToolFields';
import {ConditionFields} from './ConditionFields';
import {DataOperationFields} from './DataOperationFields';
import {WaitFields} from './WaitFields';
import {StopFields} from './StopFields';
import {AggregatorFields} from './AggregatorFields';
import {LoopFields} from './LoopFields';
import {TransformFields} from './TransformFields';
import {ErrorHandlerFields} from './ErrorHandlerFields';
import {LogFields} from './LogFields';
import {QualityAgentFields} from './QualityAgentFields';
export type WorkflowOperationEditorKind=keyof typeof nodeKinds.kinds;
type EditorDefinition={Fields:ComponentType<WorkflowOperationEditorProps>|null;owner:'operation'|'inspector'};
/** Concrete kind owners. Shared field/transport primitives do not dispatch kinds. */
const editors={
artifactTask:{Fields:ArtifactTaskFields,owner:'operation'},
apiTool:{Fields:ApiToolFields,owner:'operation'},
apiAgent:{Fields:ApiAgentFields,owner:'operation'},
webAgent:{Fields:WebAgentFields,owner:'operation'},
mcpTool:{Fields:McpToolFields,owner:'operation'},
knowledgeTool:{Fields:KnowledgeToolFields,owner:'operation'},
repositoryTool:{Fields:RepositoryToolFields,owner:'operation'},
testOpsTool:{Fields:TestOpsToolFields,owner:'operation'},
condition:{Fields:ConditionFields,owner:'operation'},
dataOperation:{Fields:DataOperationFields,owner:'operation'},
wait:{Fields:WaitFields,owner:'operation'},
stop:{Fields:StopFields,owner:'operation'},
aggregator:{Fields:AggregatorFields,owner:'operation'},
loop:{Fields:LoopFields,owner:'operation'},
transform:{Fields:TransformFields,owner:'operation'},
errorHandler:{Fields:ErrorHandlerFields,owner:'operation'},
log:{Fields:LogFields,owner:'operation'},
agent:{Fields:null,owner:'inspector'},
llmAgent:{Fields:null,owner:'inspector'},
customAI:{Fields:null,owner:'inspector'},
repositoryAgent:{Fields:null,owner:'inspector'},
qualityAgent:{Fields:QualityAgentFields,owner:'operation'},
trigger:{Fields:null,owner:'inspector'},
output:{Fields:null,owner:'inspector'}
} satisfies Record<WorkflowOperationEditorKind,EditorDefinition>;
export const workflowOperationEditors=Object.freeze(Object.fromEntries(Object.entries(editors).map(([kind,editor])=>[kind,{...editor,descriptor:nodeKinds.kinds[kind as WorkflowOperationEditorKind]}])) as Record<WorkflowOperationEditorKind,EditorDefinition&{descriptor:typeof nodeKinds.kinds[WorkflowOperationEditorKind]}>);
export function workflowOperationEditor(kind:string){return Object.prototype.hasOwnProperty.call(workflowOperationEditors,kind)?workflowOperationEditors[kind as WorkflowOperationEditorKind]:undefined;}
