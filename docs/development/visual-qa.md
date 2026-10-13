# Visual and interaction verification

Use the actual feature components with production CSS and isolated API fixtures. Avoid modifying a user's signed-in project while investigating layout. The in-app Browser is preferred when available; the checked-in Playwright harness provides component-level browser verification when it is unavailable.

## Coverage

Check desktop and narrow mobile layouts in light and dark themes. Verify heading hierarchy, focus return, Escape and outside-click dismissal, scroll containment, footer reachability and visible errors. Selection and conversion dialogs must show the reviewed scope before persistence. Saving, retrying and changing scope must preserve the user's draft or disclose its replacement.

For Automation, verify the local-agent status shares the title line, section tools stay in their header, chevrons show/hide instructions and platform icons retain accessible names. Test grouping of adjacent sections, rejection of discontinuous selection and conversion through reviewed dialogs. Shared Section Groups reuse the normal library grid/list, search, filter and creation flows.

For Product Management, verify overdue Sprint text is red in both themes, entity metrics use full server evidence and loading/unavailable states are distinct from zero. For chatbot and AI output, verify paragraphs, headings, lists, tables and code are formatted without executing provider HTML. Test partial streams, retries and permission changes.

## Reproduction

Follow [browser tests](../../services/platform/frontend/test/browser/README.md) and [verification](verification.md). Run browser checks sequentially after builds or fixture changes finish to avoid Vite reload races. Retain screenshots only as labelled evidence of the tested revision and viewport; a previous screenshot or local deployment is not current acceptance proof. Model and authentication fixtures do not verify a live provider or customer account.
