import type { ReactNode } from "react";
import "./DetailSectionTabs.css";

export type DetailSectionTab<T extends string> = {
  value: T;
  label: string;
  icon: ReactNode;
  count?: number;
  description?: string;
};

export function DetailSectionTabs<T extends string>({
  activeTab,
  ariaLabel,
  className = "",
  items,
  presentation = "compact",
  onChange
}: {
  activeTab: T;
  ariaLabel: string;
  className?: string;
  items: Array<DetailSectionTab<T>>;
  presentation?: "compact" | "inline";
  onChange: (value: T) => void;
}) {
  return (
    <div className={["detail-section-tabs", presentation === "inline" ? "detail-section-tabs--inline" : "", className].filter(Boolean).join(" ")} role="tablist" aria-label={ariaLabel}>
      {items.map((item, index) => (
        <button
          aria-selected={activeTab === item.value}
          className={activeTab === item.value ? "detail-section-tab is-active" : "detail-section-tab"}
          key={item.value}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => {
            const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
              : event.key === "ArrowRight" ? (index + 1) % items.length
              : event.key === "ArrowLeft" ? (index - 1 + items.length) % items.length : null;
            if (nextIndex === null) return;
            event.preventDefault();
            onChange(items[nextIndex].value);
            const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
            tabs?.[nextIndex]?.focus();
          }}
          role="tab"
          tabIndex={activeTab === item.value ? 0 : -1}
          title={presentation === "inline" ? item.description : undefined}
          type="button"
        >
          <span className="detail-section-tab-icon">{item.icon}</span>
          <span className="detail-section-tab-copy"><strong>{item.label}</strong>{presentation !== "inline" && item.description ? <small>{item.description}</small> : null}</span>
          {typeof item.count === "number" ? <span className="detail-section-tab-count">{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
