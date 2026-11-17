import type { WorkflowOperationEditorProps } from "../operationEditorTypes";
import type {WorkflowConnection} from '../../../api.client';
import {workflowFieldInputs} from './fieldInputs';
import {sprintStoriesUrl} from '../../sprintStoriesUrl';
export function HttpRequestFields({data,onChange,projectId,triggerInput,connection,readOnly=false}:WorkflowOperationEditorProps&{connection?:WorkflowConnection;readOnly?:boolean}){const {field,select}=workflowFieldInputs(data,onChange);return(<>
          {select(
            "apiMethod",
            "HTTP method",
            (readOnly || data.apiResource === "sprintStories"
              ? ["GET"]
              : connection?.methods || ["GET", "HEAD"]
            ).map((value) => [value, value]),
            "GET",
          )}
          {data.apiResource === "sprintStories" ? <>
            <label><span>Endpoint URL</span><textarea aria-label="Endpoint URL" rows={3} readOnly spellCheck={false} value={sprintStoriesUrl(String(data.apiUrl || connection?.url || ""), projectId, String(triggerInput?.sprint_id || ""))} placeholder="Choose the HelloTest API connection" /></label>
            <p className="studio-caption">Current project and trigger Sprint. All cursor pages are read, up to 100 Stories. Larger Sprints stop with an explicit limit. Authentication uses the managed connection.</p>
          </> : field(
            "apiUrl",
            "Endpoint URL",
            false,
            "https://api.example.com/status",
          )}
          {!["GET", "HEAD"].includes(String(data.apiMethod || "GET"))
            ? field("apiBody", "Request body JSON", true)
            : null}
          <p className="studio-caption">
            Requests return the actual response as <code>data</code>. Redirects
            are not followed. Use <code>{"{{ $input.id }}"}</code> in the endpoint and <code>"$input.id"</code> in the JSON body.
            {!["GET", "HEAD", "OPTIONS"].includes(String(data.apiMethod || "GET")) ? " This request can change the remote system and runs once. If its response is lost, verify the saved operation receipt and remote outcome before sending it again." : ""}
          </p>
        </>);}
