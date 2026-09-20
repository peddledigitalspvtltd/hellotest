import { useEffect, useId, useState } from "react";
import { IconPhotoPlus } from "@tabler/icons-react";
import { FileAddIcon, TrashIcon, UploadIcon } from "./AppIcons";
import { AiPromptTemplatePicker, type AiPromptScope } from "./AiPromptTemplatePicker";
import { FormField } from "./FormField";
import { SmartContextWorkbench, type SmartContextSelection } from "./SmartContextWorkbench";
import {
  buildFileContextSection,
  buildRequirementContextSection,
  replaceSmartContextPack,
  stripSmartContextPack
} from "../lib/aiDesignStudio";
import type { AiDesignImageInput, Requirement } from "../types";
import "./AiPromptContextPanel.css";

const PROMPT_CONTEXT_COPY: Record<AiPromptScope, {
  smartContext: string;
  promptPlaceholder: string;
  emptyImages: string;
}> = {
  requirement_creation: {
    smartContext: "Package project knowledge and safe reference files for new Story drafts.",
    promptPlaceholder: "Product outcome, target persona, acceptance boundaries, delivery constraints, risks...",
    emptyImages: "Add product references or screenshots."
  },
  requirement_completion: {
    smartContext: "Package the selected Story, relevant project knowledge, and safe files without replacing the Story's existing intent.",
    promptPlaceholder: "Missing acceptance detail, risks, assumptions, questions, or constraints to complete...",
    emptyImages: "Add product references or screenshots."
  },
  test_case_generation: {
    smartContext: "Package selected Stories, relevant QA knowledge, and safe files for reusable Test Case coverage.",
    promptPlaceholder: "Coverage goals, risky flows, browser/device notes, compliance rules, known gaps...",
    emptyImages: "Add screenshots or reference photos that clarify the Test Case coverage."
  },
  test_case_steps: {
    smartContext: "Package the current Test Case, its linked Story, relevant QA knowledge, and safe files for step completion.",
    promptPlaceholder: "Action granularity, assertions, platform constraints, reusable data, or coverage gaps...",
    emptyImages: "Add screenshots or evidence that clarify the steps for this Test Case."
  },
  bug_creation: {
    smartContext: "Package the selected failed evidence, linked Stories, relevant QA knowledge, and safe files for this Defect only.",
    promptPlaceholder: "Failure symptoms, reproduction constraints, impact, environment, expected versus actual behavior...",
    emptyImages: "Add failure screenshots or evidence that belongs to this Defect."
  }
};

