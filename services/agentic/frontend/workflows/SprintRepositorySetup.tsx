import { useQuery } from "@tanstack/react-query";
import { integrationApi } from "@hellotest/integration/frontend/api.client";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { sprintRepositorySource } from "./sprintAutomatorInput";

type Props = {
  projectId: string;
  input: Record<string, unknown>;
  onInput: (value: string) => void;
  disabled: boolean;
  canViewConnections: boolean;
};

export function SprintRepositorySetup({ projectId, input, onInput, disabled, canViewConnections }: Props) {
  const original = input.source && typeof input.source === "object" && !Array.isArray(input.source)
    ? input.source as Record<string, unknown> : {};
  const source = {
    type: "github",
    repository_url: typeof original.repository_url === "string" ? original.repository_url : "",
    ref: typeof original.ref === "string" ? original.ref : "",
    integration_id: typeof original.integration_id === "string" ? original.integration_id : "",
  };
  const connections = useQuery({
    queryKey: ["workflow-sprint-github", projectId],
    queryFn: ({ signal }) => integrationApi.integrations.list({ type: "github" }, { signal }),
    enabled: Boolean(projectId && canViewConnections),
    staleTime: 60_000,
  });
  const options = asArray(connections.data).filter(item => item.type === "github" && item.config?.project_id === projectId && item.is_active);
  const update = (patch: Partial<typeof source>) => {
    const next = { ...input };
    const value = { ...source, ...patch };
    if (value.repository_url || value.ref || value.integration_id) next.source = value;
    else delete next.source;
    onInput(JSON.stringify(next, null, 2));
  };
  const selectConnection = (id: string) => {
    const connection = options.find(item => item.id === id)?.config;
    update({
      integration_id: id,
      ...(!source.repository_url && connection?.owner && connection.repo ? { repository_url: `https://github.com/${connection.owner}/${connection.repo}` } : {}),
      ...(!source.ref && typeof connection?.branch === "string" ? { ref: connection.branch } : {}),
    });
  };
  return <details className="sprint-repository-setup">
    <summary>Repository source <span>Optional</span></summary>
    <fieldset disabled={disabled}>
      <label className="form-field"><span>GitHub repository URL</span>
        <input type="url" value={source.repository_url} maxLength={512} placeholder="https://github.com/org/repository"
          onChange={event => update({ repository_url: event.target.value })} />
      </label>
      <label className="form-field"><span>Branch, tag or commit</span>
        <input value={source.ref} maxLength={255} placeholder="Default branch"
          onChange={event => update({ ref: event.target.value })} />
      </label>
      <label className="form-field"><span>GitHub connection</span>
        <select value={source.integration_id} disabled={!canViewConnections || connections.isPending} onChange={event => selectConnection(event.target.value)}>
          <option value="">Public repository</option>
          {source.integration_id && !options.some(item => item.id === source.integration_id) && <option value={source.integration_id}>Current connection</option>}
          {options.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    </fieldset>
    {connections.isError && <p role="alert">GitHub connections are unavailable. <button type="button" className="text-button" onClick={() => void connections.refetch()}>Retry</button></p>}
    {source.repository_url && !sprintRepositorySource(source) && <p className="sprint-setup-error">Enter a GitHub repository URL without credentials or query parameters.</p>}
  </details>;
}
