const z=require('zod');
const id=z.string().min(1).max(255);
const record=z.record(z.string(),z.unknown());
const states=z.enum(['requires_authorization','authorized','executing','submitted','succeeded_verified','succeeded_proposal','failed','unknown']);
const operation=z.object({id,method:z.string(),path:z.string(),permission:z.string().nullable(),read:z.boolean(),prepare:z.boolean(),exposure:z.string(),reason:z.string().nullable(),input_schema:record.nullable().optional(),path_parameters:z.array(z.string())}).passthrough();
const envelope=data=>z.object({schema_version:z.literal('1'),scope:z.object({project_id:id,subject:id}).strict(),data}).strict();
const delivery=z.object({truncated:z.boolean(),redacted:z.boolean(),omitted_items:z.number().int().nonnegative(),truncated_strings:z.number().int().nonnegative()}).strict();
const schemas={
  catalog:z.object({catalog_revision:z.string(),total:z.number().int().nonnegative(),operations:z.array(operation),next_offset:z.number().int().nonnegative().nullable(),coverage:record,contract_note:z.string()}).passthrough(),
  describe:operation.extend({catalog_revision:z.string(),input_schema:record.nullable()}),
  read:z.object({data:z.unknown(),observed_at:z.string(),bounded:z.literal(true),delivery:delivery.optional()}).passthrough(),
  plan:z.object({plan_id:id,digest:z.string(),state:z.literal('requires_authorization'),preview:z.object({operation,arguments:record}).passthrough(),expires_at:z.string(),authorization:z.string()}).passthrough(),
  execute:z.object({plan_id:id,state:states,domain_id:id.optional(),verification:record.optional(),data:z.unknown().optional(),delivery:delivery.optional(),receipt:z.unknown().optional(),expires_at:z.unknown().optional(),reconciliation:z.string().optional(),code:z.string().optional(),message:z.string().optional()}).passthrough(),
  status:z.object({plan_id:id,state:states,receipt:z.unknown().nullable().optional(),expires_at:z.unknown(),reconciliation:z.string().optional()}).passthrough(),
  query:z.object({entity:z.string(),rows:z.array(record).max(50),next_offset:z.number().int().nonnegative().nullable(),observed_at:z.string(),source:z.literal('authorized_postgresql_projection'),delivery:delivery.optional()}).strict(),
};

function annotations(name,tool) {
  return {readOnlyHint:!tool.write,destructiveHint:tool.destructive ?? name==='hellotest_operation_execute',
    idempotentHint:tool.idempotent ?? (!tool.write || name==='hellotest_operation_execute'),
    openWorldHint:tool.external ?? ['hellotest_context_build','hellotest_operation_execute'].includes(name)};
}

module.exports={envelope,schemas,annotations,delivery};
