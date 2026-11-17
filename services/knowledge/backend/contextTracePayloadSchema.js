'use strict';

// The trace directory stays unpartitioned because events and idempotency
// receipts reference it. Larger evidence/coverage/selection payloads live in
// monthly partitions, so retention and health queries can prune by time.
module.exports = [
  `CREATE TABLE IF NOT EXISTS ai_context_graph_trace_payloads (
    trace_id TEXT NOT NULL REFERENCES ai_context_graph_traces(id) ON DELETE CASCADE,
    recorded_at TIMESTAMPTZ NOT NULL,
    query_hash TEXT,
    evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_refs) = 'array' AND jsonb_array_length(evidence_refs) <= 30),
    coverage JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(coverage) = 'object'),
    selection JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(selection) = 'object'),
    PRIMARY KEY (trace_id, recorded_at),
    CHECK (octet_length(evidence_refs::text) <= 49152)
  ) PARTITION BY RANGE (recorded_at)`,
  `CREATE OR REPLACE FUNCTION maintain_ai_context_graph_trace_partitions(months_ahead INTEGER DEFAULT 24)
    RETURNS INTEGER LANGUAGE plpgsql AS $partition$
    DECLARE first_month DATE; last_month DATE; month_start DATE; ensured INTEGER := 0; part_name TEXT;
    BEGIN
      SELECT date_trunc('month', MIN(recorded_at))::date INTO first_month FROM ai_context_graph_traces;
      first_month := LEAST(COALESCE(first_month, date_trunc('month', CURRENT_DATE)::date), date_trunc('month', CURRENT_DATE)::date);
      first_month := (first_month - INTERVAL '1 month')::date;
      last_month := (date_trunc('month', CURRENT_DATE)::date + make_interval(months => LEAST(GREATEST(months_ahead, 1), 60)))::date;
      month_start := first_month;
      WHILE month_start <= last_month LOOP
        part_name := 'ai_context_graph_trace_payloads_' || to_char(month_start, 'YYYYMM');
        EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF ai_context_graph_trace_payloads FOR VALUES FROM (%L) TO (%L)',
          part_name, month_start, (month_start + INTERVAL '1 month')::date);
        ensured := ensured + 1;
        month_start := (month_start + INTERVAL '1 month')::date;
      END LOOP;
      RETURN ensured;
    END
  $partition$`,
  `SELECT maintain_ai_context_graph_trace_partitions(24)`,
  `INSERT INTO ai_context_graph_trace_payloads (trace_id,recorded_at,query_hash,evidence_refs,coverage,selection)
    SELECT id,recorded_at,query_hash,evidence_refs,coverage,selection FROM ai_context_graph_traces
    ON CONFLICT (trace_id,recorded_at) DO NOTHING`,
  `UPDATE ai_context_graph_traces SET query_hash=NULL,evidence_refs='[]'::jsonb,coverage='{}'::jsonb,selection='{}'::jsonb
    WHERE query_hash IS NOT NULL OR evidence_refs <> '[]'::jsonb OR coverage <> '{}'::jsonb OR selection <> '{}'::jsonb`,
  `CREATE INDEX IF NOT EXISTS idx_ai_context_graph_trace_payloads_time ON ai_context_graph_trace_payloads (recorded_at DESC, trace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_context_graph_trace_payloads_query_class ON ai_context_graph_trace_payloads ((selection->>'query_category'), recorded_at DESC)`
];
