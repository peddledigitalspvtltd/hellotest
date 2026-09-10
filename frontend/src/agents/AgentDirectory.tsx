import { useMemo, useState } from "react";
import { IconArrowRight, IconBookmark, IconCheck, IconSearch, IconSparkles } from "@tabler/icons-react";
import { HELLOTEST_AGENT_CATALOG, type HelloTestAgent } from "../components/AgenticExperience";
import { REPOSITORY_AGENTS } from "./RepositoryAgents";
import type { RepositoryAgentType } from "./types";
import { AGENT_CATEGORIES, AGENT_EXPERIENCES } from "./agentExperience";
import "./AgentWorkspace.css";

const entries = [
  ...REPOSITORY_AGENTS.map(agent => ({ id: agent.id, name: agent.name, icon: agent.icon, builder: true })),
  ...HELLOTEST_AGENT_CATALOG.map(agent => ({ id: agent.id, name: agent.name, icon: agent.icon, builder: false }))
];
const starterTasks = [
  { id: "test-designer", label: "Close a coverage gap", detail: "Find scenarios worth adding" },
  { id: "failure-analyst", label: "Understand a failure", detail: "Find evidence and next checks" },
  { id: "repository_knowledge", label: "Understand a repository", detail: "Build searchable source knowledge" }
];

export function AgentDirectory({ userId, onOpenRepository, onOpenSpecialist }: {
  userId: string;
  onOpenRepository: (id: RepositoryAgentType) => void;
  onOpenSpecialist: (agent: HelloTestAgent) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const preferenceKey = `hellotest.agents.pinned:${userId}`;
  const [pinned, setPinned] = useState<string[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem(preferenceKey) || "[]"); return Array.isArray(saved) ? saved.filter(id => entries.some(entry => entry.id === id)) : []; } catch { return []; }
  });
  const open = (id: string) => {
    const specialist = HELLOTEST_AGENT_CATALOG.find(agent => agent.id === id);
    if (specialist) onOpenSpecialist(specialist); else onOpenRepository(id as RepositoryAgentType);
  };
  const filtered = useMemo(() => entries.filter(agent => {
    const experience = AGENT_EXPERIENCES[agent.id];
    return (category === "all" || category === "pinned" ? category !== "pinned" || pinned.includes(agent.id) : category === experience.category)
      && [agent.name, experience.outcome, experience.inputs, experience.output].join(" ").toLowerCase().includes(search.trim().toLowerCase());
  }).sort((a, b) => Number(pinned.includes(b.id)) - Number(pinned.includes(a.id))), [category, pinned, search]);
  const togglePin = (id: string) => setPinned(current => {
    const next = current.includes(id) ? current.filter(value => value !== id) : [...current, id];
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)); } catch { /* Pins remain available during this session. */ }
    return next;
  });

  return <div className="agent-directory">
    <section className="agent-start" aria-labelledby="agent-start-title">
      <div><span className="agent-eyebrow">Start with an outcome</span><h2 id="agent-start-title">What needs your attention?</h2><p>Choose a task, bring the right context and review the result.</p></div>
      <div className="agent-start-actions">{starterTasks.map(task => <button key={task.id} type="button" onClick={() => open(task.id)}><span><strong>{task.label}</strong><small>{task.detail}</small></span><IconArrowRight size={18} aria-hidden="true" /></button>)}</div>
    </section>
    <section className="agent-library" aria-labelledby="agent-library-title">
      <header className="agent-library-heading"><div><h2 id="agent-library-title">Agent library <span>{entries.length}</span></h2><p>Source builders create assets. Workspace specialists prepare evidence-based briefs.</p></div><label className="agent-library-search"><IconSearch size={18} aria-hidden="true" /><input aria-label="Search agents" placeholder="Search agent, task or outcome" value={search} onChange={event => setSearch(event.target.value)} />{search && <button type="button" aria-label="Clear agent search" onClick={() => setSearch("")}>Clear</button>}</label></header>
      <div className="agent-library-filters" role="group" aria-label="Filter agents by purpose">
        {[{ id: "all", label: "All agents" }, ...AGENT_CATEGORIES, { id: "pinned", label: "Pinned" }].map(filter => <button key={filter.id} type="button" aria-pressed={category === filter.id} onClick={() => setCategory(filter.id)}>{filter.id === "pinned" && <IconBookmark size={14} aria-hidden="true" />}{filter.label}<span>{filter.id === "all" ? entries.length : filter.id === "pinned" ? pinned.length : entries.filter(entry => AGENT_EXPERIENCES[entry.id].category === filter.id).length}</span></button>)}
      </div>
      <p className="sr-only" role="status">{filtered.length} agents found</p>
      <div className="agent-library-grid">{filtered.map(agent => {
        const experience = AGENT_EXPERIENCES[agent.id];
        return <article className="agent-library-card" data-category={experience.category} data-agent={agent.id} key={agent.id}>
          <header><span className="agent-library-icon">{agent.icon}</span><span className="agent-library-kind">{agent.builder ? "Source builder" : "Workspace specialist"}</span><button className="agent-pin" type="button" aria-label={`${pinned.includes(agent.id) ? "Unpin" : "Pin"} ${agent.name}`} aria-pressed={pinned.includes(agent.id)} onClick={() => togglePin(agent.id)}><IconBookmark size={17} fill={pinned.includes(agent.id) ? "currentColor" : "none"} aria-hidden="true" /></button></header>
          <div className="agent-library-copy"><h3>{agent.name}</h3><p>{experience.outcome}</p></div>
          <dl><div><dt>Uses</dt><dd>{experience.inputs}</dd></div><div><dt>Delivers</dt><dd>{experience.output}</dd></div></dl>
          <footer><small>{agent.builder ? <IconCheck size={14} aria-hidden="true" /> : <IconSparkles size={14} aria-hidden="true" />}{agent.builder ? "Publish after review" : "Review brief"}</small><button className="ghost-button" type="button" aria-label={`Open ${agent.name}`} onClick={() => open(agent.id)}>Open agent <IconArrowRight size={16} aria-hidden="true" /></button></footer>
        </article>;
      })}</div>
      {!filtered.length && <div className="agent-library-empty"><IconSearch size={26} aria-hidden="true" /><h3>{category === "pinned" && !search ? "Keep your regular agents close" : "No matching agents"}</h3><p>{category === "pinned" && !search ? "Pin an agent from the library to find it here." : "Try another task or clear the filters to see all agents."}</p><button className="ghost-button" type="button" onClick={() => { setSearch(""); setCategory("all"); }}>Show all agents</button></div>}
    </section>
  </div>;
}
