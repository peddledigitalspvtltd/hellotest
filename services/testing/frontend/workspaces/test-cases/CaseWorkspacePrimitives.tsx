import { type TestCaseAuthoringLens, type AuthoringStepProjection } from "./testCaseWorkspaceTypes";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { CollapseExpandIcon, TagIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { RichTextContent, richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { AutomationCodeIcon } from "@hellotest/automation/frontend/components/StepAutomationEditor";
import { useDomainSuggestions } from "@hellotest/platform/frontend/src/platform/hooks/useDomainOptions";
import { resolveDomainSuggestionValue } from "@hellotest/platform/frontend/src/platform/lib/domainOptions";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { canEditAutomationCode as resolveCanEditAutomationCode, canViewAutomationCode as resolveCanViewAutomationCode } from "@hellotest/automation/frontend/lib/automationAccess";
import { formatReferenceList, parseReferenceList } from "@hellotest/platform/frontend/src/shared/lib/externalReferences";
import { normalizeApiRequest, normalizeStepType, stepHasAutomation } from "@hellotest/automation/frontend/lib/stepAutomation";
import type { AutomationLearningCacheEntry } from "@hellotest/platform/frontend/src/types";

export function CaseLabelsField({
  value,
  onChange,
  availableLabels,
  domainField = "test_cases.labels"
}: {
  domainField?: string;
  value: string;
  onChange: (value: string) => void;
  availableLabels: string[];
}) {
  const suggestedLabels = useDomainSuggestions(domainField, availableLabels);
  const [draftLabel, setDraftLabel] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const inputId = `case-label-${useId().replace(/:/g, "")}`;
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const selectedLabels = useMemo(() => parseReferenceList(value), [value]);
  const filteredLabels = useMemo(() => {
    const search = draftLabel.trim().toLowerCase();
    const selected = new Set(selectedLabels.map((label) => label.toLowerCase()));
    return suggestedLabels
      .filter((label) => !selected.has(label.value.toLowerCase()))
      .filter((label) => !search || `${label.label} ${label.value}`.toLowerCase().includes(search));
  }, [suggestedLabels, draftLabel, selectedLabels]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node | null)) {
        setIsMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const commitLabel = (label: string) => {
    const normalizedLabel = resolveDomainSuggestionValue(label, suggestedLabels);

    if (!normalizedLabel) {
      return;
    }

    if (!selectedLabels.some((item) => item.toLowerCase() === normalizedLabel.toLowerCase())) {
      onChange(formatReferenceList([...selectedLabels, normalizedLabel]));
    }

    setDraftLabel("");
    setIsMenuOpen(false);
  };

  const removeLabel = (labelToRemove: string) => {
    onChange(formatReferenceList(selectedLabels.filter((label) => label.toLowerCase() !== labelToRemove.toLowerCase())));
  };

  return (
    <FormField className="canonical-labels-field" composite inputId={inputId} label="Labels" labelIcon={<TagIcon size={15} />}>
      <div className="requirement-label-picker" ref={pickerRef}>
        <div className="requirement-label-combobox">
          <div className="requirement-label-entry">
            <input
              aria-autocomplete="list"
              aria-expanded={isMenuOpen}
              aria-label="Select or add labels"
              id={inputId}
              placeholder="Select or add label"
              role="combobox"
              value={draftLabel}
              onChange={(event) => {
                setDraftLabel(event.target.value);
                setIsMenuOpen(true);
              }}
              onFocus={() => setIsMenuOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitLabel(draftLabel);
                }

                if (event.key === "Escape") {
                  setIsMenuOpen(false);
                }
              }}
            />
            {draftLabel.trim() ? (
              <button className="ghost-button requirement-label-add-button" onClick={() => commitLabel(draftLabel)} type="button">
                Add
              </button>
            ) : null}
          </div>
          {isMenuOpen && (filteredLabels.length || draftLabel.trim()) ? (
            <div className="requirement-label-menu" role="listbox" aria-label="Available labels">
              {filteredLabels.map((label) => (
                <button className="requirement-label-menu-option" key={label.value} onClick={() => commitLabel(label.value)} role="option" type="button">
                  {label.label}
                </button>
              ))}
              {draftLabel.trim() && !filteredLabels.some((label) => [label.value, label.label].some(value => value.toLowerCase() === draftLabel.trim().toLowerCase())) ? (
                <button className="requirement-label-menu-option is-add" onClick={() => commitLabel(draftLabel)} role="option" type="button">
                  Add "{draftLabel.trim()}"
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {selectedLabels.length ? (
          <div className="requirement-label-chip-row">
            {selectedLabels.map((label) => (
              <span className="requirement-label-chip" key={label}>
                {label}
                <button aria-label={`Remove ${label}`} onClick={() => removeLabel(label)} type="button">x</button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </FormField>
  );
}

export function AutomationScriptLens({
  lens,
  steps,
  code,
  onEditStep
}: {
  lens: Exclude<TestCaseAuthoringLens, "manual">;
  steps: AuthoringStepProjection[];
  code: string;
  onEditStep: (stepId: string) => void;
}) {
  const { session } = useAuth();
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const canViewAutomationCode = resolveCanViewAutomationCode(session, featureFlagsQuery.data);
  const canEditAutomationCode = resolveCanEditAutomationCode(session, featureFlagsQuery.data);
  const title = lens === "api-script" ? "API script" : "UI automation script";
  const emptyCopy = lens === "api-script"
    ? "No API steps are present yet. Change a step type to API or import a Postman collection to author request-level coverage."
    : "No UI or mobile steps are present yet. Add web, Android, or iOS steps to create executable UI coverage.";

  if (!canViewAutomationCode) return null;

  return (
    <div className="automation-script-lens">
      <div className="automation-script-map" aria-label={`${title} step map`}>
        {steps.length ? (
          steps.map((step) => {
            const stepType = normalizeStepType(step.step_type);
            const hasSavedAutomation = stepHasAutomation(step);
            const request = normalizeApiRequest(step.api_request);
            const subtitle = stepType === "api" && request
              ? `${request.method || "GET"} ${request.url || "No URL"}`
              : richTextToPlainText(step.expected_result || "") || "No expected result written yet";

            return (
              <article className="automation-script-step" key={step.id}>
                <div className="automation-script-step-copy">
                  <div className="automation-script-step-head">
                    <span className={hasSavedAutomation ? "automation-script-step-status is-ready" : "automation-script-step-status"}>
                      {hasSavedAutomation ? "Ready" : "Generated"}
                    </span>
                    <strong>Step {step.step_order}</strong>
                    <span>{stepType.toUpperCase()}</span>
                  </div>
                  <RichTextContent as="p" fallback="No manual action written yet" value={step.action} />
                  <small>{subtitle}</small>
                </div>
                {canEditAutomationCode ? (
                  <button className="ghost-button compact" onClick={() => onEditStep(step.id)} type="button">
                    <AutomationCodeIcon />
                    <span>Edit</span>
                  </button>
                ) : null}
              </article>
            );
          })
        ) : (
          <div className="empty-state compact">{emptyCopy}</div>
        )}
      </div>

      <div className="automation-script-code-panel">
        <div className="automation-script-code-head">
          <strong>{title}</strong>
          <span>{steps.length} mapped step{steps.length === 1 ? "" : "s"}</span>
        </div>
        <pre className="automation-script-code"><code>{code}</code></pre>
      </div>
    </div>
  );
}

export function AutomationLearningMemory({ entries }: { entries: AutomationLearningCacheEntry[] }) {
  const readMetaText = (entry: AutomationLearningCacheEntry, key: string) => {
    const value = entry.metadata?.[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const isNonElementEntry = (entry: AutomationLearningCacheEntry) => {
    const locator = String(entry.locator || "").trim().toLowerCase();
    const intent = String(entry.locator_intent || "").trim().toLowerCase();
    const role = readMetaText(entry, "object_role").toLowerCase();
    const blockedLocators = new Set(["viewport", "location", "browser.tab", "keyboard", "window", "document", "page"]);
    const blockedIntents = new Set(["scroll", "navigation", "navigate", "goto", "tab", "press"]);

    return blockedLocators.has(locator) || blockedIntents.has(intent) || role === "viewport" || role === "page";
  };
  const toTitleText = (value: string) => {
    const normalized = value
      .replace(/^[#.]+/, "")
      .replace(/\[[^\]]+\]/g, " ")
      .replace(/[_./:-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) {
      return "";
    }

    return normalized
      .split(" ")
      .filter(Boolean)
      .slice(0, 6)
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(" ");
  };
  const toPascalCase = (value: string) => {
    const normalized = value.replace(/https?:\/\//i, "").replace(/[^A-Za-z0-9]+/g, " ").trim();
    const tokens = normalized ? normalized.split(/\s+/) : ["Page"];
    const name = tokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join("");
    return name.toLowerCase().endsWith("page") ? name : `${name}Page`;
  };
  const getObjectLabel = (entry: AutomationLearningCacheEntry) => {
    const metadataLabel =
      readMetaText(entry, "object_label") ||
      readMetaText(entry, "field_name") ||
      readMetaText(entry, "name");
    const objectName = readMetaText(entry, "object_name");
    const objectNameTail = objectName.includes(".") ? objectName.split(".").filter(Boolean).pop() || "" : objectName;
    const intent = String(entry.locator_intent || "").trim();
    const genericIntent = ["click", "fill", "change", "select", "check", "uncheck", "submit", "object"].includes(intent.toLowerCase()) ? "" : intent;
    const locatorAttr =
      String(entry.locator || "").match(/\[(?:aria-label|name|id|data-testid|placeholder)=["']?([^"'\]]+)["']?\]/i)?.[1] ||
      String(entry.locator || "").match(/^#([\w-]+)/)?.[1] ||
      String(entry.locator || "").match(/text=["']?([^"']+)["']?/i)?.[1] ||
      "";

    return toTitleText(metadataLabel || objectNameTail || genericIntent || locatorAttr || "HTML element");
  };
  const getHtmlTag = (entry: AutomationLearningCacheEntry) => {
    const metadataTag =
      readMetaText(entry, "html_tag") ||
      readMetaText(entry, "tag_name") ||
      readMetaText(entry, "tag") ||
      readMetaText(entry, "element_tag");
    const domStructure = readMetaText(entry, "dom_structure") || readMetaText(entry, "dom_path") || readMetaText(entry, "html");
    const domTag = domStructure.match(/<\s*([a-z][a-z0-9-]*)/i)?.[1] || "";
    const locatorTag = String(entry.locator || "").match(/^([a-z][a-z0-9-]*)[#.[\s]/i)?.[1] || "";
    const role = (readMetaText(entry, "object_role") || entry.locator_kind || entry.locator_intent || "").toLowerCase();

    if (metadataTag) {
      return metadataTag.toLowerCase();
    }

    if (domTag) {
      return domTag.toLowerCase();
    }

    if (locatorTag) {
      return locatorTag.toLowerCase();
    }

    if (role.includes("textbox") || role.includes("field") || role.includes("fill") || role.includes("input")) {
      return "input";
    }

    if (role.includes("dropdown") || role.includes("select") || role.includes("combobox")) {
      return "select";
    }

    if (role.includes("link")) {
      return "a";
    }

    if (role.includes("button") || role.includes("click") || role.includes("submit")) {
      return "button";
    }

    return "element";
  };
  const getTagDetail = (entry: AutomationLearningCacheEntry) => {
    const tag = getHtmlTag(entry);
    const locator = String(entry.locator || "").trim();
    const locatorId = locator.match(/^#([\w-]+)/)?.[1] || locator.match(/\bid=["']?([^"'\]\s>]+)/i)?.[1] || "";
    const locatorName = locator.match(/\bname=["']?([^"'\]\s>]+)/i)?.[1] || "";
    const role = readMetaText(entry, "object_role");
    const qualifier = locatorId ? `#${locatorId}` : locatorName ? `[name="${locatorName}"]` : role ? `[role="${role}"]` : "";

    return `${tag}${qualifier}`;
  };
  const elementEntries = entries
    .filter((entry) => !isNonElementEntry(entry))
    .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0) || Number(right.hit_count || 0) - Number(left.hit_count || 0));
  const pageObjects = Array.from(elementEntries.reduce<Map<string, AutomationLearningCacheEntry[]>>((map, entry) => {
    const screen = readMetaText(entry, "screen_name") || entry.page_key || "UnassignedPage";
    map.set(screen, [...(map.get(screen) || []), entry]);
    return map;
  }, new Map()).entries()).slice(0, 4);
  const strongEntries = elementEntries.filter((entry) => Number(entry.confidence) >= 0.8).length;

  return (
    <details className="automation-learning-memory">
      <summary className="automation-learning-memory-head">
        <div>
          <strong>Object repository</strong>
          <span>
            {elementEntries.length
              ? `${elementEntries.length} HTML element${elementEntries.length === 1 ? "" : "s"} · ${strongEntries} high confidence`
              : "No reusable screen objects learned for this scope yet"}
          </span>
        </div>
        <AutomationCodeIcon />
      </summary>

      {pageObjects.length ? (
        <div className="automation-learning-pom-list">
          {pageObjects.map(([screen, pageEntries]) => (
            <article className="automation-learning-pom-card" key={screen}>
              <div className="automation-learning-card-head">
                <strong>class {toPascalCase(screen)}</strong>
                <span>{pageEntries.length} member{pageEntries.length === 1 ? "" : "s"}</span>
              </div>
              <span className="automation-learning-page">{pageEntries[0]?.page_url || screen}</span>
              <div className="automation-learning-pom-members">
                {pageEntries.slice(0, 5).map((entry) => (
                  <div className="automation-learning-pom-member" key={entry.id}>
                    <code>{getObjectLabel(entry).replace(/\s+/g, "")}</code>
                    <span>{getTagDetail(entry)}</span>
                    <small>{entry.locator}</small>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state compact">No HTML elements are available yet. Run a click, fill, select, or check recording so HelloTest can learn friendly element names and tags.</div>
      )}
    </details>
  );
}

export function EditorAccordionSection({
  title,
  summary,
  countLabel,
  isExpanded,
  onToggle,
  actions,
  children
}: {
  title: ReactNode;
  summary: ReactNode;
  countLabel: string;
  isExpanded: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={isExpanded ? "editor-accordion-section is-expanded" : "editor-accordion-section"}>
      <div className="editor-accordion-head">
        <button
          aria-expanded={isExpanded}
          className="editor-accordion-toggle"
          onClick={onToggle}
          type="button"
        >
          <div className="editor-accordion-toggle-main">
            <span aria-hidden="true" className={isExpanded ? "editor-accordion-icon is-expanded" : "editor-accordion-icon"}>
              <EditorAccordionChevronIcon />
            </span>
            <div className="editor-accordion-toggle-copy">
              <strong>{title}</strong>
              <span>{summary}</span>
            </div>
          </div>
        </button>
        <div className="editor-accordion-toggle-meta">
          <span className="editor-accordion-toggle-count">{countLabel}</span>
          {actions ? <div className="editor-accordion-actions">{actions}</div> : null}
          <button
            aria-label={isExpanded ? "Collapse section" : "Expand section"}
            className="editor-accordion-toggle-state explorer-icon-button"
            onClick={onToggle}
            title={isExpanded ? "Collapse section" : "Expand section"}
            type="button"
          >
            <CollapseExpandIcon isExpanded={isExpanded} />
          </button>
        </div>
      </div>
      {isExpanded ? <div className="editor-accordion-body">{children}</div> : null}
    </section>
  );
}

export function EditorAccordionChevronIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
