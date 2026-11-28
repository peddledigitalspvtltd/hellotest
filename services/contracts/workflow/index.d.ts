export type WorkflowExecutorFamily = 'trigger' | 'specialist' | 'repository' | 'merge' | 'output' | 'operation' | 'flow';
export type WorkflowNodeDescriptor = {
  kind: string; label: string; description: string; executor: WorkflowExecutorFamily; executable: boolean; specialist: boolean;
  agent_output?: 'final' | 'loop-review';
  exclusive: 'always' | 'http_write' | 'repository_review' | 'never'; schema: { type: 'object'; properties: { kind: { const: string } }; additionalProperties: boolean };
  handles: Array<{ id: string; label: string }>; dynamicHandles: string | null; targetHandles: string[];
  ui: { icon: string; panel: string; paletteGroup: string }; defaults: Record<string, unknown>;
};
export declare const NODE_DESCRIPTOR_VERSION: 1;
export declare const EXECUTOR_FAMILIES: readonly WorkflowExecutorFamily[];
export declare function assertNodeRegistry<T>(registry: T): T;
export declare function validateNodeEnvelope(descriptor: WorkflowNodeDescriptor, data: unknown): string[];
