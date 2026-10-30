import { LoadingState } from "../../shared/components/LoadingState";
import { createElement, type CSSProperties, type ElementType, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconPaperclip, IconPhoto } from "@tabler/icons-react";
import { useAuth } from "../../auth/AuthContext";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { api } from "../../lib/api";
import { areFeatureFlagsEnabled } from "../lib/featureFlags";
import { hasPermission } from "../lib/permissions";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { AiEvidenceButton, AiEvidenceFlyout } from "@hellotest/agentic/frontend/components/AgenticExperience";
import { DialogCloseButton } from "../../shared/components/DialogCloseButton";
import { useStepParameterAutocomplete } from "../../shared/components/StepParameterSuggestions";
import { excludeSensitiveStepParameterValues, resolveStepParameterText, type StepParameterDefinition } from "../../shared/lib/stepParameters";

type RichTextEditorProps = {
  availableParameters?: StepParameterDefinition[];
  parameterValues?: Record<string, string>;
  id?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  appearance?: "standard" | "canonical";
  toolbarPreset?: "default" | "sprint-goal";
  onAiRephrase?: (html: string, plainText: string, smartContext?: string) => Promise<string | void> | string | void;
  onAttachmentRequest?: () => void;
  aiRephraseTitle?: string;
  aiRephraseContext?: {
    entityType?: string;
    entityId?: string;
    entityTitle?: string;
    fieldLabel?: string;
    appTypeId?: string;
    requirementId?: string;
    moduleId?: string;
  };
  "aria-label"?: string;
};

type RichTextContentProps = {
  value?: string | null;
  fallback?: string;
  className?: string;
  as?: ElementType;
  title?: string;
};

type AiRephraseEvidence = {
  status: "running" | "completed" | "failed";
  entityType: string;
  entityId: string;
  entityTitle: string;
  fieldLabel: string;
  sourceText: string;
  projectId: string;
  provider: string;
  model: string;
  generationMode: string;
  fallbackReason: string;
  outputLength: number;
};

const ALLOWED_TAGS = new Set(["a", "b", "blockquote", "br", "code", "div", "em", "h3", "i", "li", "ol", "p", "s", "span", "strike", "strong", "u", "ul"]);
const DROPPED_TAGS = new Set(["script", "style", "iframe", "object", "embed", "link", "meta"]);

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) {
      return parsed.href;
    }
  } catch {
    return "";
  }

  return "";
}

