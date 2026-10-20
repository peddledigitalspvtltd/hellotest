import { Panel } from "@hellotest/platform/frontend/src/shared/components/Panel";
import { CatalogSearchFilter } from "@hellotest/platform/frontend/src/shared/components/CatalogSearchFilter";
import { DataTable, type DataTableColumn } from "@hellotest/platform/frontend/src/shared/components/DataTable";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IconPlugConnected, IconPlus, IconShieldCheck, IconCode, IconKey, IconTrash, IconCopy } from "@tabler/icons-react";
import { CatalogViewToggle } from "@hellotest/platform/frontend/src/shared/components/CatalogViewToggle";
import { CatalogSelectionControls } from "@hellotest/platform/frontend/src/shared/components/CatalogSelectionControls";
import { PageHeader } from "@hellotest/platform/frontend/src/shared/components/PageHeader";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { useCurrentProject } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { WorkflowConnectionSettings } from "../workflows/WorkflowConnectionSettings";
import { agenticApi } from "../api.client";
import "./AgenticWorkflowsPage.css";
import "../agents/AgentWorkspace.css";
import "./McpServersPage.css";

type McpCatalogRecord = { id: string; name: string; description: string; status: string; tools: number; transport: string; access: string; builtin: boolean };
const serverColumns: DataTableColumn<McpCatalogRecord>[] = [
 {key:"name",label:"Server",minWidth:240,sortValue:row=>row.name,render:row=><div className="agentic-table-primary" title={row.description}><strong>{row.name}</strong><span>{row.description}</span></div>},
 {key:"status",label:"Status",width:120,sortValue:row=>row.status,render:row=><StatusBadge value={row.status}/>},
 {key:"tools",label:"Tools",width:90,sortValue:row=>row.tools,render:row=>row.tools},
 {key:"transport",label:"Transport",width:160,sortValue:row=>row.transport,render:row=>row.transport},
 {key:"access",label:"Access",minWidth:180,sortValue:row=>row.access,render:row=>row.access}
];

