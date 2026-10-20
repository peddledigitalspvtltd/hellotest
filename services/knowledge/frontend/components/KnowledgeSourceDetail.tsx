import { formatRecordKindLabel } from "@hellotest/testing/frontend/lib/defectTerminology";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconArchive, IconExternalLink, IconRefresh, IconDownload, IconSearch } from "@tabler/icons-react";
import { knowledgeApi } from "../api.client";
import { knowledgeCitationHref } from "@hellotest/chatbot/frontend/lib/knowledgeAnswer";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { KnowledgeFormattedText } from "@hellotest/chatbot/frontend/components/KnowledgeFormattedText";
import "./KnowledgeSourceDetail.css";

const label = (value?: string | null) => String(value || "Unknown").replace(/_/g, " ");
const date = (value?: string | null) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString() : "Not recorded";

export function KnowledgeSourceDetail({ sourceId, projectId, canManage, initialRevisionId = "", onClose, onChanged }: { sourceId: string; projectId: string; canManage: boolean; initialRevisionId?: string; onClose: () => void; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [revisionId, setRevisionId] = useState(initialRevisionId);
  const [archiveArmed, setArchiveArmed] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [passageSearch, setPassageSearch] = useState("");
  const [passageLimit, setPassageLimit] = useState(25);
  const detailQuery = useQuery({ queryKey: ["knowledge-source-detail", projectId, sourceId, revisionId], queryFn: () => knowledgeApi.knowledgeRepo.sourceDetail(sourceId, revisionId ? { revision_id: revisionId } : undefined), enabled: Boolean(projectId && sourceId), staleTime: 15_000 });
  const revisionsQuery = useQuery({ queryKey: ["knowledge-source-revisions", projectId, sourceId], queryFn: () => knowledgeApi.knowledgeRepo.sourceRevisions(sourceId), enabled: canManage });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["knowledge-source-detail", projectId, sourceId] });
    void queryClient.invalidateQueries({ queryKey: ["knowledge-source-revisions", projectId, sourceId] });
    onChanged();
  };
  const archiveMutation = useMutation({ mutationFn: () => knowledgeApi.knowledgeRepo.deleteSource(sourceId), onSuccess: () => { setArchiveArmed(false); setNotice("Source archived. Retained revisions remain available to authorized reviewers."); refresh(); }, onError: (cause) => setError(cause instanceof Error ? cause.message : "Source could not be archived.") });
  const retryMutation = useMutation({ mutationFn: (id: string) => knowledgeApi.knowledgeRepo.ingestions.retry(id), onSuccess: () => { setNotice("Processing retry submitted. Follow its progress in Activity."); refresh(); }, onError: (cause) => setError(cause instanceof Error ? cause.message : "Processing could not be retried.") });
  const contextRefreshMutation = useMutation({ mutationFn: () => knowledgeApi.knowledgeRepo.refresh.run(projectId),
    onSuccess: () => { setNotice("Project context refresh requested. Track indexing in Activity, then reload this source to view the current revision."); void queryClient.invalidateQueries({ queryKey: ["knowledge-refresh", projectId] }); refresh(); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Context refresh could not be requested.") });
  const downloadMutation = useMutation({ mutationFn: () => knowledgeApi.knowledgeRepo.downloadSource(sourceId), onSuccess: (blob) => { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = detailQuery.data?.source.file_name || "knowledge-source"; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1_000); }, onError: (cause) => setError(cause instanceof Error ? cause.message : "Original file is unavailable.") });
  const isMutating = archiveMutation.isPending || retryMutation.isPending || contextRefreshMutation.isPending;
  const dialogRef = useDialogFocus<HTMLDivElement>({ active: true, closeDisabled: isMutating, onClose });
  const detail = detailQuery.data;
  const source = detail?.source;
  const revision = detail?.revision;
  const sourceExtra = source as typeof source & { latest_ingestion_id?: string; latest_ingestion_status?: string };
  const ingestionId = detail?.latest_ingestion_id || sourceExtra?.latest_ingestion_id;
  const ingestionStatus = detail?.latest_ingestion_status || sourceExtra?.latest_ingestion_status;
  const canRetry = canManage && source?.extraction_status !== "archived" && ingestionId && ["failed", "completed_with_warnings", "partial"].includes(String(ingestionStatus));
  const fragments = detail?.fragments || [];
  const filteredFragments = passageSearch.trim() ? fragments.filter((fragment) => [fragment.heading, fragment.content].filter(Boolean).join(" ").toLowerCase().includes(passageSearch.trim().toLowerCase())) : fragments;
  const sourceHref = source ? knowledgeCitationHref({ id: source.id, uri: source.source_uri }) : "";
  return createPortal(<div className="modal-backdrop knowledge-source-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isMutating) onClose(); }}>
    <div aria-labelledby="knowledge-source-detail-title" aria-modal="true" className="modal-card knowledge-source-detail" ref={dialogRef} role="dialog" tabIndex={-1}>
      <header className="knowledge-source-detail-header"><div><span className="eyebrow">Source evidence</span><h2 id="knowledge-source-detail-title">{source?.title || "Source details"}</h2></div><DialogCloseButton disabled={isMutating} label="Close source evidence" onClick={onClose} /></header>
      <div className="knowledge-source-detail-body">
      {detailQuery.isPending ? <LoadingState label="Loading source and index state" /> : null}
      {detailQuery.isError ? <div role="alert"><p>{detailQuery.error instanceof Error ? detailQuery.error.message : "Source could not be loaded."}</p><button className="ghost-button" onClick={() => void detailQuery.refetch()} type="button">Retry source details</button></div> : null}
      {source && detail ? <>
        <div className="knowledge-source-detail-toolbar">
          <span className={`badge ${source.extraction_status === "archived" ? "badge-neutral" : detail.context_unavailable_reason ? "badge-warning" : revision?.index_state?.required_indexes_ready ? "badge-success" : "badge-warning"}`}>{source.extraction_status === "archived" ? "Archived" : detail.context_unavailable_reason ? "Refresh required" : revision?.index_state?.required_indexes_ready ? detail.historical ? "Historical evidence" : "Searchable" : label(source.extraction_status)}</span>
          {sourceHref ? <a className="ghost-button compact" href={sourceHref} rel="noreferrer" target={sourceHref.startsWith("/") ? undefined : "_blank"}><IconExternalLink size={14} />Open original</a> : null}
          {source.source_kind === "file" && source.extraction_status !== "archived" && !detail.authorization?.partial && !detail.historical ? <button className="ghost-button compact" disabled={downloadMutation.isPending} onClick={() => downloadMutation.mutate()} type="button"><IconDownload size={14} />Download original</button> : null}
          {canRetry ? <button className="ghost-button compact" disabled={isMutating} onClick={() => { setError(""); retryMutation.mutate(ingestionId); }} type="button"><IconRefresh size={14} />{retryMutation.isPending ? "Retrying…" : "Retry processing"}</button> : null}
        </div>
        {detail.context_unavailable_reason ? <div className="knowledge-source-detail-limit knowledge-source-context-refresh" role="status"><p>{detail.context_unavailable_reason}</p>
          {detail.historical ? <p>Retained revisions remain unchanged. Select the current revision after refreshing.</p> : null}
          {canManage && source.extraction_status !== "archived" ? <div><button className="ghost-button compact" disabled={isMutating || contextRefreshMutation.isSuccess} onClick={() => { setError(""); contextRefreshMutation.mutate(); }} type="button"><IconRefresh size={14} />{contextRefreshMutation.isPending ? "Requesting refresh…" : contextRefreshMutation.isSuccess ? "Refresh requested" : "Refresh project context"}</button><button className="ghost-button compact" disabled={detailQuery.isFetching} onClick={() => { setRevisionId(""); void queryClient.invalidateQueries({ queryKey: ["knowledge-source-detail", projectId, sourceId] }); }} type="button">Reload current revision</button></div> : <p>Ask a project knowledge manager to refresh this source.</p>}
        </div> : detail.authorization?.partial ? <p className="knowledge-source-detail-limit" role="status">Some passages are outside your access scope. Only permitted evidence is shown.</p> : null}
        {detail.historical ? <p className="knowledge-source-detail-limit">You are reviewing a historical revision. Current retrieval uses the active searchable revision.</p> : null}
        {canManage ? <label className="form-field"><span>Revision</span><select disabled={revisionsQuery.isPending || detailQuery.isFetching} onChange={(event) => { setRevisionId(event.target.value); setPassageSearch(""); setPassageLimit(25); }} value={revisionId}><option value="">Current searchable revision</option>{(revisionsQuery.data?.revisions || []).map((item) => <option key={item.id} value={item.id}>{item.version ? `Revision ${item.version}` : item.id.slice(0, 8)} · {item.is_current ? "Current" : "Retained"} · {date(item.effective_from)}</option>)}</select></label> : null}
        {revisionsQuery.isError ? <button className="ghost-button compact" onClick={() => void revisionsQuery.refetch()} type="button">Retry revision history</button> : null}
        <details className="knowledge-source-metadata"><summary>Source details</summary><dl className="knowledge-source-facts"><div><dt>Source type</dt><dd>{formatRecordKindLabel(source.source_kind)}</dd></div><div><dt>Effective from</dt><dd>{date(revision?.effective_from)}</dd></div><div><dt>Effective until</dt><dd>{revision?.effective_to ? date(revision.effective_to) : revision?.is_current ? "Current" : "Not recorded"}</dd></div><div><dt>Source updated</dt><dd>{date(source.updated_at)}</dd></div></dl></details>
        <section className="knowledge-source-index"><h3>Index readiness</h3><div><span>Text search <strong>{label(revision?.index_state?.lexical_state)}</strong></span><span>Semantic search <strong>{label(revision?.index_state?.dense_state)}</strong></span><span>Indexed passages <strong>{revision?.index_state?.indexed_chunk_count ?? source.chunk_count ?? 0}</strong></span></div>{revision?.index_state?.required_indexes_ready === false ? <p>This revision is still staging. It will become searchable when required indexes are ready.</p> : null}</section>
        <section className="knowledge-source-passages"><div className="knowledge-passages-heading"><h3>Evidence passages</h3><span>{filteredFragments.length} of {fragments.length}</span></div>
          {fragments.length > 3 ? <label className="knowledge-passages-search"><IconSearch size={16} /><input aria-label="Search source passages" onChange={(event) => { setPassageSearch(event.target.value); setPassageLimit(25); }} placeholder="Find text in this source" type="search" value={passageSearch} /></label> : null}
          {filteredFragments.slice(0, passageLimit).map((fragment, index) => <details key={`${revision?.id || "current"}:${fragment.id}`} open={index === 0}><summary>{fragment.heading || `Passage ${(fragment.chunk_index ?? index) + 1}`}{fragment.metadata?.page ? <small>Page {String(fragment.metadata.page)}</small> : fragment.token_count ? <small>{fragment.token_count} tokens</small> : null}</summary><KnowledgeFormattedText text={fragment.content || "No extracted text is available for this passage."} /></details>)}
          {filteredFragments.length > passageLimit ? <button className="ghost-button" onClick={() => setPassageLimit((value) => value + 25)} type="button">Show more passages</button> : null}
          {!filteredFragments.length ? <p>{passageSearch ? "No passages match your search." : "No permitted extracted text is available for this revision."}</p> : null}
        </section>
        <details className="knowledge-source-provenance"><summary>Revision identity and provenance</summary><dl><dt>Source identity</dt><dd>{source.canonical_id || source.id}</dd><dt>Revision identity</dt><dd>{revision?.knowledge_id || revision?.id || "Not available"}</dd><dt>Content checksum</dt><dd>{revision?.checksum_sha256 || "Not available"}</dd></dl></details>
        {canManage && source.extraction_status !== "archived" ? <footer><p>{archiveArmed ? "Archive this source? Its revision history will be retained." : "Archive to remove this source from current AI retrieval."}</p><button className="ghost-button" disabled={isMutating} onClick={() => { setError(""); if (archiveArmed) archiveMutation.mutate(); else setArchiveArmed(true); }} type="button"><IconArchive size={15} />{archiveArmed ? "Confirm archive" : "Archive source"}</button>{archiveArmed ? <button className="ghost-button" disabled={isMutating} onClick={() => setArchiveArmed(false)} type="button">Cancel</button> : null}</footer> : null}
      </> : null}
      {notice ? <p role="status">{notice}</p> : null}{error ? <p className="error-message" role="alert">{error}</p> : null}
      </div>
    </div>
  </div>, document.body);
}
