import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IconPlugConnected, IconSearch, IconPlus, IconArrowRight, IconShieldCheck, IconCode, IconKey, IconTrash, IconCopy } from "@tabler/icons-react";
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

export function McpServersPage() {
 const [projectId]=useCurrentProject();const activeProject=useRef(projectId);activeProject.current=projectId;const {can}=useCapabilityAccess(projectId);const client=useQueryClient();
 const [search,setSearch]=useState("");const [editor,setEditor]=useState<string|null>(null);const [builtinOpen,setBuiltinOpen]=useState(false);const [token,setToken]=useState("");const [notice,setNotice]=useState("");
 useEffect(()=>{setEditor(null);setBuiltinOpen(false);setToken("");setNotice("");},[projectId]);
 const builtin=useQuery({queryKey:["hellotest-mcp-server",projectId],queryFn:()=>agenticApi.mcp.server(projectId),enabled:Boolean(projectId)&&can("agentic_workflow.view")});
 const external=useQuery({queryKey:["workflow-admin-connections",projectId],queryFn:()=>agenticApi.workflowConnections.list(projectId),enabled:Boolean(projectId)&&can("integration.view")});
 const credentials=useQuery({queryKey:["mcp-credentials",projectId],queryFn:()=>agenticApi.mcp.credentials(projectId),enabled:Boolean(projectId)&&builtinOpen});
 const plans=useQuery({queryKey:["mcp-plans",projectId],queryFn:()=>agenticApi.mcp.plans(projectId),enabled:Boolean(projectId)&&builtinOpen,refetchInterval:builtinOpen?5000:false});
 const issue=useMutation({mutationFn:async()=>({row:await agenticApi.mcp.issue(projectId),projectId}),onSuccess:({row,projectId:issuedProject})=>{if(issuedProject!==activeProject.current)return;setToken(row.token);setNotice("Credential created. It expires in one hour and is limited to this project.");void credentials.refetch();},onError:error=>setNotice(error.message)});
 const revoke=useMutation({mutationFn:(id:string)=>agenticApi.mcp.revoke(projectId,id),onSuccess:()=>{setToken("");void credentials.refetch();},onError:error=>setNotice(error.message)});
 const approve=useMutation({mutationFn:(plan:{id:string;digest:string})=>agenticApi.mcp.authorize(projectId,plan.id,plan.digest),onSuccess:()=>{setNotice("This exact plan is authorized. The connected host can now execute it once.");void plans.refetch();},onError:error=>setNotice(error.message)});
 const editorRef=useDialogFocus<HTMLDivElement>({active:editor!==null||builtinOpen,onClose:()=>{setEditor(null);setBuiltinOpen(false);setToken("");}});
 const rows=(external.data||[]).filter(row=>row.kind==="mcp"&&[row.name,row.url].join(" ").toLowerCase().includes(search.toLowerCase()));
 const showBuiltin=builtin.data&&("hellotest built-in knowledge api database".includes(search.toLowerCase()));
 const endpoint=builtin.data?.endpoint?new URL(builtin.data.endpoint,window.location.origin).href:"";
 if(!can("agentic_workflow.view"))return <div className="empty-state">Agent Studio access is required.</div>;
 return <div className="page page-agentic-workflows agent-directory mcp-server-page">
  <PageHeader eyebrow="Agent Studio" title="MCP Servers" description="Connect tools and project context to your AI hosts." />
  <nav className="agent-hub-nav" aria-label="Agent workspace navigation"><Link to="/agentic-workflows?view=agents">AI agents</Link><Link to="/agentic-workflows?view=workflows">Workflows</Link><Link to="/mcp-servers" aria-current="page">MCP Servers</Link></nav>
  {!projectId?<div className="empty-state">Select a project to manage its MCP servers.</div>:<>
  <section className="agent-directory-toolbar"><label className="agent-library-search"><IconSearch size={17}/><input aria-label="Search MCP servers" placeholder="Search servers, tools or context…" value={search} onChange={event=>setSearch(event.target.value)}/></label>{can("integration.manage")?<button className="primary-button" onClick={()=>setEditor("")} type="button"><IconPlus size={16}/>Create MCP server</button>:null}</section>
  {builtin.isError||external.isError?<p role="alert">Server information could not be loaded. <button type="button" onClick={()=>{void builtin.refetch();void external.refetch();}}>Retry</button></p>:null}
  {builtin.isLoading?<p role="status">Loading MCP servers…</p>:null}
  <div className="agent-library-grid">
   {showBuiltin?<article className="agent-library-card mcp-builtin-card"><header><span className="agent-library-icon"><IconPlugConnected/></span><span className="agent-library-kind">Built in</span><IconShieldCheck size={17}/></header><div className="agent-library-copy"><h3>HelloTest</h3><p>Current APIs, authorized PostgreSQL projections, knowledge and project evidence.</p></div><dl><div><dt>Tools</dt><dd>{builtin.data!.tools.length} discoverable tools</dd></div><div><dt>Access</dt><dd>Signed-in user · Project permissions</dd></div></dl><footer><small>Streamable HTTP</small><button className="ghost-button" type="button" onClick={()=>setBuiltinOpen(true)}>Connect & inspect<IconArrowRight size={15}/></button></footer></article>:null}
   {rows.map(row=><article className="agent-library-card" key={row.id}><header><span className="agent-library-icon"><IconPlugConnected/></span><span className="agent-library-kind">{row.enabled?"Enabled":"Inactive"}</span></header><div className="agent-library-copy"><h3>{row.name}</h3><p>{row.url}</p></div><dl><div><dt>Tools</dt><dd>{row.tools.length} enabled</dd></div><div><dt>Authentication</dt><dd>{row.authenticated?"Configured":"None"}</dd></div></dl><footer><small>{row.transport}</small><button className="ghost-button" type="button" onClick={()=>setEditor(row.id)}>Inspect server<IconArrowRight size={15}/></button></footer></article>)}
  </div>{!builtin.isLoading&&!showBuiltin&&!rows.length?<p className="empty-state">No servers match your search.</p>:null}
  </>}
  {editor!==null||builtinOpen?<div className="modal-backdrop" onClick={()=>{setEditor(null);setBuiltinOpen(false);setToken("");}}><div ref={editorRef} role="dialog" aria-modal="true" aria-label={builtinOpen?"HelloTest MCP server":editor?"Edit MCP server":"Create MCP server"} className="modal-card mcp-server-dialog" onClick={event=>event.stopPropagation()} tabIndex={-1}><header><h2>{builtinOpen?"HelloTest MCP server":editor?"Edit MCP server":"Create MCP server"}</h2><DialogCloseButton onClick={()=>{setEditor(null);setBuiltinOpen(false);setToken("");}}/></header>
   {builtinOpen&&builtin.data?<div className="mcp-server-dialog-body"><section><h3><IconCode size={16}/>Endpoint</h3><code>{endpoint}</code><button className="ghost-button compact" type="button" onClick={()=>void navigator.clipboard.writeText(endpoint)}><IconCopy size={14}/>Copy endpoint</button><p>Use a project-bound bearer credential. This host must support Streamable HTTP. Production connections use the configured HTTPS endpoint.</p></section>
    <details><summary>{builtin.data.tools.length} available tools</summary>{builtin.data.tools.map(tool=><div className="mcp-tool-row" key={tool.name}><code>{tool.name}</code><p>{tool.description}</p><small>{tool.read_only?"Read only":"Reviewed action"}</small></div>)}</details>
    <section><h3><IconKey size={16}/>Your delegated access</h3><p>HelloTest AI features, Smart Context and Ask Chatbot use your signed-in identity automatically. Create a host credential only for an external MCP client.</p><button className="primary-button" type="button" disabled={issue.isPending} onClick={()=>issue.mutate()}>{issue.isPending?"Creating…":"Create host credential"}</button>{token?<label className="form-field"><span>Shown once · expires in one hour</span><input readOnly type="password" value={token}/><button className="ghost-button compact" type="button" onClick={()=>void navigator.clipboard.writeText(token)}><IconCopy size={14}/>Copy credential</button></label>:null}{credentials.data?.map(row=><div className="mcp-credential-row" key={row.id}><span>{row.client_id} · {row.revoked_at?"Revoked":new Date(row.expires_at).toLocaleString()}</span>{!row.revoked_at?<button aria-label={`Revoke ${row.client_id}`} title="Revoke credential" className="ghost-button compact" type="button" disabled={revoke.isPending} onClick={()=>revoke.mutate(row.id)}><IconTrash size={15}/></button>:null}</div>)}</section>
    <section><h3><IconShieldCheck size={16}/>Action plans</h3><p>The model can prepare a plan. Only your explicit review authorizes its exact effect.</p>{plans.data?.map(plan=><details className="mcp-plan" key={plan.id}><summary>{plan.state} · {plan.id.slice(0,8)} · {plan.client_id}</summary><p><strong>{plan.operation.method} {plan.operation.path}</strong> · {plan.operation.permission}</p><pre>{JSON.stringify(plan.arguments,null,2)}</pre><p>Expires {new Date(plan.expires_at).toLocaleString()}</p>{plan.state==="requires_authorization"?<button className="primary-button" type="button" disabled={approve.isPending||new Date(plan.expires_at)<=new Date()} onClick={()=>approve.mutate(plan)}>Authorize this exact plan</button>:null}{plan.receipt?<pre>{JSON.stringify(plan.receipt,null,2)}</pre>:null}</details>)}</section>
    {credentials.isError||plans.isError?<p role="alert">Delegated access or action plans could not be loaded. <button type="button" onClick={()=>{void credentials.refetch();void plans.refetch();}}>Retry</button></p>:null}
    {notice?<p role="status">{notice}</p>:null}
   </div>:<WorkflowConnectionSettings kind="mcp" connectionId={editor||undefined} onClose={()=>setEditor(null)} onSaved={()=>{void client.invalidateQueries({queryKey:["workflow-admin-connections"]});setEditor(null);}}/>}
  </div></div>:null}
 </div>;
}