export function AiPromptContextPanel({
  additionalContext,
  appTypeId,
  disabled = false,
  externalLinksText,
  onAddImages,
  onAdditionalContextChange,
  onExternalLinksTextChange,
  onBusyChange,
  onRemoveImage,
  promptScope = "test_case_generation",
  projectId,
  referenceUploadPresentation = "input",
  referenceImages,
  requirements = [],
  showPromptEditor = true
}: {
  additionalContext: string;
  appTypeId?: string;
  disabled?: boolean;
  externalLinksText: string;
  onAddImages: (files: FileList | null) => void;
  onAdditionalContextChange: (value: string) => void;
  onExternalLinksTextChange: (value: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onRemoveImage: (imageUrl: string) => void;
  promptScope?: AiPromptScope;
  projectId?: string;
  referenceUploadPresentation?: "input" | "dropzone";
  referenceImages: AiDesignImageInput[];
  requirements?: Requirement[];
  showPromptEditor?: boolean;
}) {
  const tabIdPrefix = useId();
  const [contextFiles, setContextFiles] = useState<File[]>([]);
  const [isBuildingContext, setIsBuildingContext] = useState(false);
  const [contextMessage, setContextMessage] = useState("");
  const [contextMessageTone, setContextMessageTone] = useState<"info" | "warning">("info");
  const [activeContextTab, setActiveContextTab] = useState<"text" | "files" | "links" | "images">(showPromptEditor ? "text" : "files");
  const promptContextCopy = PROMPT_CONTEXT_COPY[promptScope];
  const externalLinkCount = externalLinksText.split(/\r?\n/).filter((value) => value.trim()).length;
  const contextTabs = [
    ...(showPromptEditor ? [{ id: "text" as const, label: "Text", count: additionalContext.trim() ? 1 : 0 }] : []),
    { id: "files" as const, label: "Files", count: contextFiles.length },
    { id: "links" as const, label: "Links", count: externalLinkCount },
    { id: "images" as const, label: "Images", count: referenceImages.length }
  ];

  useEffect(() => {
    onBusyChange?.(isBuildingContext);
    return () => onBusyChange?.(false);
  }, [isBuildingContext, onBusyChange]);

  const applySmartContext = async (selection: SmartContextSelection) => {
    setIsBuildingContext(true);
    setContextMessage("");
    setContextMessageTone("info");

    try {
      const fileContext = await buildFileContextSection(contextFiles);
      if (fileContext.overLimit) {
        setContextMessageTone("warning");
        setContextMessage(`Attachment limit exceeded. ${fileContext.blocked.join(" ")}`);
        throw new Error(`Attachment limit exceeded. ${fileContext.blocked.join(" ")}`);
      }
      onAdditionalContextChange(replaceSmartContextPack(additionalContext, [
        buildRequirementContextSection(requirements),
        selection.contextText,
        fileContext.section
      ].filter(Boolean).join("\n\n")));
      setContextMessage([
        requirements.length ? `${requirements.length} ${requirements.length === 1 ? "story" : "stories"}` : "",
        `${selection.resultCount} reviewed Knowledge Repo source${selection.resultCount === 1 ? "" : "s"}`,
        fileContext.section ? `file context compressed ${fileContext.totalOriginalChars.toLocaleString()}→${fileContext.totalPackedChars.toLocaleString()} chars` : "",
        fileContext.skipped.length ? `Skipped ${fileContext.skipped.length}` : ""
      ].filter(Boolean).join(" · "));
    } catch (error) {
      setContextMessageTone("warning");
      setContextMessage(error instanceof Error ? error.message : "Unable to build smart context.");
      throw error;
    } finally {
      setIsBuildingContext(false);
    }
  };

  return (
    <section className="ai-studio-panel ai-prompt-context-panel">
      <div className="ai-prompt-context-toolbar">
        <div aria-label="Context types" className="ai-prompt-context-tabs" role="tablist">
          {contextTabs.map((tab) => (
            <button
              aria-controls={`${tabIdPrefix}-${tab.id}-panel`}
              aria-selected={activeContextTab === tab.id}
              className={activeContextTab === tab.id ? "is-active" : ""}
              id={`${tabIdPrefix}-${tab.id}-tab`}
              key={tab.id}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const currentIndex = contextTabs.findIndex((item) => item.id === tab.id);
                const nextIndex = event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? contextTabs.length - 1
                    : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + contextTabs.length) % contextTabs.length;
                const nextTab = contextTabs[nextIndex];
                setActiveContextTab(nextTab.id);
                window.requestAnimationFrame(() => document.getElementById(`${tabIdPrefix}-${nextTab.id}-tab`)?.focus());
              }}
              onClick={() => setActiveContextTab(tab.id)}
              role="tab"
              tabIndex={activeContextTab === tab.id ? 0 : -1}
              type="button"
            >
              <span>{tab.label}</span>
              {tab.count ? <em>{tab.count}</em> : null}
            </button>
          ))}
        </div>
        <AiPromptTemplatePicker
          appTypeId={appTypeId}
          disabled={disabled || isBuildingContext}
          onApply={onAdditionalContextChange}
          projectId={projectId}
          scope={promptScope}
          triggerLabel="Templates"
        />
      </div>

      <div aria-label="Additional context" className="ai-prompt-context-head">
        <span>Context engine</span>
        <div className="ai-prompt-context-head-actions">
          <SmartContextWorkbench
            appTypeId={appTypeId}
            buttonClassName="primary-button compact ai-smart-context-button"
            buttonLabel={isBuildingContext ? "Applying…" : "Smart Context"}
            disabled={disabled || isBuildingContext}
            initialQuery={[
              requirements.slice(0, 8).map((item) => `${item.title} ${item.description || ""}`).join(" "),
              stripSmartContextPack(additionalContext)
            ].filter(Boolean).join(" ")}
            onApply={applySmartContext}
            projectId={projectId}
          />
        </div>
      </div>

      {showPromptEditor ? (
        <div
          aria-labelledby={`${tabIdPrefix}-text-tab`}
          className="ai-prompt-context-tab-panel"
          hidden={activeContextTab !== "text"}
          id={`${tabIdPrefix}-text-panel`}
          role="tabpanel"
        >
          <FormField className="ai-prompt-copy-field" label="Additional instructions">
            <textarea
              disabled={disabled}
              placeholder={promptContextCopy.promptPlaceholder}
              rows={5}
              value={additionalContext}
              onChange={(event) => onAdditionalContextChange(event.target.value)}
            />
          </FormField>
        </div>
      ) : null}

      <div
        aria-labelledby={`${tabIdPrefix}-files-tab`}
        className="ai-prompt-context-tab-panel"
        hidden={activeContextTab !== "files"}
        id={`${tabIdPrefix}-files-panel`}
        role="tabpanel"
      >
        <div className="ai-smart-context-card">
          <div>
            <strong>Smart context pack</strong>
            <span>{promptContextCopy.smartContext}</span>
          </div>
          <div className="ai-smart-context-actions">
            <label className="ghost-button compact ai-context-file-button">
              <input
                accept=".txt,.md,.markdown,.csv,.json,.xml,.yaml,.yml,.feature,.log,text/*,application/json,application/xml"
                disabled={disabled}
                multiple
                onChange={(event) => {
                  setContextFiles((current) => {
                    const byIdentity = new Map(current.map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file]));
                    Array.from(event.target.files || []).forEach((file) => {
                      byIdentity.set(`${file.name}:${file.size}:${file.lastModified}`, file);
                    });
                    return [...byIdentity.values()];
                  });
                  event.target.value = "";
                }}
                type="file"
              />
              <UploadIcon />
              <span>{contextFiles.length ? `${contextFiles.length} file${contextFiles.length === 1 ? "" : "s"}` : "Add files"}</span>
            </label>
          </div>
          {contextMessage ? <span className={contextMessageTone === "warning" ? "ai-smart-context-note is-warning" : "ai-smart-context-note"}>{contextMessage}</span> : null}
        </div>

        {contextFiles.length ? (
          <div className="ai-context-file-list" aria-label="Selected context files">
            {contextFiles.map((file) => {
              const fileIdentity = `${file.name}:${file.size}:${file.lastModified}`;
              return (
                <span className="ai-context-file-chip" key={fileIdentity} title={file.name}>
                  <FileAddIcon size={14} />
                  <span>{file.name}</span>
                  <button
                    aria-label={`Remove ${file.name}`}
                    disabled={disabled || isBuildingContext}
                    onClick={() => setContextFiles((current) => current.filter((candidate) =>
                      `${candidate.name}:${candidate.size}:${candidate.lastModified}` !== fileIdentity
                    ))}
                    type="button"
                  >
                    <TrashIcon size={13} />
                  </button>
                </span>
              );
            })}
          </div>
        ) : (
          <p className="ai-prompt-context-empty">Add only files that directly support this draft.</p>
        )}
      </div>

      <div
        aria-labelledby={`${tabIdPrefix}-links-tab`}
        className="ai-prompt-context-tab-panel"
        hidden={activeContextTab !== "links"}
        id={`${tabIdPrefix}-links-panel`}
        role="tabpanel"
      >
        <FormField
          className="ai-external-links-field"
          hint="URLs are passed as reference pointers; linked page content is not fetched."
          hintVisible
          label="External links"
        >
          <textarea
            disabled={disabled}
            placeholder="One link per line"
            rows={5}
            value={externalLinksText}
            onChange={(event) => onExternalLinksTextChange(event.target.value)}
          />
        </FormField>
      </div>

      <div
        aria-labelledby={`${tabIdPrefix}-images-tab`}
        className="ai-prompt-context-tab-panel"
        hidden={activeContextTab !== "images"}
        id={`${tabIdPrefix}-images-panel`}
        role="tabpanel"
      >
        <FormField
          className="ai-reference-photos-field"
          hint="Images are analyzed only by supported models; an unsupported provider will show a fallback or error."
          hintVisible
          label="Reference images"
        >
          {referenceUploadPresentation === "dropzone" ? (
            <label className="ai-reference-upload-zone">
              <input
                accept="image/*"
                disabled={disabled}
                multiple
                onChange={(event) => {
                  onAddImages(event.target.files);
                  event.target.value = "";
                }}
                type="file"
              />
              <IconPhotoPlus aria-hidden="true" size={22} stroke={1.8} />
              <span>{promptContextCopy.emptyImages}</span>
              <strong>Choose images</strong>
            </label>
          ) : (
            <input
              accept="image/*"
              disabled={disabled}
              multiple
              onChange={(event) => {
                onAddImages(event.target.files);
                event.target.value = "";
              }}
              type="file"
            />
          )}
        </FormField>

        {referenceImages.length ? (
          <div className="ai-reference-image-list">
            {referenceImages.map((image) => (
              <article className="ai-reference-image-card" key={image.url}>
                <div className="ai-reference-image-preview"><img alt={image.name || "Reference"} src={image.url} /></div>
                <div className="ai-reference-image-copy"><strong>{image.name || "Reference image"}</strong></div>
                <button className="ghost-button danger compact" disabled={disabled} onClick={() => onRemoveImage(image.url)} type="button">Remove</button>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