export function McpServersPage() {
 const [projectId]=useCurrentProject();const activeProject=useRef(projectId);activeProject.current=projectId;const {can}=useCapabilityAccess(projectId);const client=useQueryClient();
 const [viewMode,setViewMode]=useState<"tile"|"list">("tile");
 const [selectedIds,setSelectedIds]=useState<string[]>([]);
 const [search,setSearch]=useState("");const [editor,setEditor]=useState<string|null>(null);const [builtinOpen,setBuiltinOpen]=useState(false);const [token,setToken]=useState("");const [notice,setNotice]=useState("");
 useEffect(()=>{setEditor(null);setBuiltinOpen(false);setToken("");setNotice("");setSelectedIds([]);},[projectId]);
 const [connectionStatus,setConnectionStatus]=useState<{kind:"checking"|"connected"|"error";message:string}|null>(null);
 const [copied,setCopied]=useState({endpoint:false,credential:false});
 const [copyError,setCopyError]=useState({endpoint:"",credential:""});
 const copyTimers=useRef<Partial<Record<"endpoint"|"credential",ReturnType<typeof setTimeout>>>>({});
 const copyGeneration=useRef(0);
 useEffect(()=>{
  setCopied({endpoint:false,credential:false});setCopyError({endpoint:"",credential:""});setConnectionStatus(null);
  return ()=>{copyGeneration.current++;Object.values(copyTimers.current).forEach(clearTimeout);copyTimers.current={};};
 },[projectId,builtinOpen]);
 const copyValue=async(kind:"endpoint"|"credential",value:string)=>{
  const generation=copyGeneration.current;
  try{
   await navigator.clipboard.writeText(value);
   if(generation!==copyGeneration.current)return;
   clearTimeout(copyTimers.current[kind]);setCopyError(current=>({...current,[kind]:""}));setCopied(current=>({...current,[kind]:true}));
   copyTimers.current[kind]=setTimeout(()=>setCopied(current=>({...current,[kind]:false})),2000);
  }catch{if(generation===copyGeneration.current)setCopyError(current=>({...current,[kind]:"Could not copy to the clipboard. Select and copy the value manually."}));}
 };
 const builtin=useQuery({queryKey:["hellotest-mcp-server",projectId],queryFn:()=>agenticApi.mcp.server(projectId),enabled:Boolean(projectId)&&can("agentic_workflow.view")});
 const external=useQuery({queryKey:["workflow-admin-connections",projectId],queryFn:()=>agenticApi.workflowConnections.list(projectId),enabled:Boolean(projectId)&&can("integration.view")});
 const credentials=useQuery({queryKey:["mcp-credentials",projectId],queryFn:()=>agenticApi.mcp.credentials(projectId),enabled:Boolean(projectId)&&builtinOpen});
 const plans=useQuery({queryKey:["mcp-plans",projectId],queryFn:()=>agenticApi.mcp.plans(projectId),enabled:Boolean(projectId)&&builtinOpen,refetchInterval:builtinOpen?5000:false});
 const issue=useMutation({mutationFn:async()=>({row:await agenticApi.mcp.issue(projectId),projectId}),onSuccess:({row,projectId:issuedProject})=>{if(issuedProject!==activeProject.current)return;setToken(row.token);setNotice("Credential created. It expires in one hour and is limited to this project.");void credentials.refetch();},onError:error=>setNotice(error.message)});
 const check=useMutation({mutationFn:async(checkedProject:string)=>({row:await agenticApi.mcp.status(checkedProject),projectId:checkedProject}),onMutate:()=>setConnectionStatus({kind:"checking",message:"Checking the built-in MCP connection…"}),onSuccess:({row,projectId:checkedProject})=>{if(checkedProject!==activeProject.current)return;setConnectionStatus({kind:"connected",message:`Connected. ${row.tool_count} tools available using your signed-in project session.${row.external_transport?.public_endpoint_configured === false ? " For cloud clients, configure HELLOTEST_MCP_PUBLIC_URL and recreate the API; this internal check does not verify the public gateway." : row.external_transport?.request_host_allowed === false ? " This gateway Host is not allowed for external MCP. Check HELLOTEST_MCP_PUBLIC_URL and HELLOTEST_MCP_ALLOWED_HOSTS." : ""}`});},onError:(error,checkedProject)=>{if(checkedProject===activeProject.current)setConnectionStatus({kind:"error",message:error.message});}});
 const revoke=useMutation({mutationFn:(id:string)=>agenticApi.mcp.revoke(projectId,id),onSuccess:()=>{setToken("");void credentials.refetch();},onError:error=>setNotice(error.message)});
 const approve=useMutation({mutationFn:(plan:{id:string;digest:string})=>agenticApi.mcp.authorize(projectId,plan.id,plan.digest),onSuccess:()=>{setNotice("This exact plan is authorized. The connected host can now execute it once.");void plans.refetch();},onError:error=>setNotice(error.message)});
 const editorRef=useDialogFocus<HTMLDivElement>({active:editor!==null||builtinOpen,onClose:()=>{setEditor(null);setBuiltinOpen(false);setToken("");}});
 const rows=(external.data||[]).filter(row=>row.kind==="mcp"&&[row.name,row.url].join(" ").toLowerCase().includes(search.toLowerCase()));
 const showBuiltin=builtin.data&&("hellotest built-in knowledge graph context trace api database".includes(search.toLowerCase()));
 const visibleIds=[...(showBuiltin?["hellotest"]:[]),...rows.map(row=>row.id)];
 const toggleSelection=(id:string)=>setSelectedIds(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]);
 const catalogRecords: McpCatalogRecord[] = [
  ...(showBuiltin ? [{id:"hellotest",name:"HelloTest",description:"Current APIs, authorized PostgreSQL projections, knowledge, graph paths and project evidence.",status:"active",tools:builtin.data!.tools.length,transport:"Streamable HTTP",access:"Signed-in user · Project permissions",builtin:true}] : []),
  ...rows.map(row=>({id:row.id,name:row.name,description:row.url,status:row.enabled?"active":"inactive",tools:row.tools.length,transport:row.transport || "Streamable HTTP",access:row.authenticated?"Configured":"None",builtin:false}))
 ];
 const openServer=(row:McpCatalogRecord)=>{if(row.builtin)setBuiltinOpen(true);else setEditor(row.id);};
 const endpoint=builtin.data?.endpoint?new URL(builtin.data.endpoint,window.location.origin).href:"";
 if(!can("agentic_workflow.view"))return <div className="empty-state">AI Agent Studio access is required.</div>;
 return <div className="page-content page-agentic-workflows agent-directory mcp-server-page">
  <PageHeader eyebrow="AI Agent Studio" title="MCP Servers" description="Connect tools and project context to your AI hosts." />
  {!projectId?<div className="empty-state">Select a project to manage its MCP servers.</div>:<>
  <Panel title="MCP servers" titleVariant="eyebrow" className="agentic-workflows-panel mcp-catalog-panel">
   <div className="design-list-toolbar catalog-command-toolbar agentic-workflows-toolbar">
    <div className="catalog-toolbar-discovery" aria-label="MCP server views, search, and selection">
     <CatalogViewToggle value={viewMode} onChange={setViewMode}/>
     <CatalogSearchFilter activeFilterCount={search.trim()?1:0} ariaLabel="Search MCP servers" placeholder="Search MCP servers" title="Filter MCP servers" type="search" value={search} onChange={setSearch}>
      <div className="catalog-filter-grid"><label className="catalog-filter-field"><span>Search</span><input value={search} onChange={event=>setSearch(event.target.value)}/></label><div className="catalog-filter-actions"><button className="ghost-button" disabled={!search} onClick={()=>setSearch("")} type="button">Clear filters</button></div></div>
     </CatalogSearchFilter>
     <CatalogSelectionControls allSelected={Boolean(visibleIds.length)&&visibleIds.every(id=>selectedIds.includes(id))} canSelectAll={Boolean(visibleIds.length)} selectedCount={selectedIds.length} clearLabel="Clear all" onClear={()=>setSelectedIds([])} onSelectAll={()=>setSelectedIds(current=>Array.from(new Set([...current,...visibleIds])))}/>
    </div>
    {can("integration.manage")?<div className="catalog-toolbar-actions" aria-label="MCP server actions"><button className="primary-button catalog-selection-button" onClick={()=>setEditor("")} type="button"><IconPlus size={16}/><span>Create MCP server</span></button></div>:null}
   </div>
   {builtin.isError||external.isError?<p role="alert">Server information could not be loaded. <button className="ghost-button" type="button" onClick={()=>{void builtin.refetch();void external.refetch();}}>Retry</button></p>:null}
   {builtin.isLoading||external.isLoading?<p role="status">Loading MCP servers…</p>:null}
   <div className={`agentic-catalog-stage mcp-server-catalog ${viewMode === "list" ? "is-list" : "is-grid"}`} data-tab="servers" data-view={viewMode}>
    {viewMode === "list" ? <DataTable columns={serverColumns} rows={catalogRecords} emptyMessage="No servers match your search." enableColumnResize enableHeaderColumnReorder enableRowSelection selectedRowKeys={selectedIds} onSelectedRowKeysChange={setSelectedIds} getRowKey={row=>row.id} hideToolbarCopy onRowClick={openServer} storageKey="mcp-servers-list-columns"/> : <div className="tile-browser-grid agentic-workflow-grid">
     {catalogRecords.map(row=><button key={row.id} type="button" aria-label={row.builtin?"Connect & inspect":`Inspect server ${row.name}`} className={`record-card tile-card agentic-workflow-card mcp-server-card${selectedIds.includes(row.id)?" is-active":""}`} onClick={()=>openServer(row)}>
      <div className="tile-card-main">
       <div className="tile-card-select-row"><label className="checkbox-field" onClick={event=>event.stopPropagation()}><input type="checkbox" aria-label={`Select ${row.name}`} checked={selectedIds.includes(row.id)} onChange={()=>toggleSelection(row.id)}/><span className="sr-only">Select server</span></label></div>
       <div className="tile-card-header"><span className="agentic-type-badge" aria-hidden="true"><IconPlugConnected size={14}/></span><div className="tile-card-title-group"><span className="tile-card-kicker">{row.builtin?"Built in":"External"}</span><strong>{row.name}</strong></div><StatusBadge value={row.status}/></div>
       <div className="rich-text-content tile-card-description" title={row.description}><p>{row.description}</p></div>
       <div className="tile-card-facts"><span><strong>{row.tools}</strong><small>Tools</small></span><span><strong>{row.transport}</strong><small>Transport</small></span><span><strong>{row.builtin?<IconShieldCheck size={16}/>:row.access}</strong><small>{row.builtin?"Project permissions":"Authentication"}</small></span></div>
      </div>
     </button>)}
     {!builtin.isLoading&&!external.isLoading&&!catalogRecords.length?<div className="empty-state compact">No servers match your search.</div>:null}
    </div>}
   </div>
  </Panel>
  </>}
  {editor!==null||builtinOpen?<div className="modal-backdrop" onClick={()=>{setEditor(null);setBuiltinOpen(false);setToken("");}}><div ref={editorRef} role="dialog" aria-modal="true" aria-label={builtinOpen?"HelloTest MCP server":editor?"Edit MCP server":"Create MCP server"} className="modal-card mcp-server-dialog" onClick={event=>event.stopPropagation()} tabIndex={-1}><header><h2>{builtinOpen?"HelloTest MCP server":editor?"Edit MCP server":"Create MCP server"}</h2><DialogCloseButton onClick={()=>{setEditor(null);setBuiltinOpen(false);setToken("");}}/></header>
   {builtinOpen&&builtin.data?<div className="mcp-server-dialog-body"><section><h3><IconCode size={16}/>Endpoint</h3><code>{endpoint}</code><button className="ghost-button compact" type="button" onClick={()=>void copyValue("endpoint",endpoint)}><IconCopy size={14}/>{copied.endpoint?"Copied":"Copy endpoint"}</button><p>External clients use this endpoint with a project-bound bearer credential. Built-in app access uses your signed-in project session automatically.</p><button className="ghost-button compact" type="button" disabled={check.isPending} onClick={()=>check.mutate(projectId)}>{check.isPending?"Checking…":"Check connection status"}</button>{connectionStatus?<p className="mcp-connection-status" role={connectionStatus.kind==="error"?"alert":"status"} aria-live="polite">{connectionStatus.message}</p>:null}{copyError.endpoint?<p role="alert">{copyError.endpoint}</p>:null}</section>
    {builtin.data.client_contract?<details><summary>Client connection contract</summary><p>{builtin.data.authentication}</p><dl><div><dt>Protocol revisions</dt><dd>{builtin.data.protocol_versions?.join(", ")}</dd></div><div><dt>Accept header</dt><dd><code>{builtin.data.client_contract.accept}</code></dd></div><div><dt>Credential scope</dt><dd>This project · {Math.round(builtin.data.client_contract.credential_ttl_seconds/60)} minutes</dd></div><div><dt>Transport</dt><dd>Stateless HTTP POST · use tool discovery to check the connection</dd></div></dl><p>OAuth onboarding is unavailable. A GET request is not a connection check. The calling host must be able to reach the endpoint; a container’s localhost identifies that container.</p>{builtin.data.discovery?<><p>Resources: {builtin.data.discovery.resources.join(", ")}</p><p>Resource templates: {builtin.data.discovery.resource_templates.join(", ")}</p><p>Prompts: {builtin.data.discovery.prompts.join(", ")}</p></>:null}</details>:null}
    <details><summary>{builtin.data.tools.length} available tools</summary>{builtin.data.tools.map(tool=><div className="mcp-tool-row" key={tool.name}><code>{tool.name}</code><p>{tool.description}</p><small>{tool.read_only?"Read only":"Reviewed action"}</small>{tool.input_schema?<details><summary>Input contract</summary><pre>{JSON.stringify(tool.input_schema,null,2)}</pre></details>:null}{tool.output_schema?<details><summary>Output contract</summary><pre>{JSON.stringify(tool.output_schema,null,2)}</pre></details>:null}</div>)}</details>
    <section><h3><IconKey size={16}/>Your delegated access</h3><p>HelloTest AI features, Smart Context and Ask Chatbot use your signed-in identity automatically. Create a host credential only for an external MCP client.</p><button className="primary-button" type="button" disabled={issue.isPending} onClick={()=>issue.mutate()}>{issue.isPending?"Creating…":"Create host credential"}</button>{token?<label className="form-field"><span>Shown once · expires in one hour</span><input readOnly type="password" value={token}/><button className="ghost-button compact" type="button" onClick={()=>void copyValue("credential",token)}><IconCopy size={14}/>{copied.credential?"Copied":"Copy credential"}</button>{copyError.credential?<span role="alert">{copyError.credential}</span>:null}</label>:null}{credentials.data?.map(row=><div className="mcp-credential-row" key={row.id}><span>{row.client_id} · {row.revoked_at?"Revoked":new Date(row.expires_at).toLocaleString()}</span>{!row.revoked_at?<button aria-label={`Revoke ${row.client_id}`} title="Revoke credential" className="ghost-button compact" type="button" disabled={revoke.isPending} onClick={()=>revoke.mutate(row.id)}><IconTrash size={15}/></button>:null}</div>)}</section>
    <section><h3><IconShieldCheck size={16}/>Action plans</h3><p>The model can prepare a plan. Only your explicit review authorizes its exact effect.</p>{plans.data?.map(plan=><details className="mcp-plan" key={plan.id}><summary>{plan.state} · {plan.id.slice(0,8)} · {plan.client_id}</summary><p><strong>{plan.operation.method} {plan.operation.path}</strong> · {plan.operation.permission}</p><pre>{JSON.stringify(plan.arguments,null,2)}</pre><p>Expires {new Date(plan.expires_at).toLocaleString()}</p>{plan.state==="requires_authorization"?<button className="primary-button" type="button" disabled={approve.isPending||new Date(plan.expires_at)<=new Date()} onClick={()=>approve.mutate(plan)}>Authorize this exact plan</button>:null}{plan.receipt?<pre>{JSON.stringify(plan.receipt,null,2)}</pre>:null}</details>)}</section>
    {credentials.isError||plans.isError?<p role="alert">Delegated access or action plans could not be loaded. <button type="button" onClick={()=>{void credentials.refetch();void plans.refetch();}}>Retry</button></p>:null}
    {notice?<p role="status">{notice}</p>:null}
   </div>:<WorkflowConnectionSettings kind="mcp" connectionId={editor||undefined} onClose={()=>setEditor(null)} onSaved={()=>{void client.invalidateQueries({queryKey:["workflow-admin-connections"]});setEditor(null);}}/>}
  </div></div>:null}
 </div>;
}
