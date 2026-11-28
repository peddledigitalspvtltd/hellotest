import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconPlugConnected, IconPlus } from "@tabler/icons-react";
import { Panel } from "@hellotest/platform/frontend/src/shared/components/Panel";
import { CatalogSearchFilter } from "@hellotest/platform/frontend/src/shared/components/CatalogSearchFilter";
import { DataTable, type DataTableColumn } from "@hellotest/platform/frontend/src/shared/components/DataTable";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { CatalogViewToggle } from "@hellotest/platform/frontend/src/shared/components/CatalogViewToggle";
import { CatalogSelectionControls } from "@hellotest/platform/frontend/src/shared/components/CatalogSelectionControls";
import { PageHeader } from "@hellotest/platform/frontend/src/shared/components/PageHeader";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { useCurrentProject } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { WorkflowConnectionSettings } from "../workflows/WorkflowConnectionSettings";
import { agenticApi } from "../api.client";
import { McpBuiltinServerDialog } from "./McpBuiltinServerDialog";
import "./AgenticWorkflowsPage.css";
import "../agents/AgentWorkspace.css";
import "./McpServersPage.css";

type McpCatalogRecord = {
  id: string; name: string; description: string; status: string; tools: number; transport: string; access: string; builtin: boolean;
};
const serverColumns: DataTableColumn<McpCatalogRecord>[] = [
  { key: "name", label: "Server", minWidth: 240, sortValue: row => row.name, render: row => <div className="agentic-table-primary" title={row.description}><strong>{row.name}</strong><span>{row.description}</span></div> },
  { key: "status", label: "Status", width: 120, sortValue: row => row.status, render: row => <StatusBadge value={row.status} /> },
  { key: "tools", label: "Tools", width: 90, sortValue: row => row.tools, render: row => row.tools },
  { key: "transport", label: "Transport", width: 160, sortValue: row => row.transport, render: row => row.transport },
  { key: "access", label: "Access", minWidth: 180, sortValue: row => row.access, render: row => row.access }
];

function ExternalMcpServerDialog({ connectionId, onClose, onSaved }: { connectionId: string; onClose: () => void; onSaved: () => void }) {
  const dialogRef = useDialogFocus<HTMLDivElement>({ onClose });
  const title = connectionId ? "Edit MCP server" : "Create MCP server";
  return <div className="modal-backdrop mcp-server-backdrop" onClick={onClose}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} className="modal-card mcp-server-dialog mcp-server-dialog--external" onClick={event => event.stopPropagation()} tabIndex={-1}>
      <header className="mcp-dialog-header"><h2>{title}</h2><DialogCloseButton onClick={onClose} /></header>
      <WorkflowConnectionSettings kind="mcp" connectionId={connectionId || undefined} onClose={onClose} onSaved={onSaved} />
    </div>
  </div>;
}

