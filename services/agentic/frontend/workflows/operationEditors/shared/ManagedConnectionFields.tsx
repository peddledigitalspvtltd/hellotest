import {Link} from 'react-router-dom';
import {IconPlugConnected,IconRefresh} from '@tabler/icons-react';
import type {WorkflowOperationEditorProps} from '../operationEditorTypes';
import type {useWorkflowConnections} from './connectionState';
export function ManagedConnectionFields({data,protocol,connections,onConnectionChange}:{data:WorkflowOperationEditorProps['data'];protocol:'http'|'mcp';connections:ReturnType<typeof useWorkflowConnections>;onConnectionChange:(id:string)=>void}){return(<div className="studio-parameter-group">
          <h4>
            <IconPlugConnected size={16} />
            Connection
          </h4>
          <label>
            <span>{protocol === "mcp" ? "MCP server" : "API connection"}</span>
            <select
              aria-label={protocol === "mcp" ? "MCP server" : "API connection"}
              value={String(data.connectionId || "")}
              onChange={event => onConnectionChange(event.target.value)}
            >
              <option value="">
                {protocol === "mcp"
                  ? "Choose a configured server"
                  : "No authentication · public endpoint"}
              </option>
              {connections.data
                ?.filter(
                  (item) => item.kind === (protocol === "mcp" ? "mcp" : "http"),
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.authenticated ? " · credential managed" : ""}
                  </option>
                ))}
            </select>
          </label>
          <button type="button" className="ghost-button" disabled={connections.isFetching} onClick={() => void connections.refetch()}><IconRefresh size={14} />Refresh connections</button>
          {connections.isError ? (
            <p role="alert">
              Connections are unavailable.{" "}
              <button type="button" onClick={() => void connections.refetch()}>
                Retry
              </button>
            </p>
          ) : null}
          <p className="studio-caption">
            Credentials are resolved on the server.{" "}
            {protocol === "mcp"
              ? "Only tools enabled for this project can run."
              : "Authenticated and private APIs require a managed connection."}
          </p>
          <Link to={protocol === "mcp" ? "/mcp-servers" : "/integrations?provider=http"} target="_blank" rel="noreferrer" className="studio-caption">Manage this provider in Integrations</Link>
          {data.apiResource === "sprintStories" && <Link to="/admin-space?section=settings#api-keys" target="_blank" rel="noreferrer" className="studio-caption">Settings → API Keys</Link>}
          {data.credentialId || data.apiAuth ? (
            <p className="studio-notice">
              This node has a legacy credential binding. Select a managed
              connection to replace it.
            </p>
          ) : null}
        </div>);}
