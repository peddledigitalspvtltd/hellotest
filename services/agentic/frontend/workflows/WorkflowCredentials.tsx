import type { AgenticCredential } from "./workflowGraph";
import { AGENT_AUTH_TYPES, AGENT_CREDENTIAL_LOCATIONS } from "./workflowGraph";

export function WorkflowCredentials({
  value,
  disabled,
  onChange,
}: {
  value: AgenticCredential[];
  disabled: boolean;
  onChange: (next: AgenticCredential[]) => void;
}) {
  const update = (id: string, patch: Partial<AgenticCredential>) =>
    onChange(
      value.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  return (
    <details className="studio-credentials">
      <summary>API credential references ({value.length})</summary>
      <p className="studio-caption">
        Used by explicit API tests and preview definitions. Store secret
        references here, never raw passwords or tokens.
      </p>
      <fieldset disabled={disabled}>
        {value.map((item) => (
          <article key={item.id}>
            <label>
              <span>Credential name</span>
              <input
                value={item.name}
                onChange={(event) =>
                  update(item.id, { name: event.target.value })
                }
              />
            </label>
            <label>
              <span>Authentication type</span>
              <select
                value={item.authType}
                onChange={(event) =>
                  update(item.id, {
                    authType: event.target
                      .value as AgenticCredential["authType"],
                  })
                }
              >
                {AGENT_AUTH_TYPES.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Location</span>
              <select
                value={item.location}
                onChange={(event) =>
                  update(item.id, {
                    location: event.target
                      .value as AgenticCredential["location"],
                  })
                }
              >
                {AGENT_CREDENTIAL_LOCATIONS.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Header or parameter name</span>
              <input
                value={item.keyName}
                onChange={(event) =>
                  update(item.id, { keyName: event.target.value })
                }
              />
            </label>
            <label>
              <span>Secret reference</span>
              <input
                value={item.secretReference}
                onChange={(event) =>
                  update(item.id, { secretReference: event.target.value })
                }
                autoComplete="off"
              />
            </label>
            {!disabled && (
              <button
                type="button"
                className="ghost-button"
                onClick={() =>
                  onChange(
                    value.filter((credential) => credential.id !== item.id),
                  )
                }
              >
                Remove credential
              </button>
            )}
          </article>
        ))}
        {!disabled && (
          <button
            type="button"
            className="ghost-button"
            onClick={() =>
              onChange([
                ...value,
                {
                  id: crypto.randomUUID(),
                  name: "API credential",
                  agentId: "",
                  authType: "apiKey",
                  location: "header",
                  keyName: "Authorization",
                  secretReference: "",
                  description: "",
                },
              ])
            }
          >
            Add credential reference
          </button>
        )}
      </fieldset>
    </details>
  );
}
