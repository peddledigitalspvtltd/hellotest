const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const authorization = require("../../../knowledge/backend/services/knowledgeAuthorization.service");

test("knowledge binding precedence denies by default and explicit DENY overrides explicit ALLOW", () => {
  const base = { project_id: "project", principal_type: "USER", principal_id: "reader", permission: "READ" };
  const evaluate = (bindings) => authorization.canRead({ bindings: bindings.map((binding) => ({ ...base, ...binding })), user: { id: "reader" }, projectId: "project" });
  assert.equal(evaluate([]), false);
  assert.equal(evaluate([{ effect: "ALLOW", inherited: true }]), true);
  assert.equal(evaluate([{ effect: "ALLOW", inherited: true }, { effect: "DENY", inherited: true }]), false);
  assert.equal(evaluate([{ effect: "DENY", inherited: true }, { effect: "ALLOW", inherited: false }]), true);
  assert.equal(evaluate([{ effect: "ALLOW", inherited: false }, { effect: "DENY", inherited: false }]), false);
  assert.equal(evaluate([{ effect: "ALLOW", project_id: "other-project" }]), false);
});

test("knowledge candidate budgets are shared across queries and never round zero up", () => {
  const { allocateCandidateBudgets } = require("../../../knowledge/backend/services/knowledgeRag.service")._internals;
  assert.deepEqual(allocateCandidateBudgets(3, 8), [3, 3, 2]);
  assert.deepEqual(allocateCandidateBudgets(3, 2), [1, 1]);
  assert.deepEqual(allocateCandidateBudgets(3, 0), []);
  assert.deepEqual(allocateCandidateBudgets(2, undefined), [undefined, undefined]);
  assert.deepEqual(allocateCandidateBudgets(2, 100_000), [1_000, 1_000]);
});

