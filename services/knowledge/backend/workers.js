"use strict";
const { performance } = require("node:perf_hooks");

// Knowledge work is split into a fast transactional-outbox lane and slower
// recovery/projection lanes. Concurrency is configurable and event-indexing
// claims rotate fairly between projects in PostgreSQL.
const configuredInt=(name,fallback,min,max)=>{
  const value=Number.parseInt(process.env[name]||"",10);
  return Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
};
const execution = require("./services/knowledgeExecution.service");

module.exports = () => {
  const rag = require("./services/knowledgeRag.service");
  const shutdown = new AbortController();
  const runBatch = async (event, task) => {
    const started = performance.now();
    try {
      const result=await task();
      execution.recordWorkerBatch(event,{result,elapsed_ms:performance.now()-started});
      if(result?.processed||result?.queued||result?.upgraded||result?.archived||result?.pending||result?.failed||result?.months_ensured||result?.deleted){
        console.info(JSON.stringify({event,...result,at:new Date().toISOString()}));
      }
      return result;
    } catch(error) {
      execution.recordWorkerBatch(event,{elapsed_ms:performance.now()-started,error});
      throw error;
    }
  };
  return {
    tasks: [
      {
        intervalMs: configuredInt("KNOWLEDGE_NATIVE_OUTBOX_INTERVAL_MS",2_000,500,60_000),
        label: "Unable to process native Knowledge change events",
        run: () => runBatch("knowledge_native_outbox_batch",() => rag.processNativeChangeOutbox({
          limit:configuredInt("KNOWLEDGE_NATIVE_OUTBOX_BATCH_SIZE",2,1,12),leaseMinutes:20
        })),
        runImmediately: false
      },
      {
        intervalMs: configuredInt("KNOWLEDGE_INGESTION_INTERVAL_MS",10_000,1_000,300_000),
        label: "Unable to process queued Knowledge Repo ingestion jobs",
        run: () => runBatch("knowledge_user_ingestion_batch",async () => {
          const queued=await rag.processQueuedIngestions({limit:configuredInt("KNOWLEDGE_INGESTION_CONCURRENCY",2,1,10),staleAfterMinutes:60});
          const legacy=await rag.processLegacyKnowledgeSyncOutbox({limit:configuredInt("KNOWLEDGE_LEGACY_SYNC_CONCURRENCY",2,1,10),leaseMinutes:10});
          return {processed:queued.length,legacy_processed:legacy.length};
        }),
        runImmediately: false
      },
      {
        // Provider work is deliberately lower priority than canonical ingestion.
        intervalMs: configuredInt("KNOWLEDGE_SEMANTIC_WORK_INTERVAL_MS",15_000,2_000,300_000),
        label: "Unable to process low-priority Knowledge enrichment and embeddings",
        run: () => runBatch("knowledge_semantic_work_batch",() => rag.processSemanticWork({
          limit:configuredInt("KNOWLEDGE_SEMANTIC_WORK_BATCH_SIZE",1,1,4),signal:shutdown.signal
        })),
        runImmediately: false
      },
      {
        intervalMs: configuredInt("KNOWLEDGE_EMBEDDING_BACKFILL_INTERVAL_MS",10*60*1000,60_000,24*60*60*1000),
        label: "Unable to discover stale Knowledge embedding configurations",
        run: () => runBatch("knowledge_embedding_backfill_scan",() => rag.enqueueStaleEmbeddingBackfill({
          limit:configuredInt("KNOWLEDGE_EMBEDDING_BACKFILL_SCAN_LIMIT",500,10,2_000)
        })),
        runImmediately: false
      },
      {
        // This is a recovery sweep. Normal inserts, updates and deletes arrive
        // through the native transactional outbox above.
        intervalMs: configuredInt("KNOWLEDGE_SOURCE_RECONCILIATION_INTERVAL_MS",24*60*60*1000,60_000,7*24*60*60*1000),
        label: "Unable to reconcile deleted Knowledge source records",
        run: () => runBatch("knowledge_source_reconciliation",() => require("./services/knowledgeSourceLifecycle.service").archiveMissingApplicationSources({limit:100})),
        runImmediately: false
      },
      {
        intervalMs: configuredInt("KNOWLEDGE_INDEX_GAP_RECONCILIATION_INTERVAL_MS",24*60*60*1000,60_000,7*24*60*60*1000),
        label: "Unable to queue missing native Knowledge indexes",
        run: () => runBatch("knowledge_index_gap_reconciliation",() => rag.reconcileNativeIndexGaps({limit:20_000})),
        runImmediately: false
      },
      {
        intervalMs: configuredInt("KNOWLEDGE_GRAPH_PROJECTION_INTERVAL_MS",15_000,1_000,300_000),
        label: "Unable to reconcile Knowledge graph evidence",
        run: () => runBatch("knowledge_graph_projection_batch",() => require("./services/knowledgeGraph.service").processBackfill({limit:configuredInt("KNOWLEDGE_GRAPH_PROJECTION_BATCH_SIZE",4,1,20)})),
        runImmediately: false
      },
      {
        intervalMs: configuredInt("KNOWLEDGE_VECTOR_PROJECTION_INTERVAL_MS",15_000,1_000,300_000),
        label: "Unable to reconcile Knowledge vector projections",
        run: () => runBatch("knowledge_vector_projection_batch",() => require("./services/knowledgeVectorProjection.service").processDue({limit:configuredInt("KNOWLEDGE_VECTOR_PROJECTION_BATCH_SIZE",4,1,20),signal:shutdown.signal})),
        runImmediately: false
      },
      {
        // Upgrade batches are lock-friendly; a long idle interval avoids five
        // second polling once the migration has drained.
        intervalMs: configuredInt("KNOWLEDGE_LEXICAL_REINDEX_INTERVAL_MS",60_000,5_000,300_000),
        label: "Unable to upgrade Knowledge lexical indexes",
        run: () => runBatch("knowledge_lexical_reindex_batch",() => require("./services/knowledgeMaintenance.service").processLexicalReindex({signal:shutdown.signal})),
        runImmediately: false
      },
      {
        // Typed indexes are built concurrently and only for dimensions with a
        // meaningful provider-backed corpus; small corpora stay exact and cheap.
        intervalMs: configuredInt("KNOWLEDGE_PGVECTOR_INDEX_INTERVAL_MS",60*60*1000,60_000,24*60*60*1000),
        label: "Unable to maintain typed Knowledge pgvector indexes",
        run: () => runBatch("knowledge_pgvector_index_maintenance",() => require("./services/knowledgeVectorIndex.service").processPgvectorIndexMaintenance({
          limit:configuredInt("KNOWLEDGE_PGVECTOR_INDEX_DIMENSIONS_PER_TICK",2,1,8),
          minRows:configuredInt("KNOWLEDGE_PGVECTOR_INDEX_MIN_ROWS",100,1,1_000_000),signal:shutdown.signal
        })),
        runImmediately: false
      },
      {
        intervalMs: 60 * 60 * 1000,
        label: "Unable to expire retained Knowledge context traces",
        run: () => runBatch("knowledge_context_trace_purge",() => require("./services/knowledgeContextGraph.service").purgeExpired({limit:1000})),
        runImmediately: false
      },
      {
        intervalMs: configuredInt("KNOWLEDGE_TRACE_PARTITION_INTERVAL_MS",24*60*60*1000,60_000,7*24*60*60*1000),
        label: "Unable to maintain monthly Knowledge context trace partitions",
        run: () => require("./services/knowledgeContextGraph.service").maintainPartitions({monthsAhead:24}),
        runImmediately: false
      }
    ],
    close: async () => { shutdown.abort(new Error("Knowledge workers are stopping")); }
  };
};
