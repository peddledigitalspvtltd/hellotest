import {useQuery} from "@tanstack/react-query";
import {IconRefresh} from "@tabler/icons-react";
import {agenticApi} from "../../api.client";
import {useWorkflowConnections} from "./shared/connectionState";
import {ManagedConnectionFields} from "./shared/ManagedConnectionFields";
import type { WorkflowOperationEditorProps } from "./operationEditorTypes";
import { workflowFieldInputs } from "./shared/fieldInputs";
export function McpToolFields(props:WorkflowOperationEditorProps){
const {data,projectId,canRun,onChange}=props;
const {field, select}=workflowFieldInputs(data,onChange);
const connections=useWorkflowConnections(projectId);
const connection=connections.data?.find(item=>item.id===data.connectionId);
const onConnectionChange=(id:string)=>{const selected=connections.data?.find(item=>item.id===id);onChange({connectionId:id,apiAuth:'',credentialId:'',...(selected?.timeoutMs?{timeoutMs:String(selected.timeoutMs)}:{}),mcpTool:'',mcpArguments:'{}'});};
const mcp = useQuery({
    queryKey: ["workflow-mcp-tools", projectId, data.connectionId, connection?.discovered_at || connection?.url],
    queryFn: ({ signal }) =>
      agenticApi.agenticWorkflows.mcpTools(
        projectId,
        String(data.connectionId),
        signal,
      ),
    enabled: false,
    retry: false,
    gcTime: 30000,
  });
const catalog = mcp.data || (connection?.toolDefinitions?.length ? connection.toolDefinitions : (connection?.tools || []).map(name => ({ name })));
const availableTools = catalog
    .filter(item => connection?.tools.includes(item.name));
const tool = (mcp.data || connection?.toolDefinitions)?.find((item) => item.name === data.mcpTool && connection?.tools.includes(item.name));
return (<><ManagedConnectionFields data={data} protocol="mcp" connections={connections} onConnectionChange={onConnectionChange}/><>
          {connection && <p className="studio-caption">{connection.serverInfo?.name || connection.name} · Streamable HTTP<br />{connection.url}<br />{connection.tools.length} enabled tools{connection.discovered_at ? " · saved server catalog" : ""}</p>}
          {canRun ? <button
            type="button"
            className="ghost-button"
            disabled={!connection || mcp.isFetching}
            onClick={() => void mcp.refetch()}
          >
            <IconRefresh size={15} />
            {mcp.isFetching ? "Reading server tools…" : connection?.toolDefinitions?.length ? "Refresh server tools" : "Load server tools"}
          </button> : null}
          {mcp.isError ? (
            <p role="alert">
              {mcp.error instanceof Error
                ? mcp.error.message
                : "Could not read server tools."}
            </p>
          ) : null}
          {select("mcpTool", "Server tool", [
            ["", "Choose a tool"],
            ...availableTools.map((item) => [item.name, item.name] as [string, string]),
          ])}
          {tool?.description ? (
            <p className="studio-caption">{tool.description}</p>
          ) : null}
          {data.mcpTool && connection && !availableTools.some(item => item.name === data.mcpTool) && <p role="alert">This tool is no longer enabled. Choose a current server tool or update the provider in Integrations.</p>}
          {field("mcpArguments", "Tool arguments JSON", true, "{}")}
          {tool ? (
            <details>
              <summary>Server input schema</summary>
              <pre className="studio-schema">
                {JSON.stringify(tool.inputSchema, null, 2)}
              </pre>
            </details>
          ) : null}
          <p className="studio-caption">
            Use JSON values or paths such as <code>"$input.id"</code>. Tool
            arguments are checked against the server schema before execution.
          </p>
        </></>);
}
