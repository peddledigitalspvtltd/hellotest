import { useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { IconArrowRight, IconRoute } from "@tabler/icons-react";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { nodeKindDescriptions, type WorkflowNodeKind } from "./workflowGraph";
import { WORKFLOW_TEMPLATES, draftFromTemplate, type WorkflowTemplate } from "./workflowTemplates";

type TemplateActions = {
  busy: boolean;
  onCreate: (template: WorkflowTemplate) => void;
};

function TemplatePreview({ template, busy, onCreate, onClose }: TemplateActions & {
  template: WorkflowTemplate;
  onClose: () => void;
}) {
  const labelId = useId();
  const dialog = useDialogFocus<HTMLDivElement>({ onClose });
  const { draft } = useMemo(() => draftFromTemplate(template), [template]);
  const [selectedId, setSelectedId] = useState("");
  const selected = draft.nodes.find(node => node.id === selectedId);
  const nodes = useMemo(() => draft.nodes.map(node => ({ ...node, selected: node.id === selectedId })), [draft, selectedId]);
  return createPortal(
    <div className="modal-backdrop">
      <div ref={dialog} className="modal-card workflow-studio studio-template-preview" role="dialog" aria-modal="true" aria-labelledby={labelId} tabIndex={-1}>
        <header className="studio-header">
          <div className="studio-title">
            <span>Workflow template preview</span>
            <h2 id={labelId}>{template.name}</h2>
          </div>
          <button className="primary-button" type="button" disabled={busy} onClick={() => onCreate(template)}>
            {busy ? "Creating…" : "Create Workflow"}
          </button>
          <DialogCloseButton label="Close template preview" onClick={onClose} />
        </header>
        <WorkflowCanvas nodes={nodes} edges={draft.edges} nodesDraggable={false} nodesConnectable={false}
          onNodeClick={(_event, node) => setSelectedId(node.id)} onPaneClick={() => setSelectedId("")} focusNodeId={selectedId || undefined} />
        <footer className="studio-template-preview-detail">
          {selected && <strong>{String(selected.data.label)}</strong>}
          <span>{selected
            ? String(selected.data.summary || nodeKindDescriptions[String(selected.data.kind) as WorkflowNodeKind] || "")
            : template.description}</span>
        </footer>
      </div>
    </div>,
    document.body
  );
}

export function WorkflowTemplateGallery({ busy, onCreate, onBlank }: TemplateActions & { onBlank: () => void }) {
  const [preview, setPreview] = useState<WorkflowTemplate | null>(null);
  return (
    <section className="studio-template-gallery" aria-label="Workflow templates">
      <header>
        <h2>Workflow templates</h2>
        <button className="ghost-button" type="button" onClick={onBlank}>Start from scratch</button>
      </header>
      <div>
        {WORKFLOW_TEMPLATES.map(template => (
          <article className="studio-template-card" key={template.id}>
            <button className="studio-template-open" aria-label={`Preview ${template.name}`} type="button" onClick={() => setPreview(template)}>
              <IconRoute size={19} aria-hidden="true" />
              <strong>{template.name}</strong>
              <span>{template.description}</span>
            </button>
            <button className="ghost-button compact" aria-label={`Create Workflow from ${template.name}`} type="button" disabled={busy} onClick={() => onCreate(template)}>
              {busy ? "Creating…" : "Create Workflow"}<IconArrowRight size={15} aria-hidden="true" />
            </button>
          </article>
        ))}
      </div>
      {preview && <TemplatePreview key={preview.id} template={preview} busy={busy} onCreate={onCreate} onClose={() => setPreview(null)} />}
    </section>
  );
}
