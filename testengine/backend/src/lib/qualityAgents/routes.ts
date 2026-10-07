import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { QualityAgentRuntime } from "./runtime.js";
import { QualityError } from "./contracts.js";
export async function registerQualityAgentRoutes(app:FastifyInstance,guard:(request:FastifyRequest,reply:FastifyReply)=>Promise<void>,runtime?:QualityAgentRuntime) {
  const engine=runtime||await new QualityAgentRuntime().initialize();
  const options={preHandler:guard};
  const handle=async(reply:FastifyReply,task:()=>Promise<unknown>)=>{try{return await task();}catch(error){const failure=error instanceof QualityError?error:new QualityError("QUALITY_ENGINE_ERROR","The quality engine could not complete this operation.",500);reply.code(failure.statusCode);return {code:failure.code,message:failure.message};}};
  app.get("/api/v1/quality-agents/capabilities",options,async()=>engine.capabilities());
  app.post("/api/v1/quality-agents/runs",options,async(request,reply)=>handle(reply,async()=>{const run=await engine.accept(request.body);reply.code(202);return run;}));
  app.get("/api/v1/quality-agents/runs",options,async(request,reply)=>handle(reply,async()=>{const query=request.query as {project_id?:string};if(!query.project_id)throw new QualityError("QUALITY_SCOPE_REQUIRED","project_id is required.");return {items:engine.list(query.project_id)};}));
  app.get("/api/v1/quality-agents/runs/:id",options,async(request,reply)=>handle(reply,async()=>{const run=engine.get((request.params as {id:string}).id);if(!run)throw new QualityError("QUALITY_RUN_NOT_FOUND","Quality run was not found.",404);return run;}));
  app.post("/api/v1/quality-agents/runs/:id/cancel",options,async(request,reply)=>handle(reply,()=>engine.cancel((request.params as {id:string}).id)));
  app.post("/api/v1/quality-agents/runs/by-client/:clientRunId/cancel",options,async(request,reply)=>handle(reply,async()=>{const body=request.body as {scope?:{project_id:string;app_type_id?:string|null}};if(!body?.scope||typeof body.scope.project_id!=="string")throw new QualityError("QUALITY_SCOPE_REQUIRED","The original project/application scope is required.");return engine.cancelByClient((request.params as {clientRunId:string}).clientRunId,body.scope);}));
  app.post("/api/v1/quality-agents/runs/:id/archive",options,async(request,reply)=>handle(reply,()=>engine.archive((request.params as {id:string}).id)));
  app.get("/api/v1/quality-agents/runs/:id/artifacts/:artifactId",options,async(request,reply)=>handle(reply,async()=>{const params=request.params as {id:string;artifactId:string};const evidence=await engine.readArtifact(params.id,params.artifactId);reply.header("cache-control","no-store").header("x-content-type-options","nosniff").header("content-type",evidence.artifact.content_type).header("content-disposition",`inline; filename="${evidence.artifact.name.replace(/[^A-Za-z0-9._ -]/g,"_")}"`).header("x-content-sha256",evidence.artifact.sha256);return reply.send(evidence.bytes);}));
  app.get("/api/v1/quality-agents/baselines",options,async(request,reply)=>handle(reply,async()=>{const query=request.query as {project_id?:string};if(!query.project_id)throw new QualityError("QUALITY_SCOPE_REQUIRED","project_id is required.");return {items:engine.listBaselines(query.project_id)};}));
  app.post("/api/v1/quality-agents/baselines",options,async(request,reply)=>handle(reply,async()=>{
    const body=request.body as Record<string,unknown>;
    if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(key=>!["scope","source_run_id","artifact_id","reviewed_by"].includes(key)))throw new QualityError("QUALITY_INPUT_INVALID","Invalid baseline review request.");
    const scope=body.scope as {project_id:string;app_type_id?:string|null};
    if(!scope||typeof scope.project_id!=="string"||typeof body.source_run_id!=="string"||typeof body.artifact_id!=="string"||typeof body.reviewed_by!=="string")throw new QualityError("QUALITY_INPUT_INVALID","A source run, screenshot, project scope and authorized reviewer are required.");
    const baseline=await engine.reviewBaseline({scope,source_run_id:body.source_run_id,artifact_id:body.artifact_id,reviewed_by:body.reviewed_by});reply.code(201);return baseline;
  }));
  app.addHook("onClose",()=>engine.close());return engine;
}
