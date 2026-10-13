# Architecture review and refactoring boundaries

The capability packages own feature behavior; Platform owns composition, authenticated scope and shared persistence infrastructure. Refactoring should preserve native contracts and permission decisions, remove verified duplication and keep historical execution evidence immutable. This is a scoped assessment, not certification that every source file satisfies SOLID or has been security audited.

## Implemented reusable boundaries

- The MCP gateway retrieves an authorized ContextPacket through the shared context backplane. Packet project identity is mandatory, caller deadlines cap transport time, and disconnect cancels request work. Model planning failure can produce a labelled retrieval fallback; it cannot broaden access.
- Repository pickers use one cancellable paginated reader. Page-boundary duplicates are removed, repeated full pages fail explicitly and there is no arbitrary total-row cutoff.
- Automation's reviewed grouping dialog is a presentation component. The grouping service owns ordering, application scope, atomic shared-source creation and reference synchronization. A failed nested write rolls back both the source and case references.
- Shared Section Groups reuse the native shared library, instruction editor and data contracts. Wording-only AI edits retain executable assets. Local/shared conversion preserves library records and frozen run snapshots.
- Sample data loads reviewed native JSON files through one manifest. SQL-constrained metadata is validated before writes; shared domain choices account for runtime bootstrap extensions. Checksums, relationship checks and transactional file retries remain authoritative.
- Debugging targets derive capability ownership from the service catalog. Inspector checks are read-only; normal attachment verifies the existing Compose stack and checks the host port before activation.

## Review criteria

Prefer extracting a shared contract or pure policy when independently used implementations must behave identically. Keep feature-specific permissions, persistence and failure semantics with their owning capability. Do not merge superficially similar callbacks when they have different domain rules. Do not delete production files based solely on line counts or clone reports.

Use [source layout](source-layout.md), [implementation boundaries](implementation-boundaries.md), [MCP architecture](mcp.md), [automation workflow](automation-workflow.md) and [verification](../development/verification.md). Source, module and package checks establish structural constraints; they do not prove provider quality, browser performance or complete security coverage.

## Remaining limits

AutomationPage still combines substantial workspace orchestration and needs incremental extraction with behavior checks. Mocked provider/browser fixtures cannot establish real model quality, live website completion or physical-device readiness. Repository size support also depends on configured upload/worker storage budgets. Existing backend suite failures must be compared by test identity before treating a regression run as successful. Authentication token lifecycle and distributed worker recovery remain separate review areas.
