import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconRefresh,
  IconSettings,
  IconX,
  IconClock,
} from "@tabler/icons-react";
import { knowledgeApi } from "../api.client";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";

export function KnowledgeRefreshControl({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [period, setPeriod] = useState("300000");
  const query = useQuery({
    queryKey: ["knowledge-refresh", projectId],
    queryFn: () => knowledgeApi.knowledgeRepo.refresh.get(projectId),
    enabled: Boolean(projectId),
    staleTime: 10_000,
    refetchInterval: (query) => {
      const value = query.state.data;
      return value?.requested && !["failed", "blocked"].includes(value.status) || ["scanning", "queued", "waiting"].includes(value?.status || "") ? 3_000 : value?.enabled ? 30_000 : false;
    },
  });
  const changed = () => {
    void cache.invalidateQueries({
      queryKey: ["knowledge-refresh", projectId],
    });
    void cache.invalidateQueries({
      queryKey: ["knowledge-overview", projectId],
    });
  };
  const run = useMutation({
    mutationFn: () => knowledgeApi.knowledgeRepo.refresh.run(projectId),
    onSuccess: changed,
  });
  const configure = useMutation({
    mutationFn: () =>
      knowledgeApi.knowledgeRepo.refresh.configure(projectId, {
        enabled,
        interval_ms: Number(period),
      }),
    onSuccess: () => {
      changed();
      setOpen(false);
    },
  });
  const dialog = useDialogFocus<HTMLDivElement>({
    active: open && canManage,
    onClose: () => setOpen(false),
    closeDisabled: configure.isPending,
  });
  const state = query.data;
  const presets = [{ value: "60000", label: "Every minute" }, { value: "300000", label: "Every 5 minutes" }, { value: "900000", label: "Every 15 minutes" }, { value: "1800000", label: "Every 30 minutes" }, { value: "3600000", label: "Every hour" }];
  const periodLabel = presets.find((option) => option.value === String(state?.interval_ms))?.label || (state?.interval_ms ? state.interval_ms < 60_000 ? `Every ${Math.round(state.interval_ms / 1_000)} seconds` : state.interval_ms < 3_600_000 ? `Every ${Number((state.interval_ms / 60_000).toFixed(1))} minutes` : `Every ${Number((state.interval_ms / 3_600_000).toFixed(1))} hours` : "On demand");
  // Discover jobs created after the initial request so the existing processing
  // poller starts, and refresh source counts without polling the entire catalog.
  useEffect(() => {
    if (!state) return;
    void cache.invalidateQueries({ queryKey: ["knowledge-overview", projectId] });
    void cache.invalidateQueries({ queryKey: ["knowledge-sources", projectId] });
  }, [cache, projectId, state?.status, state?.last_completed_at, state?.last_result?.scanned, state?.last_result?.queued]);
  const busy =
    run.isPending ||
    (state?.requested && !["failed", "blocked"].includes(state.status)) ||
    ["scanning", "queued", "waiting"].includes(state?.status || "");
  const error = run.error || query.error;
  return (
    <div className="knowledge-refresh-control">
      <div className="knowledge-refresh-copy">
        <IconRefresh size={19} stroke={1.7} />
        <div>
          <strong>Keep project context current</strong>
          <span>
            Stories, test cases and defects · only new or changed records are
            indexed
          </span>
        </div>
      </div>
      <div className="knowledge-refresh-actions">
        <span className="knowledge-refresh-status" role="status">
          <IconClock size={14} />
          {busy
            ? state?.status === "waiting"
              ? "Waiting for indexing"
              : "Refreshing context…"
            : state?.enabled
              ? periodLabel
              : "On demand"}
        </span>
        {canManage ? (
          <>
            <button
              type="button"
              className="ghost-button compact"
              disabled={Boolean(busy) || query.isPending || query.isError}
              onClick={() => run.mutate()}
            >
              <IconRefresh size={16} />
              Refresh now
            </button>
            <button
              type="button"
              className="ghost-button compact knowledge-refresh-settings"
              aria-label="Configure automatic knowledge refresh"
              title="Automatic refresh settings"
              disabled={query.isPending || query.isError}
              onClick={() => {
                setEnabled(state?.enabled || false);
                setPeriod(String(state?.interval_ms || 300000));
                configure.reset();
                setOpen(true);
              }}
            >
              <IconSettings size={18} />
            </button>
          </>
        ) : null}
      </div>
      {state?.last_result?.scanned !== undefined ? (
        <details className="knowledge-refresh-details"><summary>Last refresh{state.last_completed_at ? ` · ${new Date(state.last_completed_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}</summary><small className="knowledge-refresh-result">
          Last scan: {state.last_result.scanned} checked ·{" "}
          {state.last_result.queued || 0} queued for indexing ·{" "}
          {state.last_result.unchanged || 0} unchanged
          {state.last_result.inaccessible
            ? ` · ${state.last_result.inaccessible} outside refresh owner's access`
            : ""}
        </small></details>
      ) : null}
      {error || state?.last_error ? (
        <p role="alert" className="knowledge-refresh-error">
          {error instanceof Error ? error.message : state?.last_error}
          <button
            className="ghost-button compact"
            onClick={() => void query.refetch()}
            type="button"
          >
            Retry status
          </button>
        </p>
      ) : null}
      {open && canManage ? createPortal(
        <div className="knowledge-refresh-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !configure.isPending) setOpen(false); }}>
          <div
            ref={dialog}
            className="knowledge-refresh-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="knowledge-refresh-title"
            tabIndex={-1}
          >
            <div className="knowledge-refresh-dialog-heading">
              <h3 id="knowledge-refresh-title">Automatic context refresh</h3>
              <button
                type="button"
                className="ghost-button compact"
                aria-label="Close refresh settings"
                disabled={configure.isPending}
                onClick={() => setOpen(false)}
              >
                <IconX size={18} />
              </button>
            </div>
            <p>
              Index new and changed project records using your current access.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                configure.mutate();
              }}
            >
              <label className="knowledge-refresh-enabled">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                Refresh automatically
              </label>
              <label>
                Frequency
                <select aria-label="Automatic refresh frequency" onChange={(event) => setPeriod(event.target.value)} value={presets.some((option) => option.value === period) ? period : "custom"}>{presets.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}<option value="custom" disabled>Custom interval</option></select>
              </label>
              <details><summary>Custom interval</summary><label>
                Interval in milliseconds
                <input
                  aria-label="Refresh interval in milliseconds"
                  type="number"
                  min={5000}
                  max={86400000}
                  step={1}
                  required
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                />
              </label></details>
              <small>
                New batches start after indexing completes.
                <span className="sr-only">5,000–86,400,000 ms. Small batches run without overlapping;
                indexing finishes before the next batch starts.</span>
              </small>
              {configure.error ? (
                <p role="alert">
                  {configure.error instanceof Error
                    ? configure.error.message
                    : "Could not save settings."}
                </p>
              ) : null}
              <button
                className="primary-button"
                disabled={configure.isPending}
                type="submit"
              >
                {configure.isPending ? "Saving…" : "Save settings"}
              </button>
            </form>
          </div>
        </div>, document.body
      ) : null}
    </div>
  );
}
