import { useCallback, useEffect, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { api, HelloTestApiError } from "../../lib/api";
import type { ProjectDeletionJob } from "../../types";

type TrackedDeletion = {
  projectId: string;
  projectName: string;
  job?: ProjectDeletionJob;
  submissionError?: string;
  submissionStatus?: number;
  requestedAt?: number;
  settledAt?: number;
};

const storageKey = (userId: string) => `hellotest.project-deletions.${userId}`;
const receiptChangeEvent = "hellotest:project-deletions-change";
const isActive = (job?: ProjectDeletionJob) => !job || ["queued", "running", "cleanup"].includes(job.status);
const statusCode = (error: unknown) => error instanceof HelloTestApiError ? error.status : undefined;
// Leave results visible long enough to read or dismiss manually. Active jobs
// never expire: hiding a receipt must not imply deletion has finished.
const receiptExpiresAt = (record: TrackedDeletion) => record.settledAt && !isActive(record.job)
  ? record.settledAt + (record.job?.status === "failed" ? 120_000 : 60_000)
  : undefined;

function readTrackedDeletions(userId: string): TrackedDeletion[] {
  if (!userId) return [];
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey(userId)) || "[]");
    if (!Array.isArray(stored)) return [];
    const records = stored.filter((entry): entry is TrackedDeletion => Boolean(entry
      && typeof entry.projectId === "string" && typeof entry.projectName === "string"
      && (!entry.job || (entry.job.project_id === entry.projectId
        && ["queued", "running", "cleanup", "failed"].includes(entry.job.status)))))
      .filter((record) => !receiptExpiresAt(record) || receiptExpiresAt(record)! > Date.now())
      .map((record) => !isActive(record.job) && !record.settledAt ? { ...record, settledAt: Date.now() } : record);
    try { localStorage.setItem(storageKey(userId), JSON.stringify(records)); } catch { /* Reading must work even when storage is full. */ }
    return records;
  } catch {
    return [];
  }
}