test("PostgreSQL knowledge revision promotion, ACL prefilters and archive retain canonical history", {
  skip: process.env.KNOWLEDGE_POSTGRES_TEST !== "1"
}, async () => {
  const db = require("../src/db");
  const rag = require("../../../knowledge/backend/services/knowledgeRag.service");
  const lifecycle = require("../../../knowledge/backend/services/knowledgeSourceLifecycle.service");
  const vector = require("../../../knowledge/backend/services/knowledgeVectorStore.service");
  const llmSelection = require("../../../integration/backend/services/aiLlmSelection.service");
  const { localEmbedding } = require("../../../knowledge/backend/services/knowledgeProcessing.service");
  const original = { isConfigured: vector.isConfigured, replaceDocument: vector.replaceDocument, search: vector.search, deleteSource: vector.deleteSource };
  const originalSelection = llmSelection.resolveLlmIntegrationForUsage;
  const admin = { id: "reader", role: "admin" };
  try {
    vector.isConfigured = () => false;
    await db.transaction(async () => {
      await db.query("CREATE TEMP TABLE roles (id TEXT PRIMARY KEY, name TEXT) ON COMMIT DROP");
      await db.query("CREATE TEMP TABLE users (id TEXT PRIMARY KEY, default_role_id TEXT, status TEXT) ON COMMIT DROP");
      await db.query("CREATE TEMP TABLE project_members (project_id TEXT, user_id TEXT, role_id TEXT) ON COMMIT DROP");
      await db.query("CREATE TEMP TABLE role_permissions (role_id TEXT, permission_id TEXT, PRIMARY KEY (role_id, permission_id)) ON COMMIT DROP");
      await db.query("INSERT INTO roles (id, name) VALUES ('workspace-role', 'workspace-reviewer'), ('project-role', 'project-reviewer'), ('other-role', 'other-reviewer')");
      await db.query("INSERT INTO users (id, default_role_id, status) VALUES ('reader', 'workspace-role', 'active')");
      await db.query("INSERT INTO project_members (project_id, user_id, role_id) VALUES ('project', 'reader', 'project-role'), ('other-project', 'reader', 'other-role')");
      const schema = await readFile(path.join(__dirname, "../instance-setup-data/schema-setup/schema.sql"), "utf8");
      for (const table of ["app_settings", "permissions", "ai_knowledge_sources", "ai_knowledge_documents", "ai_knowledge_chunks", "ai_knowledge_index_states", "ai_knowledge_security_bindings", "ai_knowledge_collection_sources", "ai_knowledge_ingestion_jobs", "ai_knowledge_ingestion_inputs", "ai_knowledge_ingestion_results", "ai_knowledge_relations"]) {
        const block = schema.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))[0];
        await db.query(block.replace("CREATE TABLE", "CREATE TEMP TABLE")
          .replace(/ REFERENCES [a-z_]+\(id\) ON DELETE (?:CASCADE|SET NULL)/g, "")
          .replace(/\n\);$/, "\n) ON COMMIT DROP;"));
      }
      await db.query("ALTER TABLE ai_knowledge_documents ADD COLUMN effective_from TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN effective_to TIMESTAMPTZ");
      await db.query("ALTER TABLE ai_knowledge_index_states ADD COLUMN required_indexes_ready BOOLEAN NOT NULL DEFAULT FALSE");
      const extension = await db.prepare("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS available").get();
      if (extension.available) await db.query("ALTER TABLE ai_knowledge_chunks ADD COLUMN embedding_vector vector");
      await db.query("CREATE UNIQUE INDEX ON ai_knowledge_documents (source_id) WHERE is_active = TRUE");
      const persist = async (text) => {
        const source = await rag._internals.createSource({ projectId: "project", userId: admin.id, input: {
          source_kind: "text", source_ref_id: "UX-227", title: "Onboarding", content: text, metadata: {}
        } });
        const result = await rag._internals.persistDocument({ projectId: "project", source, content: text,
          embeddingRuntime: { configured: false }, chunking: { strategy: "structure_aware", max_chars: 450, overlap_chars: 0 } });
        return { source, ...result };
      };
      const first = await persist("# Public decision\nOnboarding uses a simple form.\n\n# Restricted detail\nRestricted onboarding findings should remain private.\n".repeat(8));
      assert.equal(first.document.is_active, true);
      assert.ok(first.chunks.length > 1);
      await db.prepare("UPDATE ai_knowledge_documents SET effective_from = '2020-01-01' WHERE id = ?").run(first.document.id);
      vector.isConfigured = () => true;
      vector.replaceDocument = async () => { throw new Error("Index unavailable"); };
      const pending = await persist("# Current onboarding\nA changed form requires a new indexed revision.");
      assert.equal(pending.document.is_active, true, "Optional vector outages must not hide the current canonical revision.");
      assert.equal((await db.prepare("SELECT id FROM ai_knowledge_documents WHERE is_active = TRUE").get()).id, pending.document.id);
      assert.equal((await db.prepare("SELECT required_indexes_ready FROM ai_knowledge_index_states WHERE document_id = ?").get(pending.document.id)).required_indexes_ready, true);
      assert.match(pending.warning, /searchable using PostgreSQL/);
      const duringOutage = await rag.search({ projectId: "project", query: "changed form", user: admin,
        mode: "keyword", filters: { source_ids: [pending.source.id] } });
      assert.ok(duringOutage.results.some((hit) => hit.document_id === pending.document.id));
      vector.replaceDocument = async ({ chunks }) => ({ dimensions: 256, indexed: chunks.length });
      const promoted = await persist("# Current onboarding\nThe changed onboarding form is now indexed.\n\n# Internal evaluation\nPrivate onboarding participant observations.\n".repeat(8));
      assert.equal(promoted.document.is_active, true);
      assert.equal((await db.prepare("SELECT COUNT(*)::INTEGER AS count FROM ai_knowledge_documents WHERE is_active = TRUE").get()).count, 1);
      assert.ok((await db.prepare("SELECT effective_to FROM ai_knowledge_documents WHERE id = ?").get(first.document.id)).effective_to);
      const deniedId = promoted.chunks[0].id;
      const allowedSource = async () => {
        const acl = authorization.predicate({ user: { ...admin, roles: ['forged-role'] }, projectId: "project" });
        return db.prepare(`SELECT sources.id FROM ai_knowledge_sources sources WHERE sources.id = ? AND ${acl.sql}`).get(promoted.source.id, ...acl.params);
      };
      await authorization.replaceBindings({ sourceId: promoted.source.id, user: admin, bindings: [
        { principal_type: "ROLE", principal_id: "project-role", effect: "DENY" }
      ] });
      assert.equal(await allowedSource(), undefined, "project role UUID DENY overrides project default ALLOW");
      await db.query("UPDATE project_members SET role_id = 'other-role' WHERE project_id = 'project'");
      assert.ok(await allowedSource(), "changed project roles apply without refreshing the request user");
      await authorization.replaceBindings({ sourceId: promoted.source.id, user: admin, bindings: [
        { principal_type: "ROLE", principal_id: "workspace-role", effect: "DENY" }
      ] });
      assert.equal(await allowedSource(), undefined, "workspace default role UUID is server resolved");
      await authorization.replaceBindings({ sourceId: promoted.source.id, user: admin, bindings: [
        { principal_type: "ROLE", principal_id: "project-role", effect: "DENY" },
        { principal_type: "ROLE", principal_id: "forged-role", effect: "DENY" }
      ] });
      assert.ok(await allowedSource(), "client role arrays and revoked project roles do not match bindings");
      await authorization.replaceBindings({ sourceId: promoted.source.id, user: admin, bindings: [
        { chunk_id: deniedId, principal_type: "USER", principal_id: admin.id, effect: "ALLOW" },
        { chunk_id: deniedId, principal_type: "USER", principal_id: admin.id, effect: "DENY" }
      ] });
      let sawPrefilter = false;
      vector.search = async ({ authorizedChunkIds }) => {
        sawPrefilter = true;
        assert.ok(authorizedChunkIds.length);
        assert.equal(authorizedChunkIds.includes(deniedId), false);
        // A stale/malicious projection hit is also excluded during hydration.
        return { configured: true, hits: [{ chunk_id: deniedId, score: 1 }] };
      };
      const result = await rag.search({ projectId: "project", query: "onboarding", mode: "hybrid", user: admin,
        filters: { source_ids: [promoted.source.id] },
        preparedEmbedding: { model: "hellotest-hash-v1", vector: localEmbedding("onboarding"), fallback: localEmbedding("onboarding") } });
      assert.equal(sawPrefilter, true);
      assert.ok(result.results.length);
      assert.equal(result.results.some((hit) => hit.chunk_id === deniedId), false);
      const detail = await lifecycle.getDetail(promoted.source.id, { user: admin });
      assert.equal(detail.authorization.partial, true);
      assert.equal(detail.knowledge_object.contract_type, "KnowledgeObject");
      assert.equal(detail.knowledge_object.security.visibility, "PARTIAL");
      assert.equal(result.retrieval.source_acl.partial, true);
      assert.equal(detail.fragments.some((fragment) => fragment.id === deniedId), false);
      let embeddingResolutions = 0;
      llmSelection.resolveLlmIntegrationForUsage = async () => {
        embeddingResolutions += 1;
        throw new Error("Keyword retrieval must not resolve an embedding provider");
      };
      const multi = await rag.searchMany({ projectId: "project", queries: ["onboarding", "participant", "form"],
        mode: "keyword", user: admin, maxCandidates: 2, filters: { source_ids: [promoted.source.id] } });
      assert.equal(multi.query_count, 2);
      assert.equal(multi.skipped_query_count, 1);
      assert.ok(multi.candidate_count <= 2);
      assert.ok(multi.results.every((entry) => entry.result.retrieval.candidate_count <= 1));
      assert.equal(multi.embedding_batch_count, 0);
      const relatedSource = await rag._internals.createSource({ projectId: "project", userId: admin.id, input: {
        source_kind: "text", source_ref_id: "UX-228", title: "Onboarding confirmation", content: "Onboarding confirmation requires a verified email.", metadata: {}
      } });
      await rag._internals.persistDocument({ projectId: "project", source: relatedSource,
        content: "Onboarding confirmation requires a verified email.", embeddingRuntime: { configured: false } });
      await db.prepare(`INSERT INTO ai_knowledge_relations (id, project_id, source_id, source_type, target_id, target_type, relation_type)
        VALUES ('confirmation-relation', 'project', 'UX-227', 'text', 'UX-228', 'text', 'RELATED_TO')`).run();
      const related = await rag.expandRelationships({ projectId: "project", user: admin, hits: result.results,
        query: "onboarding", mode: "keyword", maxCandidates: 3 });
      assert.equal(related.relationships.length, 1);
      assert.ok(related.results.some((hit) => hit.source_id === relatedSource.id));
      assert.equal(related.retrieval.embedding_model, null);
      assert.equal(embeddingResolutions, 0, "keyword batch and relationship searches never resolve an embedding runtime");
      llmSelection.resolveLlmIntegrationForUsage = originalSelection;
      const expanded = await rag.expandEvidence({ projectId: "project", user: admin, hits: result.results.slice(0, 2), window: 2 });
      assert.equal(expanded.results.some((fragment) => fragment.chunk_id === deniedId), false);
      const historical = await lifecycle.getDetail(promoted.source.id, { user: admin, asOf: "2021-01-01T00:00:00Z" });
      assert.equal(historical.revision.id, first.document.id);
      await assert.rejects(lifecycle.getDetail(promoted.source.id, { user: { id: "no-audit", role: "member" }, asOf: "2021-01-01T00:00:00Z" }), /knowledge.manage/);
      await db.prepare("UPDATE ai_knowledge_sources SET attachment_id = 'original-file' WHERE id = ?").run(promoted.source.id);
      await assert.rejects(lifecycle.getDownload(promoted.source.id, { user: admin }), /restricted fragments/);
      const access = await authorization.getEvidenceAccess({ projectId: "project", user: admin,
        evidence: [{ chunk_id: deniedId, content: "must not return" }, result.results[0]] });
      assert.equal(access.allowed.length, 1);
      assert.deepEqual(access.denied_ids, [deniedId]);
      await authorization.replaceBindings({ sourceId: promoted.source.id, user: admin, bindings: promoted.chunks.map((fragment) => ({
        chunk_id: fragment.id, principal_type: "USER", principal_id: admin.id, effect: "DENY"
      })) });
      const metadataOnly = await lifecycle.getDetail(promoted.source.id, { user: admin });
      assert.equal(metadataOnly.source.id, promoted.source.id);
      assert.equal(metadataOnly.authorization.partial, true);
      assert.deepEqual(metadataOnly.fragments, []);
      assert.equal(metadataOnly.knowledge_object, null);
      await authorization.replaceBindings({ sourceId: promoted.source.id, user: admin, bindings: [] });
      vector.deleteSource = async () => ({ deleted: true });
      const archived = await lifecycle.remove({ source: promoted.source, user: admin });
      assert.equal(archived.retained_history, true);
      assert.equal((await db.prepare("SELECT COUNT(*)::INTEGER AS count FROM ai_knowledge_documents WHERE source_id = ?").get(promoted.source.id)).count, 3);
      assert.equal((await db.prepare("SELECT COUNT(*)::INTEGER AS count FROM ai_knowledge_documents WHERE source_id = ? AND is_active = TRUE").get(promoted.source.id)).count, 0);
      const after = await authorization.getEvidenceAccess({ projectId: "project", user: admin, evidence: result.results });
      assert.deepEqual(after.allowed, []);
      const retained = await lifecycle.listRevisions(promoted.source.id, { user: admin });
      assert.equal(retained.revisions.length, 3);
    })();
  } finally {
    Object.assign(vector, original);
    llmSelection.resolveLlmIntegrationForUsage = originalSelection;
    await db.close();
  }
});
