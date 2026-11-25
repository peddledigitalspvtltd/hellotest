import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import type { ExecutionResultAttachment, JiraAttachment } from "@hellotest/platform/frontend/src/types";
import type { ExecutionDefectAttachment, ExecutionDefectReport } from "../../lib/executionDefectReport";
import { uploadAttachmentBatch } from "../../lib/attachmentUploadBatch";
import { parseExecutionLogs } from "../../lib/executionLogs";

export type DefectSourceAttachment = { id: string; name: string; kind?: "ai" } | ExecutionDefectAttachment;

async function loadExecutionSources(projectId: string, report: ExecutionDefectReport) {
  const { runId, resultId, attachmentResultId, caseId, attachmentCopies, inlineAttachments, includeRunAttachments } = report;
  const [caseFiles, runFiles, legacyResult] = await Promise.allSettled([
    attachmentResultId ? api.executionResultAttachments.list(attachmentResultId) : [],
    includeRunAttachments ? api.attachments.list({ project_id: projectId, entity_type: "execution", entity_id: runId }) : [],
    resultId && inlineAttachments.length ? api.executionResults.get(resultId) : null
  ]);
  const detailById = new Map(attachmentCopies.map(source => [source.id, source.detail]));
  const sources: ExecutionDefectAttachment[] = [
    ...asArray<ExecutionResultAttachment>(caseFiles.status === "fulfilled" ? caseFiles.value : []).map(file => ({
      id: file.id, name: file.filename, kind: "execution" as const,
      detail: detailById.get(file.id) || (resultId ? (file.step_id ? "Test step" : "Test case result") : "Linked automation result")
    })),
    ...asArray<JiraAttachment>(runFiles.status === "fulfilled" ? runFiles.value : []).map(file => ({ id: file.id, name: file.filename, kind: "execution" as const, detail: "Test run" }))
  ];
  const inlineResult = legacyResult.status === "fulfilled" ? legacyResult.value : null;
  let partial = [caseFiles, runFiles, legacyResult].some(entry => entry.status === "rejected");
  if (inlineResult && inlineResult.id === resultId && inlineResult.execution_id === runId && inlineResult.test_case_id === caseId) {
    const evidence = parseExecutionLogs(inlineResult.logs).stepEvidence || {};
    const legacyFiles = await Promise.allSettled(inlineAttachments.map(async source => {
      const dataUrl = evidence[source.id]?.dataUrl;
      if (!dataUrl) return null;
      const blob = await fetch(dataUrl).then(response => response.blob());
      return { ...source, file: new File([blob], source.name, { type: blob.type }) };
    }));
    for (const file of legacyFiles) {
      if (file.status === "fulfilled" && file.value) sources.push(file.value);
      else partial = true;
    }
  } else if (inlineAttachments.length) {
    partial = true;
  }
  return { sources, partial };
}

export function useDefectSourceAttachments({ projectId, active, canCarryRunAttachments }: {
  projectId: string;
  active: boolean;
  canCarryRunAttachments: boolean;
}) {
  const queryClient = useQueryClient();
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const [runReport, setRunReport] = useState<ExecutionDefectReport | null>(null);
  const [retainedSources, setRetainedSources] = useState<DefectSourceAttachment[]>([]);
  const [excludedRunIds, setExcludedRunIds] = useState<string[]>([]);
  const report = canCarryRunAttachments && runReport?.projectId === projectId ? runReport : null;
  const canLoad = Boolean(report?.attachmentResultId || report?.includeRunAttachments);
  const query = useQuery({
    queryKey: ["defect-report-attachments", projectId, report?.runId, report?.resultId, report?.attachmentResultId, report?.includeRunAttachments],
    enabled: active && canLoad,
    queryFn: () => report ? loadExecutionSources(projectId, report) : { sources: [], partial: false }
  });
  const sources = [...new Map([
    ...retainedSources,
    ...[...(report?.attachmentCopies || []), ...(query.data?.sources || [])].filter(source => !excludedRunIds.includes(source.id))
  ].map(source => [source.id, source])).values()];

  const resetSources = useCallback((source?: ExecutionDefectReport | null) => {
    setRunReport(source || null);
    setRetainedSources([]);
    setExcludedRunIds([]);
  }, []);
  const removeSource = (id: string) => {
    setRetainedSources(current => current.filter(source => source.id !== id));
    setExcludedRunIds(current => [...current, id]);
  };
  const retainSources = async (issueId: string) => {
    const target = { project_id: projectId, entity_type: "issue" as const, entity_id: issueId };
    const { failed } = await uploadAttachmentBatch(sources, source => source.kind === "execution" && source.file
      ? api.attachments.upload(target, source.file) : api.attachments.copy(source.id, target));
    if (projectId === projectRef.current) {
      setRetainedSources(failed);
      setRunReport(null);
    }
    if (sources.length) await queryClient.invalidateQueries({ queryKey: ["hellotest-attachments", projectId, "issue"] });
    return failed;
  };

  return { runReport, setRunReport, sources, setRetainedSources, resetSources, removeSource, retainSources,
    loading: active && canLoad && query.isFetching, error: active && canLoad && (query.isError || query.data?.partial === true),
    retry: query.refetch };
}
