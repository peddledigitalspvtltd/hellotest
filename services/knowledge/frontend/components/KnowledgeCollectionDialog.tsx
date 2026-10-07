import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { IconFolders, IconSearch } from "@tabler/icons-react";
import { knowledgeApi } from "../api.client";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import type { KnowledgeSource } from "@hellotest/platform/frontend/src/types";

type Props = { projectId: string; appTypeId: string; collectionId: string; sources: KnowledgeSource[]; onClose: () => void; onSaved: () => void };

/** Membership changes are staged with metadata until Save; hidden source grants are retained. */
export function KnowledgeCollectionDialog({ projectId, appTypeId, collectionId, sources, onClose, onSaved }: Props) {
  const isNew = collectionId === "new";
  const query = useQuery({ queryKey: ["knowledge-collection-detail", projectId, collectionId], queryFn: () => knowledgeApi.knowledgeRepo.collections.get(collectionId), enabled: !isNew });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#0d9488");
  const [active, setActive] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const availableSources = useMemo(() => sources.filter((source) => source.extraction_status !== "archived"), [sources]);
  const initialMembers = useMemo(() => [...new Set([...(query.data?.source_ids || []), ...sources.filter((source) => source.collection_ids?.includes(collectionId)).map((source) => source.id)])], [query.data, sources, collectionId]);
  useEffect(() => {
    if (!query.data) return;
    setName(query.data.name);
    setDescription(query.data.description || "");
    setColor(query.data.color || "#0d9488");
    setActive(query.data.is_active !== false);
    setSelected(initialMembers);
  }, [query.data]);
  const visible = availableSources.filter((source) => !search.trim() || [source.title, source.file_name, source.source_kind].filter(Boolean).join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  const save = useMutation({
    mutationFn: async () => {
      setError("");
      if (!name.trim()) throw new Error("Give your collection a name.");
      // Remember a successfully created collection if membership persistence fails, preventing duplicates on retry.
      const targetId = savedId || (isNew ? (await knowledgeApi.knowledgeRepo.collections.create({ project_id: projectId, app_type_id: appTypeId || null, name: name.trim(), description: description.trim(), color })).id : collectionId);
      if (isNew) setSavedId(targetId);
      if (!isNew || savedId) await knowledgeApi.knowledgeRepo.collections.update(targetId, { name: name.trim(), description: description.trim(), color, is_active: active });
      const baseline = isNew ? [] : initialMembers;
      const additions = selected.filter((id) => !baseline.includes(id));
      // A source outside the visible authorization scope cannot be removed indirectly.
      const allowed = new Set(availableSources.map((source) => source.id));
      const removals = baseline.filter((id) => allowed.has(id) && !selected.includes(id));
      if (additions.length) await knowledgeApi.knowledgeRepo.collections.addSources(targetId, additions);
      if (removals.length) await knowledgeApi.knowledgeRepo.collections.removeSources(targetId, removals);
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (cause) => { onSaved(); setError(cause instanceof Error ? cause.message : "Changes could not be saved. Try again."); }
  });
  const close = () => { if (!save.isPending) onClose(); };
  const focus = useDialogFocus<HTMLDivElement>({ active: true, closeDisabled: save.isPending, onClose: close });
  const submit = (event: FormEvent) => { event.preventDefault(); if (!save.isPending) save.mutate(); };
  return createPortal(<div className="modal-backdrop knowledge-collection-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="modal-card knowledge-collection-dialog" aria-labelledby="knowledge-collection-dialog-title" aria-modal="true" ref={focus} role="dialog" tabIndex={-1}>
      <header><div><span className="dialog-context-label"><IconFolders size={15} />Collection</span><h2 id="knowledge-collection-dialog-title">{isNew ? "New collection" : "Manage collection"}</h2></div><DialogCloseButton disabled={save.isPending} onClick={close} label="Close collection dialog" /></header>
      <form onSubmit={submit}>
        <div className="knowledge-collection-dialog-body">
          {!isNew && query.isPending ? <LoadingState label="Loading collection" /> : query.isError ? <div className="knowledge-inline-error" role="alert">Collection could not be loaded.<button className="ghost-button compact" onClick={() => void query.refetch()} type="button">Retry</button></div> : <>
            <div className="knowledge-collection-fields"><label><span>Name</span><input data-autofocus="true" maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="e.g. Checkout release" required value={name} /></label><label className="knowledge-collection-color"><span>Color</span><input aria-label="Collection color" onChange={(event) => setColor(event.target.value)} type="color" value={color} /></label></div>
            <label><span>Description <small>optional</small></span><textarea rows={2} onChange={(event) => setDescription(event.target.value)} placeholder="When should the assistant use this context?" value={description} /></label>
            {!isNew ? <label className="knowledge-collection-enabled"><input checked={active} onChange={(event) => setActive(event.target.checked)} type="checkbox" />Available for retrieval</label> : null}
            <div className="knowledge-membership-heading"><h3>Sources</h3><span>{selected.filter((id) => availableSources.some((source) => source.id === id)).length} selected</span></div>
            <label className="knowledge-record-search"><IconSearch size={16} /><input aria-label="Search collection sources" onChange={(event) => setSearch(event.target.value)} placeholder="Search available sources" type="search" value={search} /></label>
            <div className="knowledge-membership-list">{visible.map((source) => <label key={source.id}><input checked={selected.includes(source.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, source.id])] : current.filter((id) => id !== source.id))} type="checkbox" /><span><strong>{source.title}</strong><small>{source.source_kind.replace(/_/g, " ")} · {source.extraction_status === "ready" && Number(source.chunk_count || 0) > 0 ? "Searchable" : source.extraction_status.replace(/_/g, " ")}</small></span></label>)}{!visible.length ? <p>{search ? "No sources match your search." : "Add project sources first, then organize them here."}</p> : null}</div>
          </>}
          {error ? <p className="knowledge-inline-error" role="alert">{error}</p> : null}
        </div>
        <footer><button className="ghost-button" disabled={save.isPending} onClick={close} type="button">Cancel</button><button className="primary-button" disabled={save.isPending || !name.trim() || (!isNew && (query.isPending || query.isError))} type="submit">{save.isPending ? "Saving…" : isNew && !savedId ? "Create collection" : "Save changes"}</button></footer>
      </form>
    </div>
  </div>, document.body);
}
