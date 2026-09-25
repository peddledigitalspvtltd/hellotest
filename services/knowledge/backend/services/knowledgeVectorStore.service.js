const { createHash } = require("crypto");
const { config } = require("@hellotest/platform/backend/src/config");

const PUBLIC_SCOPE = "__public__";
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const UPSERT_BATCH_SIZE = 128;
const COLLECTION_CACHE_TTL_MS = 5 * 60 * 1_000;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;
const ensuredCollections = new Map();
const collectionPromises = new Map();
let consecutiveFailures = 0;
let circuitOpenedAt = 0;

const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const asArray = (value) => Array.isArray(value) ? value : [];
const text = (value, max = 2_000) => String(value ?? "").trim().slice(0, max);
const unique = (value, max = 100) => [...new Set(asArray(value).map((item) => text(item, 255)).filter(Boolean))].slice(0, max);
const fingerprint = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");
const safeCollectionPrefix = (value) => text(value, 120).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "hellotest_knowledge_dense_v1";

const settings = () => ({
  provider: text(config.knowledge?.vectorStore?.provider, 40).toLowerCase(),
  baseUrl: text(config.knowledge?.vectorStore?.qdrantUrl, 2_000).replace(/\/+$/, ""),
  apiKey: text(config.knowledge?.vectorStore?.qdrantApiKey, 8_000),
  collectionPrefix: safeCollectionPrefix(config.knowledge?.vectorStore?.qdrantCollectionPrefix),
  timeoutMs: Math.max(500, Math.min(30_000, Number(config.knowledge?.vectorStore?.qdrantTimeoutMs || 4_000)))
});

const isConfigured = () => {
  const runtime = settings();
  return runtime.provider === "qdrant" && /^https?:\/\//i.test(runtime.baseUrl);
};

const collectionName = (dimensions) => `${settings().collectionPrefix}_d${Number(dimensions)}`;

const readJsonBounded = async (response) => {
  const declared = Number(response.headers?.get?.("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("Qdrant response exceeded the configured limit");
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) throw new Error("Qdrant response exceeded the configured limit");
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Qdrant returned an invalid JSON response");
  }
};