export function McpServersPage() {
  const [projectId] = useCurrentProject();
  const { can } = useCapabilityAccess(projectId);
  const client = useQueryClient();
  const [viewMode, setViewMode] = useState<"tile" | "list">("tile");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<string | null>(null);
  const [builtinOpen, setBuiltinOpen] = useState(false);

  useEffect(() => { setEditor(null); setBuiltinOpen(false); setSelectedIds([]); }, [projectId]);
  const builtin = useQuery({ queryKey: ["hellotest-mcp-server", projectId], queryFn: () => agenticApi.mcp.server(projectId), enabled: Boolean(projectId) && can("agentic_workflow.view") });
  const external = useQuery({ queryKey: ["workflow-admin-connections", projectId], queryFn: () => agenticApi.workflowConnections.list(projectId), enabled: Boolean(projectId) && can("integration.view") });
  const query = search.trim().toLowerCase();
  const showBuiltin = builtin.data && "hellotest built-in knowledge graph context trace api database".includes(query);
  const rows = (external.data || []).filter(row => row.kind === "mcp" && `${row.name} ${row.url}`.toLowerCase().includes(query));
  const catalogRecords: McpCatalogRecord[] = [
    ...(showBuiltin ? [{ id: "hellotest", name: "HelloTest", description: "Project tools and evidence", status: "active", tools: builtin.data!.tools.length, transport: "Streamable HTTP", access: "Project permissions", builtin: true }] : []),
    ...rows.map(row => ({ id: row.id, name: row.name, description: row.url, status: row.enabled ? "active" : "inactive", tools: row.tools.length, transport: row.transport || "Streamable HTTP", access: row.authenticated ? "Configured" : "None", builtin: false }))
  ];
  const visibleIds = catalogRecords.map(row => row.id);
  const openServer = (row: McpCatalogRecord) => { if (row.builtin) setBuiltinOpen(true); else setEditor(row.id); };
  const toggleSelection = (id: string) => setSelectedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const isLoading = builtin.isLoading || external.isLoading;

  if (!can("agentic_workflow.view")) return <div className="empty-state">AI Agent Studio access is required.</div>;
  return <div className="page-content page-agentic-workflows agent-directory mcp-server-page">
    <PageHeader eyebrow="AI Agent Studio" title="MCP Servers" />
    {!projectId ? <div className="empty-state">Select a project to manage MCP servers.</div> : <Panel title="MCP servers" titleVariant="eyebrow" className="agentic-workflows-panel mcp-catalog-panel">
      <div className="design-list-toolbar catalog-command-toolbar agentic-workflows-toolbar">
        <div className="catalog-toolbar-discovery" aria-label="MCP server views, search, and selection">
          <CatalogViewToggle value={viewMode} onChange={setViewMode} />
          <CatalogSearchFilter activeFilterCount={query ? 1 : 0} ariaLabel="Search MCP servers" placeholder="Search MCP servers" title="Filter MCP servers" type="search" value={search} onChange={setSearch}>
            <div className="catalog-filter-grid"><label className="catalog-filter-field"><span>Search</span><input value={search} onChange={event => setSearch(event.target.value)} /></label><div className="catalog-filter-actions"><button className="ghost-button" disabled={!search} onClick={() => setSearch("")} type="button">Clear filters</button></div></div>
          </CatalogSearchFilter>
          <CatalogSelectionControls allSelected={Boolean(visibleIds.length) && visibleIds.every(id => selectedIds.includes(id))} canSelectAll={Boolean(visibleIds.length)} selectedCount={selectedIds.length} clearLabel="Clear all" onClear={() => setSelectedIds([])} onSelectAll={() => setSelectedIds(current => Array.from(new Set([...current, ...visibleIds])))} />
        </div>
        {can("integration.manage") ? <div className="catalog-toolbar-actions" aria-label="MCP server actions"><button className="primary-button catalog-selection-button" onClick={() => setEditor("")} type="button"><IconPlus size={16} aria-hidden="true" /><span>Create MCP server</span></button></div> : null}
      </div>
      {builtin.isError || external.isError ? <p className="mcp-feedback is-error" role="alert">Server information could not be loaded. <button className="ghost-button compact" type="button" onClick={() => { void builtin.refetch(); void external.refetch(); }}>Retry</button></p> : null}
      {isLoading ? <p role="status">Loading MCP servers…</p> : null}
      <div className={`agentic-catalog-stage mcp-server-catalog ${viewMode === "list" ? "is-list" : "is-grid"}`} data-tab="servers" data-view={viewMode}>
        {viewMode === "list" ? <DataTable columns={serverColumns} rows={catalogRecords} emptyMessage="No servers match your search." enableColumnResize enableHeaderColumnReorder enableRowSelection selectedRowKeys={selectedIds} onSelectedRowKeysChange={setSelectedIds} getRowKey={row => row.id} hideToolbarCopy onRowClick={openServer} storageKey="mcp-servers-list-columns" /> : <div className="tile-browser-grid agentic-workflow-grid">
          {catalogRecords.map(row => <article key={row.id} className={`record-card tile-card agentic-workflow-card mcp-server-card${selectedIds.includes(row.id) ? " is-active" : ""}`}>
            <button type="button" className="mcp-server-card-open" aria-label={row.builtin ? "Connect & inspect" : `Inspect server ${row.name}`} onClick={() => openServer(row)}>
              <span className="mcp-card-topline"><span className="agentic-type-badge" aria-hidden="true"><IconPlugConnected size={15} /></span><span className="tile-card-title-group"><strong>{row.name}</strong><small>{row.builtin ? "Built in" : "External"}</small></span></span>
              <span className="mcp-card-description" title={row.description}>{row.description}</span>
              <span className="mcp-card-facts"><span>{row.tools} {row.tools === 1 ? "tool" : "tools"}</span><StatusBadge value={row.status} /></span>
            </button>
            <label className="checkbox-field mcp-card-select"><input type="checkbox" aria-label={`Select ${row.name}`} checked={selectedIds.includes(row.id)} onChange={() => toggleSelection(row.id)} /></label>
          </article>)}
          {!isLoading && !catalogRecords.length ? <div className="empty-state compact">No servers match your search.</div> : null}
        </div>}
      </div>
    </Panel>}
    {builtinOpen && builtin.data ? <McpBuiltinServerDialog key={projectId} projectId={projectId} server={builtin.data} onClose={() => setBuiltinOpen(false)} /> : null}
    {editor !== null ? <ExternalMcpServerDialog key={`${projectId}:${editor}`} connectionId={editor} onClose={() => setEditor(null)} onSaved={() => {
      void client.invalidateQueries({ queryKey: ["workflow-admin-connections"] });
      setEditor(null);
    }} /> : null}
  </div>;
}
