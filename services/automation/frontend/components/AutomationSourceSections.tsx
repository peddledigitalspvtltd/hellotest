import type { TestStep } from "@hellotest/platform/frontend/src/types";
import { CopyIcon, PencilIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { formatAutomationSourceLines } from "../lib/automationInstructions";
import "./AutomationSourceSections.css";

export function automationSectionSource(step: TestStep) {
  const title = richTextToPlainText(step.action || "") || `Section ${step.step_order}`;
  const label = `${step.step_order}. ${title}`.replace(/[\r\n\u2028\u2029]/g, " ");
  const body = step.step_type === "api"
    ? step.api_request ? JSON.stringify(step.api_request, null, 2) : "// No valid API request is configured."
    : formatAutomationSourceLines(step.automation_code || "").trim();
  return `// #region ${label}\n${body || "// No executable instructions saved."}\n// #endregion`;
}

/** Source stays aligned with the draft section; the full export owns its runnable suite wrapper. */
export function AutomationSourceSections({ steps, onCopy, onEdit }: { steps: TestStep[]; onCopy: (source: string) => void; onEdit?: (step: TestStep) => void }) {
  return <section className="automation-source-sections" aria-label="Automation section source">
    {steps.map(step => <details className="automation-source-section" key={step.id} open>
      <summary><span className="automation-source-chevron" aria-hidden="true">›</span><span className="automation-source-section-title"><strong>{step.step_order}. {richTextToPlainText(step.action || "") || "Untitled section"}</strong>{step.group_name ? <small>{step.group_name}</small> : null}</span><span className="automation-source-language">{step.step_type === "api" ? "API · JSON" : step.step_type === "android" || step.step_type === "ios" ? `${step.step_type.toUpperCase()} · JavaScript` : "Playwright · JavaScript"}</span><button className="ghost-button compact" type="button" disabled={step.step_type === "api" && !step.api_request} aria-label={`Copy source for section ${step.step_order}`} onClick={event => { event.preventDefault(); event.stopPropagation(); onCopy(automationSectionSource(step)); }}><CopyIcon size={14}/><span>Copy</span></button>
        {onEdit ? <button className="ghost-button compact" type="button" aria-label={`Edit source for section ${step.step_order}`} title="Edit source" onClick={event => { event.preventDefault(); event.stopPropagation(); onEdit(step); }}><PencilIcon size={14}/></button> : null}
      </summary>
      <pre className="automation-source-section-code"><code>{automationSectionSource(step)}</code></pre>
    </details>)}
    {!steps.length ? <p className="muted">No sections have been saved.</p> : null}
  </section>;
}