function applyInlineMarkdown(value: string) {
  const escaped = escapeHtml(value);

  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)]\((https?:\/\/[^)\s]+|mailto:[^)]+)\)/g, (_match, text: string, url: string) => {
      const safeUrl = sanitizeUrl(url);
      return safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">${text}</a>` : text;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

function markdownToHtml(value: string) {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];
  let paragraph: string[] = [];

  const flushList = () => {
    if (!listType || !listItems.length) {
      listType = null;
      listItems = [];
      return;
    }

    blocks.push(`<${listType}>${listItems.map((item) => `<li>${applyInlineMarkdown(item)}</li>`).join("")}</${listType}>`);
    listType = null;
    listItems = [];
  };

  const flushParagraph = () => {
    if (!paragraph.length) {
      return;
    }

    blocks.push(`<p>${paragraph.map(applyInlineMarkdown).join("<br>")}</p>`);
    paragraph = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }

    const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push(`<h3>${applyInlineMarkdown(heading[1])}</h3>`);
      return;
    }

    const quote = trimmed.match(/^>\s+(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${applyInlineMarkdown(quote[1])}</blockquote>`);
      return;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (listType !== "ul") {
        flushList();
        listType = "ul";
      }
      listItems.push(unordered[1]);
      return;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (listType !== "ol") {
        flushList();
        listType = "ol";
      }
      listItems.push(ordered[1]);
      return;
    }

    flushList();
    paragraph.push(trimmed);
  });

  flushParagraph();
  flushList();

  return blocks.join("");
}

function isLikelyHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function decodeEscapedHtmlMarkup(value: string) {
  if (!/&lt;\/?[a-z][\s\S]*?&gt;/i.test(value)) {
    return value;
  }

  if (typeof document === "undefined") {
    return value
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/gi, "&");
  }

  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

export function sanitizeRichTextHtml(value: string) {
  const normalizedValue = decodeEscapedHtmlMarkup(value);

  if (!normalizedValue.trim()) {
    return "";
  }

  if (typeof document === "undefined") {
    return escapeHtml(
      normalizedValue
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    );
  }

  const template = document.createElement("template");
  template.innerHTML = isLikelyHtml(normalizedValue) ? normalizedValue : markdownToHtml(normalizedValue);

  const cleanNode = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || "");
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const element = node as HTMLElement;
    const tagName = element.tagName.toLowerCase();

    if (DROPPED_TAGS.has(tagName)) {
      return null;
    }

    if (!ALLOWED_TAGS.has(tagName)) {
      const fragment = document.createDocumentFragment();
      Array.from(element.childNodes).forEach((child) => {
        const cleanChild = cleanNode(child);
        if (cleanChild) {
          fragment.appendChild(cleanChild);
        }
      });
      return fragment;
    }

    const cleanElement = document.createElement(tagName);
    if (tagName === "a") {
      const safeHref = sanitizeUrl(element.getAttribute("href") || "");
      if (safeHref) {
        cleanElement.setAttribute("href", safeHref);
        cleanElement.setAttribute("target", "_blank");
        cleanElement.setAttribute("rel", "noreferrer");
      }
    }

    Array.from(element.childNodes).forEach((child) => {
      const cleanChild = cleanNode(child);
      if (cleanChild) {
        cleanElement.appendChild(cleanChild);
      }
    });

    return cleanElement;
  };

  const container = document.createElement("div");
  Array.from(template.content.childNodes).forEach((child) => {
    const cleanChild = cleanNode(child);
    if (cleanChild) {
      container.appendChild(cleanChild);
    }
  });

  return container.innerHTML;
}

export function normalizeRichTextHtml(value?: string | null) {
  return value ? sanitizeRichTextHtml(value) : "";
}

export function richTextToPlainText(value?: string | null) {
  if (!value) {
    return "";
  }

  if (typeof document === "undefined") {
    return decodeEscapedHtmlMarkup(value)
      .replace(/<[^>]+>/g, " ")
      .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
      .replace(/[*_`#>]/g, "")
      .replace(/^\s*[-\d.]+\s+/gm, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const container = document.createElement("div");
  container.innerHTML = normalizeRichTextHtml(value);
  return (container.textContent || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function richTextToEditableMarkdown(value: string) {
  const normalized = normalizeRichTextHtml(value);

  if (typeof document === "undefined") {
    return normalized
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/?(?:ul|ol)[^>]*>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  const container = document.createElement("div");
  container.innerHTML = normalized;

  const serializeInline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || "";
    }
    if (!(node instanceof HTMLElement)) {
      return "";
    }

    const content = Array.from(node.childNodes).map(serializeInline).join("");
    switch (node.tagName.toLowerCase()) {
      case "strong":
      case "b":
        return `**${content}**`;
      case "em":
      case "i":
        return `*${content}*`;
      case "code":
        return `\`${content}\``;
      case "a": {
        const href = sanitizeUrl(node.getAttribute("href") || "");
        return href ? `[${content}](${href})` : content;
      }
      case "br":
        return "\n";
      default:
        return content;
    }
  };

  const blocks = Array.from(container.children).flatMap((element) => {
    const tag = element.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") {
      return Array.from(element.children)
        .filter((child) => child.tagName.toLowerCase() === "li")
        .map((item, index) => `${tag === "ol" ? `${index + 1}.` : "-"} ${serializeInline(item).trim()}`);
    }
    if (tag === "blockquote") {
      return [`> ${serializeInline(element).trim()}`];
    }
    return [serializeInline(element).trim()];
  });

  return blocks.filter(Boolean).join("\n\n").trim();
}

function isSelectionInside(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return false;
  }

  const node = selection.anchorNode;
  return Boolean(node && root.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode));
}

export function RichTextContent({ value, fallback = "", className = "", as: Component = "div", title }: RichTextContentProps) {
  const html = useMemo(() => normalizeRichTextHtml(value) || escapeHtml(fallback), [fallback, value]);

  if (!html) {
    return null;
  }

  return createElement(Component, {
    className: ["rich-text-content", className].filter(Boolean).join(" "),
    dangerouslySetInnerHTML: { __html: html },
    title
  });
}