/** Keep deletion receipts outside page lifetime; the server owns execution. */
export function useProjectDeletions(userId: string, onCompleted: (projectId: string, projectName: string) => void) {
  const queryClient = useQueryClient();
  const [state, setState] = useState(() => ({ userId, records: readTrackedDeletions(userId) }));
  const records = state.userId === userId ? state.records : [];
  const recordsRef = useRef(records);
  const receiptSource = useRef(Symbol("project-deletion-observer"));
  recordsRef.current = records;
  const ownerRef = useRef(userId);
  ownerRef.current = userId;
  const completionRef = useRef(onCompleted);
  completionRef.current = onCompleted;
  const handledCompletions = useRef(new Set<string>());
  const submittingRef = useRef(new Set<string>());
  const [submitting, setSubmitting] = useState<string[]>([]);
  const keyFor = useCallback((projectId: string) => ["projects", "deletion", userId, projectId] as const, [userId]);

  useEffect(() => {
    if (state.userId !== userId) {
      setState({ userId, records: readTrackedDeletions(userId) });
      submittingRef.current.clear();
      setSubmitting([]);
    }
  }, [state.userId, userId]);

  useEffect(() => {
    const receiveReceipts = (event: Event) => {
      const detail = (event as CustomEvent<{ userId: string; source: symbol; records: TrackedDeletion[] }>).detail;
      if (detail?.userId !== userId || detail.source === receiptSource.current) return;
      recordsRef.current = detail.records;
      setState({ userId, records: detail.records });
    };
    window.addEventListener(receiptChangeEvent, receiveReceipts);
    return () => window.removeEventListener(receiptChangeEvent, receiveReceipts);
  }, [userId]);

  const updateRecords = useCallback((update: (current: TrackedDeletion[]) => TrackedDeletion[]) => {
    if (ownerRef.current !== userId) return;
    const next = update(recordsRef.current);
    recordsRef.current = next;
    // Persist before sending DELETE, so a lost response or page reload can be
    // reconciled using GET without automatically sending another deletion.
    try { localStorage.setItem(storageKey(userId), JSON.stringify(next.filter((record) => record.job?.status !== "completed"))); } catch { /* Storage may be unavailable. */ }
    // An earlier page instance may still be receiving the enqueue response.
    // Deliver it to the currently mounted progress/recovery surface as well.
    window.dispatchEvent(new CustomEvent(receiptChangeEvent, { detail: { userId, source: receiptSource.current, records: next } }));
    setState({ userId, records: next });
  }, [userId]);

  useEffect(() => {
    const expires = records.filter((record) => !submitting.includes(record.projectId))
      .map(receiptExpiresAt).filter((expiry): expiry is number => expiry !== undefined);
    if (!expires.length) return;
    const timer = window.setTimeout(() => {
      const now = Date.now();
      updateRecords((current) => current.filter((record) => {
        const expiry = receiptExpiresAt(record);
        return submittingRef.current.has(record.projectId) || !expiry || expiry > now;
      }));
    }, Math.max(0, Math.min(...expires) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [records, submitting, updateRecords]);

  const queries = useQueries({
    queries: records.map((record) => ({
      queryKey: keyFor(record.projectId),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.projects.deletion(record.projectId, { signal }),
      enabled: Boolean(userId) && !submitting.includes(record.projectId) && record.job?.status !== "completed",
      retry: false,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: true,
      refetchInterval: (query: { state: { data?: ProjectDeletionJob; error: unknown } }) => {
        // Authorization loss or a missing receipt needs explicit attention.
        // Transient polling failures keep retrying GET, never DELETE.
        const code = statusCode(query.state.error);
        if (code === 403) return false;
        if (code === 404 && (record.job || Date.now() - (record.requestedAt || 0) >= 30_000)) return false;
        return isActive(query.state.data || record.job) ? 2_000 : false;
      }
    }))
  });

  useEffect(() => {
    let changed = false;
    const next = records.map((record, index) => {
      const job = submitting.includes(record.projectId) ? undefined : queries[index]?.data;
      if (!job || JSON.stringify(record.job) === JSON.stringify(job)) return record;
      changed = true;
      const settledAt = isActive(job) ? undefined
        : record.job?.id === job.id && record.job.status === job.status && record.settledAt
          ? record.settledAt : Date.now();
      return { ...record, job, settledAt, submissionError: undefined };
    });
    if (changed) updateRecords(() => next);
    next.forEach((record) => {
      if (record.job?.status !== "completed") return;
      const completionKey = `${userId}:${record.job.id}`;
      if (handledCompletions.current.has(completionKey)) return;
      handledCompletions.current.add(completionKey);
      completionRef.current(record.projectId, record.projectName);
    });
  }, [queries, records, submitting, updateRecords, userId]);

  const submit = useCallback(async (projectId: string, projectName: string) => {
    const existing = recordsRef.current.find((record) => record.projectId === projectId);
    if (!userId || submittingRef.current.has(projectId) || (existing?.job && isActive(existing.job))) return;
    submittingRef.current.add(projectId);
    setSubmitting([...submittingRef.current]);
    updateRecords((current) => [...current.filter((record) => record.projectId !== projectId), { projectId, projectName, job: existing?.job, requestedAt: Date.now() }]);
    try {
      await queryClient.cancelQueries({ queryKey: keyFor(projectId) });
      if (ownerRef.current !== userId) return;
      const response = await api.projects.delete(projectId);
      if (ownerRef.current !== userId) return;
      if (!("job" in response) && !("deleted" in response && response.deleted === true)) {
        throw new Error("The server did not confirm the deletion request.");
      }
      const now = new Date().toISOString();
      const job: ProjectDeletionJob = "job" in response ? response.job : {
        id: `legacy:${projectId}:${now}`, project_id: projectId, project_name: projectName,
        status: "completed", phase: "completed", processed_rows: 0, attempts: 1,
        error: null, created_at: now, updated_at: now, completed_at: now
      };
      queryClient.setQueryData(keyFor(projectId), job);
      updateRecords((current) => current.map((record) => record.projectId === projectId
        ? { projectId, projectName, job, settledAt: isActive(job) ? undefined : Date.now() } : record));
    } catch (error) {
      if (ownerRef.current !== userId) return;
      updateRecords((current) => current.map((record) => record.projectId === projectId ? {
        ...record, submissionError: error instanceof Error ? error.message : "Unable to request project deletion.", submissionStatus: statusCode(error)
      } : record));
      // The server may have accepted the request before the connection failed.
      // Query status when the observer resumes below.
      void queryClient.invalidateQueries({ queryKey: keyFor(projectId) });
    } finally {
      if (ownerRef.current === userId) {
        submittingRef.current.delete(projectId);
        setSubmitting([...submittingRef.current]);
      }
    }
  }, [keyFor, queryClient, updateRecords, userId]);

  return {
    submit,
    submitting: submitting.length > 0,
    isBusy: (projectId: string) => submitting.includes(projectId) || records.some((record) => record.projectId === projectId && isActive(record.job)),
    items: records.map((record, index) => ({
      ...record,
      submitting: submitting.includes(record.projectId),
      pollingError: queries[index]?.error?.message,
      canRetry: (record.job?.status === "failed" && statusCode(queries[index]?.error) !== 403)
        || (!record.job && statusCode(queries[index]?.error) === 404),
      canDismiss: !submitting.includes(record.projectId) && (record.job?.status === "failed" || (!record.job && ((statusCode(queries[index]?.error) === 404 && Date.now() - (record.requestedAt || 0) >= 30_000)
        || ([403, 404].includes(record.submissionStatus || 0) && [403, 404].includes(statusCode(queries[index]?.error) || 0))))),
      refresh: () => void queries[index]?.refetch(),
      dismiss: () => updateRecords((current) => current.filter((entry) => entry.projectId !== record.projectId))
    }))
  };
}
