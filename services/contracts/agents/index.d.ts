export type AgentSystem = 'workflow'|'repository'|'quality'|'automation';
export type AgentStatus = 'queued'|'running'|'waiting'|'succeeded'|'partial'|'failed'|'cancelled'|'unknown';
export type AgentGuardrail = {id:string;text:string;enforcement:'code'|'prompt';severity:'warning'|'error'};
export type AgentDescriptor = {schema_version:'agent-descriptor/1';system:AgentSystem;id:string;name:string;objective:string;instructions:{version:string;parts:string[]};tools:Array<{name:string;effect:'read'|'reviewed_action'|'compiler'}>;guardrails?:AgentGuardrail[];evidence:{scopes:string[]};output:{contract:string;review_required:true};limits:Record<string,number>};
export const VERSION:'agent-descriptor/1';
export const RUN_VERSION:'agent-run/1';
export const SYSTEMS:readonly AgentSystem[];
export const STATUSES:readonly AgentStatus[];
export const STATUS_LABELS:Record<AgentStatus,string>;
export function status(value:unknown):AgentStatus;
export function descriptor(input:AgentDescriptor):AgentDescriptor;

export type AgentReviewRequest = { project_id:string; app_type_id?:string; mode:'chat'|'agent'; agent_id:string; agent_version?:number; inputs?:Record<string,unknown>; prompt:string; context_scopes:string[]; smart_context?:{query:string;source_ids?:string[];source_kinds?:string[];reviewed_context?:string};integration_id?:string;history?:Array<{role:'user'|'assistant';content:string}> };