const request = async (path, { method = "GET", body, signal, allow = [] } = {}) => {
  if (signal?.aborted) throw signal.reason || new Error("Vector retrieval cancelled");
  const runtime = settings();
  if (!isConfigured()) throw new Error("Qdrant knowledge projection is not configured");
  if (consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD && Date.now() - circuitOpenedAt < CIRCUIT_COOLDOWN_MS) {
    const error = new Error("Qdrant knowledge projection circuit is open");
    error.code = "KNOWLEDGE_VECTOR_CIRCUIT_OPEN";
    throw error;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Qdrant request timed out")), runtime.timeoutMs);
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener?.("abort", abort, { once: true });
  try {
    const response = await fetch(`${runtime.baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(runtime.apiKey ? { "api-key": runtime.apiKey } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok && !allow.includes(response.status)) {
      throw new Error(`Qdrant returned HTTP ${response.status}`);
    }
    consecutiveFailures = 0;
    return { status: response.status, payload: await readJsonBounded(response) };
  } catch (error) {
    // A caller cancelling its request is not evidence that Qdrant is unhealthy.
    if (!signal?.aborted) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) circuitOpenedAt = Date.now();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", abort);
  }
};

const createPayloadIndex = async (name, fieldName, fieldSchema, signal) => {
  try {
    await request(`/collections/${encodeURIComponent(name)}/index?wait=true`, {
      method: "PUT",
      body: { field_name: fieldName, field_schema: fieldSchema },
      allow: [409], signal
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    // Index creation is an optimization. Query filters remain mandatory and
    // correct while a rolling deployment finishes creating payload indexes.
  }
};

const ensureCollection = async (dimensions, { signal } = {}) => {
  if (signal?.aborted) throw signal.reason || new Error("Vector indexing cancelled");
  if (!isConfigured()) return null;
  const size = Number(dimensions);
  if (!Number.isInteger(size) || size < 8 || size > 8_192) throw new Error("Embedding dimensions are outside the supported Qdrant range");
  const name = collectionName(size);
  if (Date.now() - Number(ensuredCollections.get(name) || 0) < COLLECTION_CACHE_TTL_MS) return name;
  if (collectionPromises.has(name)) return collectionPromises.get(name);
  const operation = (async () => {
    const current = await request(`/collections/${encodeURIComponent(name)}`, { allow: [404], signal });
    if (current.status === 404) {
      await request(`/collections/${encodeURIComponent(name)}`, {
        method: "PUT",
        body: {
          vectors: { size, distance: "Cosine", on_disk: true },
          on_disk_payload: true
        },
        allow: [409], signal
      });
    }
    await Promise.all([
      createPayloadIndex(name, "project_id", "keyword", signal),
      createPayloadIndex(name, "allowed_scope", "keyword", signal),
      createPayloadIndex(name, "embedding_model", "keyword", signal),
      createPayloadIndex(name, "source_id", "keyword", signal),
      createPayloadIndex(name, "document_id", "keyword", signal),
      createPayloadIndex(name, "source_kind", "keyword", signal),
      createPayloadIndex(name, "app_type_id", "keyword", signal),
      createPayloadIndex(name, "is_current", "bool", signal)
    ]);
    ensuredCollections.set(name, Date.now());
    return name;
  })();
  collectionPromises.set(name, operation);
  try {
    return await operation;
  } finally {
    collectionPromises.delete(name);
  }
};

const deleteByFilter = async (name, filter, { signal } = {}) => request(
  `/collections/${encodeURIComponent(name)}/points/delete?wait=true`,
  { method: "POST", body: { filter }, signal }
);

const replaceDocument = async ({ projectId, source, documentId, chunks, vectors, embeddingModel, signal } = {}) => {
  if (!isConfigured()) return { configured: false, indexed: 0, provider: "postgresql" };
  const normalizedVectors = asArray(vectors);
  const normalizedChunks = asArray(chunks);
  if (!normalizedChunks.length || normalizedChunks.length !== normalizedVectors.length) throw new Error("Qdrant projection requires one vector per chunk");
  const dimensions = normalizedVectors[0]?.length;
  if (!normalizedVectors.every((vector) => Array.isArray(vector) && vector.length === dimensions && vector.every(Number.isFinite))) {
    throw new Error("Qdrant projection received inconsistent embedding vectors");
  }
  const name = await ensureCollection(dimensions, { signal });
  const normalizedProjectId = text(projectId, 255);
  const normalizedSourceId = text(source?.id, 255);
  await deleteByFilter(name, {
    must: [
      { key: "project_id", match: { value: normalizedProjectId } },
      { key: "source_id", match: { value: normalizedSourceId } },
      { key: "document_id", match: { value: text(documentId, 255) } }
    ]
  }, { signal });
  let indexed = 0;
  for (let start = 0; start < normalizedChunks.length; start += UPSERT_BATCH_SIZE) {
    const batch = normalizedChunks.slice(start, start + UPSERT_BATCH_SIZE).map((chunk, offset) => ({
      id: text(chunk.id, 255),
      vector: normalizedVectors[start + offset],
      payload: {
        project_id: normalizedProjectId,
        source_id: normalizedSourceId,
        document_id: text(documentId, 255),
        chunk_id: text(chunk.id, 255),
        source_kind: text(source?.source_kind, 80),
        source_ref_id: text(source?.source_ref_id, 500) || null,
        app_type_id: text(source?.app_type_id, 255) || "__all__",
        allowed_scope: source?.required_permission ? [text(source.required_permission, 100)] : [PUBLIC_SCOPE],
        embedding_model: text(embeddingModel, 255),
        is_current: true,
        chunk_index: Number(chunk.index || 0),
        content_hash: fingerprint(chunk.content)
      }
    }));
    await request(`/collections/${encodeURIComponent(name)}/points?wait=true`, {
      method: "PUT",
      body: { points: batch },
      signal
    });
    indexed += batch.length;
  }
  return { configured: true, indexed, provider: "qdrant", collection: name, dimensions };
};

const search = async ({ projectId, queryVector, embeddingModel, allowedPermissions, authorizedChunkIds, sourceKinds, sourceIds, appTypeId, historical = false, limit = 250, signal } = {}) => {
  if (!isConfigured()) return { configured: false, hits: [], provider: "postgresql" };
  // The canonical database resolves current ACLs before any similarity query.
  // Stale vector payload permissions can only narrow this bounded live allowlist.
  if (!Array.isArray(authorizedChunkIds)) throw new Error("Live authorized fragment IDs are required for vector retrieval");
  if (authorizedChunkIds.length > 10_000) throw new Error("Authorized vector scope exceeds the bounded query limit");
  const allowedIds = unique(authorizedChunkIds, 10_000);
  if (!allowedIds.length) return { configured: true, hits: [], provider: "qdrant" };
  const vector = asArray(queryVector);
  if (signal?.aborted) throw signal.reason || new Error("Vector retrieval cancelled");
  if (vector.length < 8 || vector.length > 8_192 || !vector.every(Number.isFinite)) {
    throw new Error("Embedding dimensions are outside the supported Qdrant range");
  }
  // Collection creation and payload indexing belong to ingestion. A cold read
  // must not wait for ten setup requests before performing its bounded query.
  const name = collectionName(vector.length);
  const must = [
    { key: "project_id", match: { value: text(projectId, 255) } },
    ...(!historical ? [{ key: "is_current", match: { value: true } }] : []),
    { has_id: allowedIds },
    { key: "embedding_model", match: { value: text(embeddingModel, 255) } },
    { key: "allowed_scope", match: { any: [PUBLIC_SCOPE, ...unique(allowedPermissions, 20)] } }
  ];
  const kinds = unique(sourceKinds, 20);
  const ids = unique(sourceIds, 100);
  if (kinds.length) must.push({ key: "source_kind", match: { any: kinds } });
  if (ids.length) must.push({ key: "source_id", match: { any: ids } });
  if (appTypeId) must.push({ key: "app_type_id", match: { any: [text(appTypeId, 255), "__all__"] } });
  const response = await request(`/collections/${encodeURIComponent(name)}/points/query`, {
    method: "POST",
    body: {
      query: vector,
      filter: { must },
      limit: Math.max(1, Math.min(1_000, Number(limit) || 250)),
      with_payload: ["chunk_id", "document_id", "source_id"],
      with_vector: false
    },
    signal
  });
  const points = asArray(response.payload?.result?.points || response.payload?.result);
  return {
    configured: true,
    provider: "qdrant",
    collection: name,
    hits: points.map((point) => ({
      chunk_id: text(point?.payload?.chunk_id || point?.id, 255),
      document_id: text(point?.payload?.document_id, 255),
      source_id: text(point?.payload?.source_id, 255),
      score: Number(point?.score || 0)
    })).filter((point) => point.chunk_id)
  };
};

const deleteSource = async ({ projectId, sourceId, dimensions, signal } = {}) => {
  if (!isConfigured()) return { configured: false, deleted: false };
  const names = dimensions ? [collectionName(dimensions)] : [...ensuredCollections.keys()];
  const settled = await Promise.allSettled(names.map((name) => deleteByFilter(name, {
    must: [
      { key: "project_id", match: { value: text(projectId, 255) } },
      { key: "source_id", match: { value: text(sourceId, 255) } }
    ]
  }, { signal })));
  return { configured: true, deleted: settled.some((item) => item.status === "fulfilled") };
};

const getStatus = () => ({
  configured: isConfigured(),
  provider: isConfigured() ? "qdrant" : "postgresql",
  circuit_open: consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD && Date.now() - circuitOpenedAt < CIRCUIT_COOLDOWN_MS,
  collection_strategy: "embedding-dimension-versioned",
  acl_prefilter: true,
  canonical_store: "postgresql"
});

// Discover persisted collections instead of relying on a process-local cache:
// deletion must cover vectors written before an API restart or by another replica.
const deleteProject = async ({ projectId, signal } = {}) => {
  if (!isConfigured()) throw new Error("Qdrant project cleanup is not configured");
  const id = text(projectId, 255);
  if (!id) throw new Error("Project id is required for vector cleanup");
  const { payload } = await request("/collections", { signal });
  const prefix = `${settings().collectionPrefix}_d`;
  const collections = asArray(payload?.result?.collections).map(row => row.name)
    .filter(name => typeof name === "string" && name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)));
  for (const name of collections) {
    await request(`/collections/${encodeURIComponent(name)}/points/delete?wait=true`, {
      method: "POST", signal, allow: [404],
      body: { filter: { must: [{ key: "project_id", match: { value: id } }] } }
    });
  }
  return { deleted: true, collections: collections.length };
};

module.exports = {
  PUBLIC_SCOPE,
  deleteSource,
  deleteProject,
  getStatus,
  isConfigured,
  replaceDocument,
  search,
  _internals: { collectionName, ensureCollection, settings }
};
