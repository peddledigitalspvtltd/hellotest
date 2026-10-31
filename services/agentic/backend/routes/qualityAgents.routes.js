const service=require('../services/qualityAgents.service');
// These settings are saved with the run. Declaring them here prevents Fastify
// from stripping the very instructions/model policy shown in the agent UI.
const qualityModelFields = {
  instructions: { type: 'string', maxLength: 4000 }, guardrails: { type: 'string', maxLength: 2000 }, review_criteria: { type: 'string', maxLength: 4000 },
  ai_configuration: { type: 'object', additionalProperties: false, properties: {
    temperature: { type: 'number', minimum: 0, maximum: 2 }, top_p: { type: ['number', 'null'], minimum: 0.01, maximum: 1 },
    max_output_tokens: { type: 'integer', minimum: 256, maximum: 16384 }, output_schema: { type: ['object', 'null'] },
    context: { type: 'object', additionalProperties: false, required: ['mode', 'token_budget', 'max_items', 'required', 'focus'], properties: {
      mode: { enum: ['none', 'mcp'] }, token_budget: { type: 'integer', minimum: 256, maximum: 8000 }, max_items: { type: 'integer', minimum: 1, maximum: 40 },
      required: { type: 'boolean' }, focus: { type: 'string', maxLength: 4000 }
    } },
    agent_execution: { type: 'object', additionalProperties: false, required: ['max_model_calls', 'max_revision_rounds', 'max_followups', 'timeout_ms'], properties: {
      max_model_calls: { type: 'integer', minimum: 1, maximum: 8 }, max_revision_rounds: { type: 'integer', minimum: 0, maximum: 3 },
      max_followups: { type: 'integer', minimum: 0, maximum: 3 }, timeout_ms: { type: 'integer', minimum: 10000, maximum: 150000 }
    } }
  } }
};
module.exports=async function qualityAgentRoutes(fastify) {
  fastify.get('/agentic-quality/catalog',async req=>{await fastify.authenticate(req);return service.catalog(req.query,req.user);});
  fastify.post('/agentic-quality/plan',{bodyLimit:96000},async req=>{await fastify.authenticate(req);return service.plan(req.body||{},req.user);});
  fastify.get('/agentic-quality/runs',async req=>{await fastify.authenticate(req);return service.listRuns(req.query,req.user);});
  fastify.post('/agentic-quality/runs',{bodyLimit:24000,schema:{"body":{"type":"object","additionalProperties":false,"required":["project_id","kind","target_url"],"properties":{...qualityModelFields,"project_id":{"type":"string","minLength":1,"maxLength":255},"app_type_id":{"type":"string","maxLength":255},"kind":{"enum":["web","security","performance","accessibility","visual"]},"execution_mode":{"enum":["agent","checks"]},"target_url":{"type":"string","minLength":1,"maxLength":2000},"goal":{"type":"string","minLength":0,"maxLength":1500},"baseline_id":{"type":"string","maxLength":255},"options":{"type":"object","additionalProperties":false,"properties":{"mission":{"type":"object","additionalProperties":false,"required":["max_actions","allow_form_submission"],"properties":{"max_actions":{"type":"integer","minimum":1,"maximum":12},"allow_form_submission":{"type":"boolean"}}},"credential_ref":{"type":"string","pattern":"^[A-Za-z0-9_.:-]{1,128}$"},"timeout_ms":{"type":"integer","minimum":5000,"maximum":120000},"max_pages":{"type":"integer","minimum":1,"maximum":5},"viewport":{"type":"object","additionalProperties":false,"required":["width","height"],"properties":{"width":{"type":"integer","minimum":320,"maximum":1920},"height":{"type":"integer","minimum":240,"maximum":1200}}},"wait_until":{"enum":["domcontentloaded","load"]},"masks":{"type":"array","maxItems":20,"items":{"type":"string","maxLength":240}},"budgets":{"type":"object","properties":{"navigation_ms":{"type":"number"},"lcp_ms":{"type":"number"},"cls":{"type":"number"},"resource_count":{"type":"number"},"transfer_bytes":{"type":"number"}},"additionalProperties":false},"max_diff_ratio":{"type":"number","minimum":0,"maximum":1},"pixel_threshold":{"type":"integer","minimum":0,"maximum":255}}},"integration_id":{"type":"string","maxLength":255},"idempotency_key":{"type":"string","maxLength":160},"reviewed_plan":{"type":"object","additionalProperties":false,"required":["reviewed","steps"],"properties":{"reviewed":{"const":true},"goal":{"type":"string","maxLength":1500},"steps":{"type":"array","maxItems":12,"items":{"type":"object","additionalProperties":false,"required":["action"],"properties":{"id":{"type":"string","maxLength":128},"label":{"type":"string","maxLength":120},"action":{"enum":["click","fill","assert_text","assert_url"]},"selector":{"type":"string","maxLength":240},"value":{"type":"string","maxLength":500},"text":{"type":"string","maxLength":500},"url":{"type":"string","maxLength":2000}}}}}},"llm_integration_id":{"type":["string","null"],"maxLength":255},"context_scopes":{"type":"array","maxItems":6,"uniqueItems":true,"items":{"enum":["stories","test-cases","automation","runs","bugs","knowledge"]}},"evidence_scope":{"type":"object","additionalProperties":false,"properties":{"story_id":{"type":"string","maxLength":255},"test_case_id":{"type":"string","maxLength":255},"execution_id":{"type":"string","maxLength":255},"release_id":{"type":"string","maxLength":255},"sprint_id":{"type":"string","maxLength":255}}},"smart_context":{"type":"object","additionalProperties":false,"properties":{"query":{"type":"string","maxLength":2000},"reviewed_context":{"type":"string","maxLength":12000},"source_ids":{"type":"array","maxItems":100,"items":{"type":"string","maxLength":255}},"source_kinds":{"type":"array","maxItems":20,"items":{"type":"string","maxLength":80}}}}}}}},async(req,reply)=>{await fastify.authenticate(req);const run=await service.createRun(req.body||{},req.user,{requestKey:req.headers['idempotency-key']});return reply.code(202).header('Location',`/agentic-quality/runs/${run.id}`).send(run);});
  fastify.get('/agentic-quality/runs/:id',async req=>{await fastify.authenticate(req);return service.getRun(req.params.id,req.user);});
  fastify.get('/agentic-quality/runs/:id/events', async (req, reply) => {
    await fastify.authenticate(req);
    const parseCursor = require('../services/qualityAgentEvents').cursor;
    const queryCursor = req.query?.after, headerCursor = req.headers?.['last-event-id'];
    if (queryCursor != null && headerCursor != null && String(queryCursor) !== String(headerCursor)) throw Object.assign(new Error('Progress cursors must match.'), { statusCode: 400 });
    let cursor = parseCursor(queryCursor ?? headerCursor ?? 0);
    const initial = await service.getRun(req.params.id, req.user);
    let page = await service.listStreamEvents(req.params.id, req.user, { after: cursor, limit: 200 });
    const controller = new AbortController();
    const close = () => controller.abort();
    reply.raw.once('close', close);
    async function* events() {
      let current = initial, previous = '', started = Date.now(), heartbeatAt = Date.now();
      try {
        while (!controller.signal.aborted && Date.now() - started < 180000) {
          // Scope is rechecked by both reads. Persisted log IDs survive refresh,
          // tab changes and replica changes; browser disconnect never cancels work.
          for (const entry of page.items) {
            if (entry.seq <= cursor) continue;
            if (entry.run_id !== initial.id || entry.project_id !== initial.project_id || (entry.app_type_id || null) !== (initial.app_type_id || null)) throw new Error('Invalid progress scope.');
            yield `id: ${entry.seq}\nevent: agent\ndata: ${JSON.stringify(entry)}\n\n`;
            cursor = entry.seq;
          }
          if (page.has_more) { page = await service.listStreamEvents(req.params.id, req.user, { after: cursor, limit: 200 }); continue; }
          const serialized = JSON.stringify(current);
          if (serialized !== previous) { yield `event: progress\ndata: ${serialized}\n\n`; previous = serialized; }
          if (!['queued','running'].includes(current.status)) { yield 'event: complete\ndata: {}\n\n'; return; }
          if (Date.now() - heartbeatAt >= 10000) { yield ': keepalive\n\n'; heartbeatAt = Date.now(); }
          try { await require('node:timers/promises').setTimeout(500, undefined, { signal: controller.signal }); } catch { return; }
          if (!controller.signal.aborted) {
            current = await service.getRun(req.params.id, req.user);
            page = await service.listStreamEvents(req.params.id, req.user, { after: cursor, limit: 200 });
          }
        }
      } catch { if (!controller.signal.aborted) yield 'event: unavailable\ndata: {}\n\n'; }
      finally { reply.raw.off('close', close); controller.abort(); }
    }
    return reply.header('Cache-Control','private, no-store, no-transform').header('X-Accel-Buffering','no').type('text/event-stream; charset=utf-8').send(require('node:stream').Readable.from(events()));
  });
  fastify.post('/agentic-quality/runs/:id/cancel',async req=>{await fastify.authenticate(req);return service.cancelRun(req.params.id,req.user);});
  fastify.get('/agentic-quality/baselines',async req=>{await fastify.authenticate(req);return service.listBaselines(req.query,req.user);});
  fastify.post('/agentic-quality/runs/:id/baseline',{bodyLimit:2048},async(req,reply)=>{await fastify.authenticate(req);return reply.code(201).send(await service.approveBaseline(req.params.id,req.body||{},req.user));});
  const sendArtifact=(reply,result)=>reply.header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"default-src 'none'; sandbox").header('Content-Disposition',`${result.content_type==='image/png'?'inline':'attachment'}; filename="${result.content_type==='image/png'?'quality-evidence.png':'quality-evidence.json'}"`).type(result.content_type).send(result.bytes);
  fastify.get('/agentic-quality/runs/:id/artifacts/:artifactId',async(req,reply)=>{await fastify.authenticate(req);return sendArtifact(reply,await service.getArtifact(req.params.id,req.params.artifactId,req.user));});
  fastify.get('/agentic-quality/baselines/:id/artifact',async(req,reply)=>{await fastify.authenticate(req);return sendArtifact(reply,await service.getBaselineArtifact(req.params.id,req.user));});
};
