import { useEffect, useState } from "react";
import { IconPhotoPlus } from "@tabler/icons-react";
import { FileAddIcon, SparkIcon, TrashIcon, UploadIcon } from "./AppIcons";
import { AiPromptTemplatePicker, type AiPromptScope } from "./AiPromptTemplatePicker";
import { FormField } from "./FormField";
import {
  buildFileContextSection,
  buildKnowledgeContextSection,
  buildRequirementContextSection,
  mergeAiContextPack
} from "../lib/aiDesignStudio";
import type { AiDesignImageInput, Requirement } from "../types";

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
    smartContext: "Package the selected failed evidence, linked Stories, relevant QA knowledge, and safe files for this Bug only.",
    promptPlaceholder: "Failure symptoms, reproduction constraints, impact, environment, expected versus actual behavior...",
    emptyImages: "Add failure screenshots or evidence that belongs to this Bug."
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
  const [contextFiles, setContextFiles] = useState<File[]>([]);
  const [isBuildingContext, setIsBuildingContext] = useState(false);
  const [contextMessage, setContextMessage] = useState("");
  const [contextMessageTone, setContextMessageTone] = useState<"info" | "warning">("info");
  const promptContextCopy = PROMPT_CONTEXT_COPY[promptScope];

  useEffect(() => {
    onBusyChange?.(isBuildingContext);
    return () => onBusyChange?.(false);
  }, [isBuildingContext, onBusyChange]);

  const buildSmartContext = async () => {
    setIsBuildingContext(true);
    setContextMessage("");
    setContextMessageTone("info");

    try {
      const query = requirements.slice(0, 8).map((item) => item.title).filter(Boolean).join(" ");
      const knowledgePackage = projectId
        ? await (await import("../lib/api")).api.knowledgeRepo.contextPackage(projectId, { app_type_id: appTypeId, query })
        : { knowledge: [] };
      const fileContext = await buildFileContextSection(contextFiles);
      if (fileContext.overLimit) {
        setContextMessageTone("warning");
        setContextMessage(`Attachment limit exceeded. ${fileContext.blocked.join(" ")}`);
        return;
      }
      onAdditionalContextChange(mergeAiContextPack(additionalContext, [
        "HelloTest smart context pack: use this material as supporting evidence and preserve human review before applying changes.",
        buildRequirementContextSection(requirements),
        buildKnowledgeContextSection(knowledgePackage.knowledge || []),
        fileContext.section
      ]));
      setContextMessage([
        requirements.length ? `${requirements.length} ${requirements.length === 1 ? "story" : "stories"}` : "",
        `${(knowledgePackage.knowledge || []).length} knowledge item${(knowledgePackage.knowledge || []).length === 1 ? "" : "s"}`,
        fileContext.section ? `file context compressed ${fileContext.totalOriginalChars.toLocaleString()}→${fileContext.totalPackedChars.toLocaleString()} chars` : "",
        fileContext.skipped.length ? `Skipped ${fileContext.skipped.length}` : ""
      ].filter(Boolean).join(" · "));
    } catch (error) {
      setContextMessageTone("warning");
      setContextMessage(error instanceof Error ? error.message : "Unable to build smart context.");
    } finally {
      setIsBuildingContext(false);
    }
  };

  return (
    <section className="ai-studio-panel ai-prompt-context-panel">
      <div aria-label="Additional context" className="ai-prompt-context-head">
        <span>{showPromptEditor ? "Prompt instructions" : "Prompt pattern"}</span>
        <AiPromptTemplatePicker
          appTypeId={appTypeId}
          disabled={disabled}
          onApply={onAdditionalContextChange}
          projectId={projectId}
          scope={promptScope}
        />
      </div>

      <div className="ai-smart-context-card">
        <div>
          <strong>Smart context</strong>
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
          <button
            className="primary-button compact ai-smart-context-button"
            disabled={disabled || isBuildingContext}
            onClick={() => void buildSmartContext()}
            type="button"
          >
            <SparkIcon />
            <span>{isBuildingContext ? "Packing..." : referenceUploadPresentation === "dropzone" ? "Context" : "Add smart context"}</span>
          </button>
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
      ) : null}

      {showPromptEditor ? (
        <FormField className="ai-prompt-copy-field" label="Prompt copy">
          <textarea
            disabled={disabled}
            placeholder={promptContextCopy.promptPlaceholder}
            rows={5}
            value={additionalContext}
            onChange={(event) => onAdditionalContextChange(event.target.value)}
          />
        </FormField>
      ) : null}

      <FormField className="ai-external-links-field" label="External links">
        <textarea
          disabled={disabled}
          placeholder="One link per line"
          rows={3}
          value={externalLinksText}
          onChange={(event) => onExternalLinksTextChange(event.target.value)}
        />
      </FormField>

      <FormField className="ai-reference-photos-field" label="Reference photos">
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
            <IconPhotoPlus aria-hidden="true" size={24} stroke={1.8} />
            <span>{promptContextCopy.emptyImages}</span>
            <strong>Choose files</strong>
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
      ) : referenceUploadPresentation === "input" ? (
        <div className="empty-state compact">{promptContextCopy.emptyImages}</div>
      ) : null}
    </section>
  );
}