export function RichTextEditor({
  availableParameters,
  parameterValues,
  id,
  value,
  onChange,
  rows = 4,
  placeholder,
  autoFocus,
  required,
  disabled,
  className = "",
  appearance = "standard",
  toolbarPreset = "default",
  onAiRephrase,
  onAttachmentRequest,
  aiRephraseTitle = "Rephrase description with AI",
  aiRephraseContext,
  "aria-label": ariaLabel
}: RichTextEditorProps) {
  const { session } = useAuth();
  const [projectId] = useCurrentProject();
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const editorRef = useRef<HTMLDivElement | null>(null);
  const parameterPreviewRef = useRef<HTMLDivElement | null>(null);
  const parameterQueryRootRef = useRef<HTMLElement | null>(null);
  const lastHtmlRef = useRef("");
  const [isEditingParameters, setIsEditingParameters] = useState(false);
  const hasParameterSupport = availableParameters !== undefined || parameterValues !== undefined;
  const safeParameterValues = useMemo(() => excludeSensitiveStepParameterValues(parameterValues, (availableParameters || []).filter((parameter) => parameter.sensitive).map((parameter) => parameter.name)), [availableParameters, parameterValues]);
  const resolvedParameterHtml = useMemo(() => {
    if (!hasParameterSupport || typeof document === "undefined") return "";
    const root = document.createElement("div");
    root.innerHTML = normalizeRichTextHtml(value);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      node.textContent = resolveStepParameterText(node.textContent, safeParameterValues);
      node = walker.nextNode();
    }
    return root.innerHTML;
  }, [hasParameterSupport, safeParameterValues, value]);
  const showParameterPreview = hasParameterSupport && !isEditingParameters && resolvedParameterHtml !== normalizeRichTextHtml(value);
  const syncParameterPreviewScroll = () => {
    const editor = editorRef.current;
    const preview = parameterPreviewRef.current;
    if (!editor || !preview) return;
    const availableScroll = editor.scrollHeight - editor.clientHeight;
    preview.scrollTop = availableScroll > 0 ? (editor.scrollTop / availableScroll) * Math.max(0, preview.scrollHeight - preview.clientHeight) : 0;
  };
  useEffect(syncParameterPreviewScroll, [resolvedParameterHtml, showParameterPreview]);
  const [isRephrasing, setIsRephrasing] = useState(false);
  const [aiProposal, setAiProposal] = useState<string | null>(null);
  const [aiEvidence, setAiEvidence] = useState<AiRephraseEvidence | null>(null);
  const [isAiEvidenceOpen, setIsAiEvidenceOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState<{ text: string; url: string } | null>(null);
  const [linkError, setLinkError] = useState("");
  const pendingLinkRangeRef = useRef<Range | null>(null);
  const isEmpty = !richTextToPlainText(value);
  const canUseDefaultAiRephrase = Boolean(projectId)
    && hasPermission(session, "content.ai", projectId)
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ai.content_rephrase"]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const nextHtml = normalizeRichTextHtml(value);
    if (document.activeElement === editor && nextHtml === lastHtmlRef.current) {
      return;
    }

    if (editor.innerHTML !== nextHtml) {
      editor.innerHTML = nextHtml;
    }
    lastHtmlRef.current = nextHtml;
  }, [value]);

  useEffect(() => {
    if (autoFocus && editorRef.current) {
      editorRef.current.focus();
    }
  }, [autoFocus]);

  const emitChange = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const text = (editor.textContent || "").replace(/\u00a0/g, " ").trim();
    const nextHtml = text ? sanitizeRichTextHtml(editor.innerHTML) : "";
    lastHtmlRef.current = nextHtml;
    onChange(nextHtml);
  }, [onChange]);

  const autocomplete = useStepParameterAutocomplete({
    availableParameters,
    parameterValues: safeParameterValues,
    onSelect: (parameter, query) => {
      const editor = editorRef.current;
      if (!editor || disabled) return;
      const root = parameterQueryRootRef.current || editor;
      if (!editor.contains(root)) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let offset = 0;
      let startFound = false;
      let endFound = false;
      let node = walker.nextNode();
      while (node) {
        const end = offset + (node.textContent || "").length;
        if (!startFound && query.start <= end) { range.setStart(node, query.start - offset); startFound = true; }
        if (startFound && query.end <= end) { range.setEnd(node, query.end - offset); endFound = true; break; }
        offset = end;
        node = walker.nextNode();
      }
      if (!startFound || !endFound) return;
      editor.focus();
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (!document.execCommand("insertText", false, parameter.token)) {
        range.deleteContents();
        const token = document.createTextNode(parameter.token);
        range.insertNode(token);
        range.setStartAfter(token);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      emitChange();
    }
  });
  const updateParameterSuggestions = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!hasParameterSupport || disabled || !editor || !selection?.rangeCount || !selection.isCollapsed || !editor.contains(selection.anchorNode)) {
      autocomplete.dismiss();
      return;
    }
    const anchorElement = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
    const block = anchorElement?.closest<HTMLElement>("p, li, div, h3, blockquote");
    const root = block && editor.contains(block) ? block : editor;
    parameterQueryRootRef.current = root;
    const preceding = selection.getRangeAt(0).cloneRange();
    preceding.selectNodeContents(root);
    preceding.setEnd(selection.anchorNode!, selection.anchorOffset);
    const caret = preceding.toString().length;
    autocomplete.update(root.textContent || "", caret, caret, editor);
  };

  const runCommand = useCallback((command: string, commandValue?: string) => {
    if (disabled) {
      return;
    }

    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.focus();
    document.execCommand(command, false, commandValue);
    emitChange();
  }, [disabled, emitChange]);

  const insertHtml = useCallback((html: string) => {
    const editor = editorRef.current;
    if (!editor || disabled) {
      return;
    }

    editor.focus();
    document.execCommand("insertHTML", false, html);
    emitChange();
  }, [disabled, emitChange]);

  const wrapSelectionWithCode = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || disabled) {
      return;
    }

    editor.focus();
    if (!isSelectionInside(editor)) {
      insertHtml("<code>code</code>");
      return;
    }

    const selection = window.getSelection();
    const selectedText = selection?.toString() || "code";
    insertHtml(`<code>${escapeHtml(selectedText)}</code>`);
  }, [disabled, insertHtml]);

  const closeLinkDialog = useCallback(() => {
    setLinkDraft(null);
    setLinkError("");
    pendingLinkRangeRef.current = null;
  }, []);
  const linkDialogRef = useDialogFocus<HTMLDivElement>({
    active: Boolean(linkDraft),
    onClose: closeLinkDialog
  });

  const createLink = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || disabled) {
      return;
    }

    editor.focus();
    const selection = window.getSelection();
    const selectedText = selection?.toString() || "link";
    pendingLinkRangeRef.current = selection?.rangeCount && !selection.isCollapsed && isSelectionInside(editor)
      ? selection.getRangeAt(0).cloneRange()
      : null;
    setLinkError("");
    setLinkDraft({ text: selectedText, url: "https://" });
  }, [disabled]);

  const applyLink = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!linkDraft) return;
    const safeUrl = sanitizeUrl(linkDraft.url);
    if (!safeUrl) {
      setLinkError("Enter a valid http, https, or mailto link.");
      return;
    }

    const editor = editorRef.current;
    const pendingRange = pendingLinkRangeRef.current;
    if (editor && pendingRange && editor.contains(pendingRange.commonAncestorContainer)) {
      editor.focus();
      const selection = window.getSelection();
      const anchor = document.createElement("a");
      anchor.href = safeUrl;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      const selectedContents = pendingRange.extractContents();
      anchor.appendChild(selectedContents);
      pendingRange.insertNode(anchor);
      pendingRange.selectNodeContents(anchor);
      pendingRange.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(pendingRange);
      emitChange();
    } else {
      const linkText = linkDraft.text.trim() || safeUrl;
      insertHtml(`<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">${escapeHtml(linkText)}</a>`);
    }
    closeLinkDialog();
  }, [closeLinkDialog, emitChange, insertHtml, linkDraft]);

  const handleAiRephrase = useCallback(async () => {
    if (disabled || isRephrasing) {
      return;
    }

    const editor = editorRef.current;
    const currentHtml = normalizeRichTextHtml(editor?.innerHTML || value);
    const plainText = richTextToPlainText(currentHtml);

    if (!plainText) {
      return;
    }

    const evidenceBase: AiRephraseEvidence = {
      status: "running",
      entityType: aiRephraseContext?.entityType || "rich-text authoring field",
      entityId: aiRephraseContext?.entityId || "",
      entityTitle: aiRephraseContext?.entityTitle || "",
      fieldLabel: aiRephraseContext?.fieldLabel || aiRephraseTitle.replace(/^Rephrase\s+/i, "").replace(/\s+with AI$/i, ""),
      sourceText: plainText,
      projectId: projectId || "",
      provider: onAiRephrase ? "Feature-provided rephrase handler" : "Resolving configured provider",
      model: "",
      generationMode: onAiRephrase ? "feature handler" : "provider selection pending",
      fallbackReason: "",
      outputLength: 0
    };

    setAiEvidence(evidenceBase);
    setIsAiEvidenceOpen(false);
    setIsRephrasing(true);
    try {
      let aiValue: string | void;
      let resolvedEvidence = evidenceBase;

      if (onAiRephrase) {
        aiValue = await onAiRephrase(currentHtml, plainText);
      } else {
        const response = await api.ai.rephraseRichText({
            project_id: projectId,
            content: plainText,
            content_html: currentHtml,
            entity_type: evidenceBase.entityType,
            entity_id: evidenceBase.entityId || undefined,
            entity_title: evidenceBase.entityTitle || undefined,
            field_label: evidenceBase.fieldLabel,
            app_type_id: aiRephraseContext?.appTypeId,
            requirement_id: aiRephraseContext?.requirementId,
            module_id: aiRephraseContext?.moduleId,
            aria_label: ariaLabel
          });
        aiValue = response.content;
        resolvedEvidence = {
          ...evidenceBase,
          provider: response.integration?.name || "HelloTest AI",
          model: response.integration?.model || "",
          generationMode: String(response.provenance?.generation_mode || "configured rephrase"),
          fallbackReason: String(response.provenance?.fallback_reason || "")
        };
      }

      const nextValue = typeof aiValue === "string" ? aiValue : "";
      if (nextValue) {
        const nextHtml = sanitizeRichTextHtml(nextValue);
        const editableProposal = richTextToEditableMarkdown(nextHtml);
        setAiProposal(editableProposal);
        setAiEvidence({
          ...resolvedEvidence,
          status: "completed",
          outputLength: richTextToPlainText(nextHtml).length
        });
      } else {
        setAiEvidence({ ...resolvedEvidence, status: "failed" });
      }
    } catch (error) {
      setAiEvidence({
        ...evidenceBase,
        status: "failed",
        fallbackReason: error instanceof Error ? error.message : "The rephrase request could not be completed."
      });
      console.warn("Rich text AI rephrase failed; the original content was preserved.", error);
    } finally {
      setIsRephrasing(false);
    }
  }, [aiRephraseContext?.appTypeId, aiRephraseContext?.entityId, aiRephraseContext?.entityTitle, aiRephraseContext?.entityType, aiRephraseContext?.fieldLabel, aiRephraseContext?.moduleId, aiRephraseContext?.requirementId, aiRephraseTitle, ariaLabel, disabled, isRephrasing, onAiRephrase, onChange, projectId, value]);

  const acceptAiProposal = useCallback(() => {
    if (!aiProposal?.trim()) return;
    const nextHtml = sanitizeRichTextHtml(markdownToHtml(aiProposal.trim()));
    lastHtmlRef.current = nextHtml;
    onChange(nextHtml);
    if (editorRef.current) editorRef.current.innerHTML = nextHtml;
    setAiProposal(null);
  }, [aiProposal, onChange]);

  const evidenceEntityLabel = aiEvidence?.entityTitle
    || aiEvidence?.entityId
    || aiEvidence?.entityType
    || "Current rich-text field";
  const evidenceStages = aiEvidence ? [
    {
      label: "Intent",
      detail: `Improve ${aiEvidence.fieldLabel || "the current field"} for clarity and scanability without changing its meaning.`
    },
    {
      label: "Considered context",
      detail: `Used the current ${aiEvidence.sourceText.length}-character field value${aiEvidence.entityTitle ? ` and the supplied ${aiEvidence.entityType} title “${aiEvidence.entityTitle}”` : ""}${aiEvidence.projectId ? " within the active project scope" : ""}.`
    },
    {
      label: "Guardrails",
      detail: "Preserve facts, identifiers, outcomes, constraints, and testability. Do not invent records, evidence, links, results, or approvals."
    },
    {
      label: "Content specialist",
      detail: `${aiEvidence.provider}${aiEvidence.model ? ` · ${aiEvidence.model}` : ""} produced the proposal using ${aiEvidence.generationMode}.`
    },
    {
      label: "Output contract",
      detail: aiEvidence.entityType.toLowerCase() === "project"
        ? "Return concise semantic HTML with a scannable unordered bullet list for the project description."
        : "Return concise semantic rich text and use lists where they improve scanning."
    },
    {
      label: "Evaluation",
      detail: `Sanitized the proposal to the supported rich-text allowlist${aiEvidence.outputLength ? ` and retained ${aiEvidence.outputLength} characters of visible output` : ""}.`
    },
    {
      label: "Human review",
      detail: "The original content remains unchanged until Accept replacement is selected. The proposal stays editable before acceptance."
    }
  ] : [];

  const defaultControls: Array<{ group: "format" | "insert" | "list" | "ai"; label: ReactNode; title: string; action: () => void; disabled?: boolean }> = [
    { group: "format", label: <strong className="rich-text-tool-glyph">B</strong>, title: "Bold", action: () => runCommand("bold") },
    { group: "format", label: <em className="rich-text-tool-glyph">I</em>, title: "Italic", action: () => runCommand("italic") },
    { group: "format", label: <span className="rich-text-tool-glyph rich-text-tool-glyph--strike">S</span>, title: "Strikethrough", action: () => runCommand("strikeThrough") },
    { group: "format", label: <span className="rich-text-tool-glyph rich-text-tool-glyph--underline">U</span>, title: "Underline", action: () => runCommand("underline") },
    { group: "insert", label: <RichTextLinkIcon />, title: "Link", action: createLink },
    ...(onAttachmentRequest ? [{ group: "insert" as const, label: <IconPaperclip aria-hidden="true" size={18} stroke={1.9} />, title: "Attach files", action: onAttachmentRequest }] : []),
    { group: "insert", label: <RichTextCodeIcon />, title: "Inline code", action: wrapSelectionWithCode },
    { group: "list", label: <RichTextBulletedListIcon />, title: "Bulleted list", action: () => runCommand("insertUnorderedList") },
    { group: "list", label: <RichTextNumberedListIcon />, title: "Numbered list", action: () => runCommand("insertOrderedList") },
    { group: "list", label: <RichTextIndentIcon />, title: "Indent list item", action: () => runCommand("indent") },
    { group: "ai", label: <RichTextAiRephraseIcon />, title: aiRephraseTitle, action: handleAiRephrase, disabled: isEmpty || isRephrasing || (!onAiRephrase && !canUseDefaultAiRephrase) }
  ];
  const sprintGoalControls: typeof defaultControls = [
    { group: "format", label: <strong className="rich-text-tool-glyph">B</strong>, title: "Bold", action: () => runCommand("bold") },
    { group: "format", label: <em className="rich-text-tool-glyph">I</em>, title: "Italic", action: () => runCommand("italic") },
    { group: "format", label: <span className="rich-text-tool-glyph rich-text-tool-glyph--underline">U</span>, title: "Underline", action: () => runCommand("underline") },
    { group: "list", label: <RichTextBulletedListIcon />, title: "Bulleted list", action: () => runCommand("insertUnorderedList") },
    { group: "list", label: <RichTextNumberedListIcon />, title: "Numbered list", action: () => runCommand("insertOrderedList") },
    { group: "insert", label: <RichTextLinkIcon />, title: "Link", action: createLink },
    { group: "insert", label: <IconPhoto aria-hidden="true" size={18} stroke={1.8} />, title: "Image", action: () => undefined, disabled: true }
  ];
  const controls = toolbarPreset === "sprint-goal" ? sprintGoalControls : defaultControls;

  const editorStyle = {
    "--rich-text-editor-min-height": `${Math.max(3.4, rows * 1.45 + 0.95)}rem`
  } as CSSProperties;

  return (
    <div className={[
      "rich-text-editor",
      appearance === "canonical" ? "canonical-rich-text-editor" : "",
      `rich-text-editor--${toolbarPreset}`,
      className
    ].filter(Boolean).join(" ")}>
      <div className="rich-text-editor-toolbar" aria-label="Rich text tools">
        {controls.map((control, index) => (
          <span className="rich-text-tool-slot" key={control.title}>
            {index > 0 && controls[index - 1].group !== control.group ? <span aria-hidden="true" className="rich-text-tool-divider" /> : null}
            <button
              aria-label={control.title}
              className={["rich-text-tool-button", control.group === "ai" ? "rich-text-tool-button--ai" : "", isRephrasing && control.group === "ai" ? "is-loading" : ""].filter(Boolean).join(" ")}
              disabled={disabled || control.disabled}
              onClick={control.action}
              onMouseDown={(event) => event.preventDefault()}
              title={control.title}
              type="button"
            >
              {control.label}
            </button>
          </span>
        ))}
      </div>
      <div className={`rich-text-parameter-surface${showParameterPreview ? " is-previewing" : ""}`}>
      <div
        {...(hasParameterSupport ? autocomplete.inputProps : {})}
        aria-label={ariaLabel}
        aria-multiline="true"
        aria-required={required || undefined}
        className="rich-text-editor-surface"
        contentEditable={!disabled}
        data-empty={isEmpty ? "true" : "false"}
        data-placeholder={placeholder || ""}
        id={id}
        onBlur={() => { emitChange(); setIsEditingParameters(false); autocomplete.dismiss(); }}
        onFocus={() => setIsEditingParameters(true)}
        onInput={() => { emitChange(); updateParameterSuggestions(); }}
        onScroll={syncParameterPreviewScroll}
        onClick={updateParameterSuggestions}
        onKeyDown={autocomplete.onKeyDown}
        onKeyUp={(event) => {
          if (!["Escape", "Enter", "Tab", "ArrowDown", "ArrowUp"].includes(event.key)) updateParameterSuggestions();
        }}
        ref={editorRef}
        role={hasParameterSupport ? "combobox" : "textbox"}
        style={editorStyle}
        suppressContentEditableWarning
      />
      {showParameterPreview ? <div aria-hidden="true" className="rich-text-parameter-preview"><div className="rich-text-editor-surface" dangerouslySetInnerHTML={{ __html: resolvedParameterHtml }} ref={parameterPreviewRef} style={editorStyle} /></div> : null}
      </div>
      {hasParameterSupport ? autocomplete.menu : null}
      {isRephrasing || aiProposal !== null ? (
        <section aria-label="AI rephrase proposal" className="rich-text-ai-review">
          <header className="rich-text-ai-review__header">
            <div className="rich-text-ai-review__heading-line">
              <span>Editable AI proposal</span>
              <AiEvidenceButton label="Inspect evidence" onClick={() => setIsAiEvidenceOpen(true)} />
            </div>
            <strong>{isRephrasing ? "Building an editable proposal" : "Review before replacing the current text"}</strong>
          </header>
          {isRephrasing ? (
            <LoadingState label="Building an editable proposal" description="Your current text is preserved." />
          ) : (
            <>
              <textarea aria-label="Edit AI rephrase proposal" onChange={(event) => setAiProposal(event.target.value)} rows={Math.max(4, rows)} value={aiProposal || ""} />
              <footer>
                <span>Nothing changes until you accept.</span>
                <button className="ghost-button" onClick={() => setAiProposal(null)} type="button">Discard</button>
                <button className="primary-button" disabled={!aiProposal?.trim()} onClick={acceptAiProposal} type="button">Accept replacement</button>
              </footer>
            </>
          )}
        </section>
      ) : null}
      <AiEvidenceFlyout
        description={`Request-specific evidence for ${aiEvidence?.fieldLabel || "this AI rephrase"}.`}
        eyebrow="AI rephrase evidence"
        facts={aiEvidence ? [
          { label: "State", value: aiEvidence.status === "running" ? "Preparing proposal" : aiEvidence.status === "completed" ? "Ready for review" : "Request failed" },
          { label: "Target", value: evidenceEntityLabel },
          { label: "Field", value: aiEvidence.fieldLabel || "Rich text" },
          { label: "Source", value: `${aiEvidence.sourceText.length} characters` },
          { label: "Provider", value: aiEvidence.provider },
          { label: "Mode", value: aiEvidence.generationMode }
        ] : []}
        onClose={() => setIsAiEvidenceOpen(false)}
        open={isAiEvidenceOpen && Boolean(aiEvidence)}
        title={`${aiEvidence?.fieldLabel || "AI rephrase"} evidence`}
      >
        <section className="ai-evidence-flyout__section">
          <header>
            <span>Considered request</span>
            <strong>What the rephrase used and was required to preserve</strong>
          </header>
          <ol className="ai-evidence-flyout__timeline">
            {evidenceStages.map((stage, index) => (
              <li data-status={aiEvidence?.status === "completed" ? "complete" : index === 0 ? "current" : "queued"} key={stage.label}>
                <span aria-hidden="true">{index + 1}</span>
                <div>
                  <strong>{stage.label}</strong>
                  <p>{stage.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        {aiEvidence?.fallbackReason ? (
          <section className="ai-evidence-flyout__section">
            <header><span>Provider note</span><strong>Fallback or failure detail</strong></header>
            <p className="ai-evidence-flyout__empty">{aiEvidence.fallbackReason}</p>
          </section>
        ) : null}
        <p className="ai-evidence-flyout__boundary">This panel shows the supplied context, enforced constraints, and observable processing metadata. It does not expose hidden model reasoning.</p>
      </AiEvidenceFlyout>
      {linkDraft && typeof document !== "undefined" ? createPortal(
        <div className="modal-backdrop rich-text-link-backdrop" onClick={closeLinkDialog} role="presentation">
          <div
            aria-labelledby="rich-text-link-dialog-title"
            aria-modal="true"
            className="modal-card rich-text-link-dialog"
            onClick={(event) => event.stopPropagation()}
            ref={linkDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="resource-modal-header">
              <div className="resource-modal-title">
                <h2 className="dialog-title" id="rich-text-link-dialog-title">Add link</h2>
                <p>Link the selected text without leaving the current editor.</p>
              </div>
              <DialogCloseButton label="Close add link dialog" onClick={closeLinkDialog} />
            </header>
            <form className="rich-text-link-form" noValidate onSubmit={applyLink}>
              <label className="form-field">
                <span>Text to display</span>
                <input disabled={Boolean(pendingLinkRangeRef.current)} onChange={(event) => setLinkDraft((current) => current ? { ...current, text: event.target.value } : current)} value={linkDraft.text} />
                {pendingLinkRangeRef.current ? <small>The selected editor text will be linked.</small> : null}
              </label>
              <label className="form-field">
                <span>Link URL</span>
                <input
                  aria-invalid={Boolean(linkError)}
                  data-autofocus="true"
                  inputMode="url"
                  onChange={(event) => { setLinkDraft((current) => current ? { ...current, url: event.target.value } : current); setLinkError(""); }}
                  placeholder="https://example.com or mailto:name@example.com"
                  type="text"
                  value={linkDraft.url}
                />
                {linkError ? <small className="form-field-error" role="alert">{linkError}</small> : <small>Supported protocols: http, https, and mailto.</small>}
              </label>
              <footer className="rich-text-link-actions">
                <button className="ghost-button" onClick={closeLinkDialog} type="button">Cancel</button>
                <button className="primary-button" type="submit">Add link</button>
              </footer>
            </form>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

function RichTextToolSvg({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" height="19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="19">
      {children}
    </svg>
  );
}

function RichTextLinkIcon() {
  return (
    <RichTextToolSvg>
      <path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
      <path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1" />
    </RichTextToolSvg>
  );
}

function RichTextCodeIcon() {
  return (
    <RichTextToolSvg>
      <path d="m8 8-4 4 4 4" />
      <path d="m16 8 4 4-4 4" />
      <path d="m14 5-4 14" />
    </RichTextToolSvg>
  );
}

function RichTextBulletedListIcon() {
  return (
    <RichTextToolSvg>
      <path d="M9 7h11" />
      <path d="M9 12h11" />
      <path d="M9 17h11" />
      <path d="M4 7h.01" />
      <path d="M4 12h.01" />
      <path d="M4 17h.01" />
    </RichTextToolSvg>
  );
}

function RichTextNumberedListIcon() {
  return (
    <RichTextToolSvg>
      <path d="M10 7h10" />
      <path d="M10 12h10" />
      <path d="M10 17h10" />
      <path d="M4 6h1v4" />
      <path d="M4 10h2" />
      <path d="M4 14.5a1.5 1.5 0 0 1 3 0c0 .7-.5 1.1-1.2 1.6L4 17.5h3" />
    </RichTextToolSvg>
  );
}

function RichTextIndentIcon() {
  return (
    <RichTextToolSvg>
      <path d="M11 7h9" />
      <path d="M11 12h9" />
      <path d="M11 17h9" />
      <path d="m4 8 3 4-3 4" />
    </RichTextToolSvg>
  );
}

export function RichTextAiRephraseIcon() {
  return (
    <RichTextToolSvg>
      <path d="m14.5 4.5 5 5" />
      <path d="m4 20 4.25-1.25L19.5 7.5l-3-3L5.25 15.75Z" />
      <path d="m13 6 3 3" />
      <path d="M5 4.5 6 7l2.5 1L6 9 5 11.5 4 9 1.5 8 4 7Z" />
      <path d="M19 14.5 20 17l2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1Z" />
    </RichTextToolSvg>
  );
}
