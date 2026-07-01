import { type CSSProperties, type ElementType, type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";

type RichTextEditorProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

type RichTextContentProps = {
  value?: string | null;
  fallback?: string;
  className?: string;
  as?: ElementType;
  title?: string;
};

const ALLOWED_TAGS = new Set(["a", "b", "blockquote", "br", "code", "div", "em", "h3", "i", "li", "ol", "p", "span", "strong", "u", "ul"]);
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

export function sanitizeRichTextHtml(value: string) {
  if (!value.trim()) {
    return "";
  }

  if (typeof document === "undefined") {
    return escapeHtml(value);
  }

  const template = document.createElement("template");
  template.innerHTML = isLikelyHtml(value) ? value : markdownToHtml(value);

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
    return value
      .replace(/<[^>]+>/g, " ")
      .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
      .replace(/[*_`#>]/g, "")
      .replace(/^\s*[-\d.]+\s+/gm, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const container = document.createElement("div");
  container.innerHTML = normalizeRichTextHtml(value);
  return (container.textContent || "").replace(/\s+/g, " ").trim();
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

  return (
    <Component
      className={["rich-text-content", className].filter(Boolean).join(" ")}
      dangerouslySetInnerHTML={{ __html: html }}
      title={title}
    />
  );
}

export function RichTextEditor({
  id,
  value,
  onChange,
  rows = 4,
  placeholder,
  required,
  disabled,
  className = "",
  "aria-label": ariaLabel
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastHtmlRef = useRef("");
  const isEmpty = !richTextToPlainText(value);

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

  const createLink = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || disabled) {
      return;
    }

    editor.focus();
    const selection = window.getSelection();
    const selectedText = selection?.toString() || "link";
    const url = window.prompt("Link URL", "https://");
    if (url === null) {
      return;
    }

    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) {
      return;
    }

    if (selection?.rangeCount && !selection.isCollapsed && isSelectionInside(editor)) {
      document.execCommand("createLink", false, safeUrl);
      emitChange();
      return;
    }

    insertHtml(`<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">${escapeHtml(selectedText)}</a>`);
  }, [disabled, emitChange, insertHtml]);

  const controls: Array<{ label: ReactNode; title: string; action: () => void }> = [
    { label: <strong>B</strong>, title: "Bold", action: () => runCommand("bold") },
    { label: <em>I</em>, title: "Italic", action: () => runCommand("italic") },
    { label: "H", title: "Heading", action: () => runCommand("formatBlock", "H3") },
    { label: "•", title: "Bulleted list", action: () => runCommand("insertUnorderedList") },
    { label: "1.", title: "Numbered list", action: () => runCommand("insertOrderedList") },
    { label: "“”", title: "Quote", action: () => runCommand("formatBlock", "BLOCKQUOTE") },
    { label: "<>", title: "Inline code", action: wrapSelectionWithCode },
    { label: "↗", title: "Link", action: createLink }
  ];

  const editorStyle = {
    "--rich-text-editor-min-height": `${Math.max(3.4, rows * 1.45 + 0.95)}rem`
  } as CSSProperties;

  return (
    <div className={["rich-text-editor", className].filter(Boolean).join(" ")}>
      <div className="rich-text-editor-toolbar" aria-label="Rich text tools">
        {controls.map((control) => (
          <button
            aria-label={control.title}
            className="rich-text-tool-button"
            disabled={disabled}
            key={control.title}
            onClick={control.action}
            onMouseDown={(event) => event.preventDefault()}
            title={control.title}
            type="button"
          >
            {control.label}
          </button>
        ))}
      </div>
      <div
        aria-label={ariaLabel}
        aria-multiline="true"
        aria-required={required || undefined}
        className="rich-text-editor-surface"
        contentEditable={!disabled}
        data-empty={isEmpty ? "true" : "false"}
        data-placeholder={placeholder || ""}
        id={id}
        onBlur={emitChange}
        onInput={emitChange}
        ref={editorRef}
        role="textbox"
        style={editorStyle}
        suppressContentEditableWarning
      />
    </div>
  );
}
