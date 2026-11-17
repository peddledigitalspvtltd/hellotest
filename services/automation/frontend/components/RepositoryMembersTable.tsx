import { useMemo } from "react";
import { DataTable, type DataTableColumn } from "@hellotest/platform/frontend/src/shared/components/DataTable";
import { Button } from "@hellotest/platform/frontend/src/shared/components/Button";
import type { AutomationLearningCacheEntry } from "@hellotest/platform/frontend/src/types";
import "./RepositoryMembersTable.css";

export type RepositoryTableMember = { entry: AutomationLearningCacheEntry; memberName: string; htmlTag: string; role: string };

/** Repository fields share sorting, column sizing and keyboard behavior with case tables. */
export function RepositoryMembersTable({ members, selectedId, highlightedId, onSelect, emptyMessage = "No saved fields yet. Add a field or inspect the screen." }: {
  members: RepositoryTableMember[]; selectedId?: string; highlightedId?: string; onSelect: (id: string) => void; emptyMessage?: string;
}) {
  const columns = useMemo<DataTableColumn<RepositoryTableMember>[]>(() => [
    { key: "field", label: "Field", sortValue: member => member.memberName, render: member => <Button variant="plain" aria-pressed={selectedId === member.entry.id} onClick={event => { event.stopPropagation(); onSelect(member.entry.id); }}><code>{member.memberName}</code></Button> },
    { key: "type", label: "Type", sortValue: member => `${member.htmlTag} ${member.role}`, render: member => <span>{member.htmlTag} · {member.role}</span> },
    { key: "locator", label: "Primary locator", sortValue: member => member.entry.locator, render: member => <code className="repository-member-locator">{member.entry.locator}</code> }
  ], [selectedId, onSelect]);
  return <div className="repository-members-table"><DataTable columns={columns} rows={members} emptyMessage={emptyMessage} storageKey="automation-repository-members" getRowKey={member => member.entry.id} onRowClick={member => onSelect(member.entry.id)} getRowClassName={member => `${member.entry.id === selectedId ? "is-active" : ""}${member.entry.id === highlightedId ? " is-highlighted" : ""}`} includeDiscoveredColumns={false} /></div>;
}
