import { useState } from "react";
import type { McpBuiltinTool, McpToolSet } from "../api.client";

type ToolSelection = { names: ReadonlySet<string>; onChange: (names: string[], selected: boolean) => void; disabled?: boolean };
const pageSize = 16;

export function McpToolCatalog({ tools, toolSets, selection }: {
  tools: McpBuiltinTool[];
  toolSets: McpToolSet[];
  selection?: ToolSelection;
}) {
  const [search, setSearch] = useState("");
  const [access, setAccess] = useState("all");
  const [toolSet, setToolSet] = useState("all");
  const [page, setPage] = useState(0);
  const query = search.trim().toLowerCase();
  const setTitles = new Map(toolSets.map(set => [set.id, set.title]));
  const matching = tools.filter(tool => {
    if (toolSet !== "all" && tool.tool_set !== toolSet) return false;
    if (access === "read" && !tool.read_only || access === "actions" && tool.read_only) return false;
    if (access === "selected" && !selection?.names.has(tool.name)) return false;
    return !query || `${tool.name} ${tool.title || ""} ${tool.description}`.toLowerCase().includes(query);
  });
  const totalPages = Math.max(1, Math.ceil(matching.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const start = currentPage * pageSize;
  const visible = matching.slice(start, start + pageSize);

  return <>
    <div className="mcp-tool-filters">
      <label className="form-field mcp-tool-search"><span>Search HelloTest tools</span><input type="search" value={search} placeholder="Name or capability" onChange={event => { setSearch(event.target.value); setPage(0); }} /></label>
      <label className="form-field"><span>Tool access</span><select aria-label="Tool access" value={access} onChange={event => { setAccess(event.target.value); setPage(0); }}>
        <option value="all">All tools</option><option value="read">Read only</option><option value="actions">Reviewed actions</option>
        {selection ? <option value="selected">Selected tools</option> : null}
      </select></label>
      {toolSets.length ? <label className="form-field"><span>Tool set</span><select aria-label="Tool set" value={toolSet} onChange={event => { setToolSet(event.target.value); setPage(0); }}>
        <option value="all">All tool sets</option>{toolSets.map(set => <option key={set.id} value={set.id}>{set.title}</option>)}
      </select></label> : null}
    </div>
    {selection && matching.length ? <div className="mcp-tool-selection-actions">
      <small>{matching.length} matching {matching.length === 1 ? "tool" : "tools"}</small>
      <div className="mcp-inline-actions">
        <button className="ghost-button compact" type="button" disabled={selection.disabled || visible.every(tool => selection.names.has(tool.name))} onClick={() => selection.onChange(visible.map(tool => tool.name), true)}>Select shown</button>
        <button className="ghost-button compact" type="button" disabled={selection.disabled || !visible.some(tool => selection.names.has(tool.name))} onClick={() => selection.onChange(visible.map(tool => tool.name), false)}>Clear shown</button>
      </div>
    </div> : null}
    <div className="mcp-tool-list">
      {visible.map(tool => {
        const selected = selection?.names.has(tool.name) ?? false;
        const setName = tool.tool_set ? setTitles.get(tool.tool_set) || tool.tool_set : "";
        return <article className="mcp-tool-row" key={tool.name} data-selected={selected || undefined}>
          <div className="mcp-tool-row-heading">
            {selection ? <label className="mcp-tool-choice">
              <input aria-label={`Select ${tool.name}`} type="checkbox" checked={selected} disabled={selection.disabled} onChange={event => selection.onChange([tool.name], event.target.checked)} />
              <span><code>{tool.name}</code>{tool.title && tool.title !== tool.name ? <small>{tool.title}</small> : null}</span>
            </label> : <span className="mcp-tool-name"><code>{tool.name}</code>{tool.title && tool.title !== tool.name ? <small>{tool.title}</small> : null}</span>}
            <small className="mcp-tool-access" data-action={!tool.read_only || undefined}>{tool.read_only ? "Read only" : "Reviewed action"}</small>
          </div>
          {selection ? <details className="mcp-tool-details"><summary>Tool details</summary><p>{tool.description}</p>{setName ? <small>{setName}</small> : null}</details>
            : <><p>{tool.description}</p>{setName ? <small>{setName}</small> : null}</>}
          {!selection && (tool.input_schema || tool.output_schema) ? <div className="mcp-tool-contracts">
            {tool.input_schema ? <details><summary>Input contract</summary><pre>{JSON.stringify(tool.input_schema, null, 2)}</pre></details> : null}
            {tool.output_schema ? <details><summary>Output contract</summary><pre>{JSON.stringify(tool.output_schema, null, 2)}</pre></details> : null}
          </div> : null}
        </article>;
      })}
    </div>
    {!visible.length ? <p className="mcp-muted" role="status">No tools match these filters.</p> : null}
    {matching.length > pageSize ? <div className="mcp-tool-pagination">
      <small role="status">{start + 1}–{start + visible.length} of {matching.length} tools</small>
      <div className="mcp-inline-actions">
        <button className="ghost-button compact" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <button className="ghost-button compact" type="button" disabled={currentPage + 1 === totalPages} onClick={() => setPage(currentPage + 1)}>Next</button>
      </div>
    </div> : null}
  </>;
}
