import type { KnowledgeAssistantMessage, KnowledgeAssistantSession } from "@hellotest/platform/frontend/src/types";
import { knowledgeCitationHref, validateKnowledgeAnswer } from "./knowledgeAnswer";

const searchable = (text: string) => text.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();

export function findAssistantConversations(sessions: KnowledgeAssistantSession[], query: string) {
  const terms = searchable(query).trim().split(/\s+/).filter(Boolean);
  return sessions.filter(session => session.status !== "archived" && terms.every(term => searchable(session.title || "Project conversation").includes(term))).slice(0, 200);
}

/** Copy what was actually displayed, excluding unsupported claims and inaccessible citations. */
export function assistantMessageMarkdown(message: KnowledgeAssistantMessage) {
  if (message.role === "user") return message.content;
  const answer = validateKnowledgeAnswer(message);
  if (message.answer_contract && !answer) return "This answer could not be exported because its evidence contract is unsupported.";
  const citations = answer ? Array.from(answer.citations.values()) : message.citations || [];
  const sections = answer ? answer.claims.map(claim => `${claim.classification === "INTERPRETATION" ? "Interpretation: " : ""}${claim.text}${claim.evidenceIds.map(id => ` [${citations.findIndex(source => (source.evidence_id || source.id) === id) + 1}]`).join("")}`) : [message.content];
  if (answer && !sections.length && answer.summary) sections.push(answer.summary);
  if (answer) {
    const p = answer.presentation.payload;
    const cell = (value: unknown) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
    if (["TABLE", "COMPARISON"].includes(answer.presentation.type)) {
      const columns = p.columns as Array<{ key: string; label: string }> || [];
      const rows = p.rows as Array<{ cells: Record<string, string> }> || [];
      sections.push([`| ${columns.map(c => cell(c.label)).join(" | ")} |`, `| ${columns.map(() => "---").join(" | ")} |`, ...rows.map(row => `| ${columns.map(c => cell(row.cells[c.key])).join(" | ")} |`)].join("\n"));
    }
    if (["TIMELINE", "METRIC"].includes(answer.presentation.type)) {
      const items = p.items as Array<{ date?: string; title?: string; description?: string; label?: string; value?: string; unit?: string }> || [];
      sections.push(items.map(item => `- ${[item.date, item.title || item.label, item.description || item.value, item.unit].filter(Boolean).join(" · ")}`).join("\n"));
    }
    if (answer.presentation.type === "RELATIONSHIP_GRAPH") {
      const nodes = p.nodes as Array<{ id: string; label: string }> || [];
      const edges = p.edges as Array<{ source: string; target: string; type: string }> || [];
      sections.push(edges.map(edge => `- ${nodes.find(node => node.id === edge.source)?.label || edge.source} → ${edge.type.replace(/_/g, " ")} → ${nodes.find(node => node.id === edge.target)?.label || edge.target}`).join("\n"));
    }
    if (answer.gaps.length) sections.push(`Evidence gaps\n${answer.gaps.map(gap => `- ${gap}`).join("\n")}`);
    if (message.safety?.extractive_grounded_fallback) sections.unshift("The model could not complete an answer. The following content is retrieved evidence, not a generated conclusion.");
  }
  const sources = citations.map((source, index) => {
    const href = knowledgeCitationHref(source);
    return `${index + 1}. ${source.title || source.label || "Project source"}${href ? ` — ${href}` : ""}`;
  });
  if (sources.length) sections.push(`Sources\n${sources.join("\n")}`);
  return sections.filter(Boolean).join("\n\n");
}

/** Export the visible conversation and its actual citations, without model setup or credentials. */
export function assistantConversationMarkdown(messages: KnowledgeAssistantMessage[]) {
  return ["# HelloTest project conversation", ...messages.map(message => {
    return [`## ${message.role === "user" ? "You" : "HelloTest"}`, assistantMessageMarkdown(message),
      message.status && message.status !== "complete" ? `Turn status: ${message.status}` : ""].filter(Boolean).join("\n\n");
  })].join("\n\n") + "\n";
}
