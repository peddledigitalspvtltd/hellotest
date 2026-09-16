import { useEffect, useId, useMemo, useRef, useState } from "react";

import { formatReferenceList, parseReferenceList } from "../lib/externalReferences";
import { resolveDomainSuggestionValue } from "../lib/domainOptions";
import type { DomainOption } from "../types";
import { TagIcon } from "./AppIcons";
import { FormField } from "./FormField";

export function LabelsField({
  className = "",
  label = "Labels",
  placeholder = "Select or add label",
  value,
  options = [],
  required = false,
  disabled = false,
  onChange
}: {
  className?: string;
  label?: string;
  placeholder?: string;
  value: string;
  options?: Array<string | Pick<DomainOption, "value" | "label">>;
  required?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [draftLabel, setDraftLabel] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeLabelIndex, setActiveLabelIndex] = useState(0);
  const inputId = `labels-${useId().replace(/:/g, "")}`;
  const menuId = `${inputId}-options`;
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const suggestions = useMemo(() => options.map(option => typeof option === "string" ? { value: option, label: option } : option), [options]);
  const selectedLabels = useMemo(() => {
    const seen = new Set<string>();
    return parseReferenceList(value).filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [value]);
  const filteredLabels = useMemo(() => {
    const selected = new Set(selectedLabels.map((item) => item.toLowerCase()));
    const query = draftLabel.trim().toLowerCase();
    return suggestions
      .filter((item) => !selected.has(item.value.toLowerCase()))
      .filter((item) => !query || `${item.label} ${item.value}`.toLowerCase().includes(query));
  }, [draftLabel, suggestions, selectedLabels]);
  const normalizedDraftLabel = draftLabel.trim();
  const canAddDraftLabel = Boolean(
    normalizedDraftLabel
    && !filteredLabels.some((item) => [item.value, item.label].some(value => value.toLowerCase() === normalizedDraftLabel.toLowerCase()))
  );
  const menuOptions = canAddDraftLabel ? [...filteredLabels, { value: normalizedDraftLabel, label: normalizedDraftLabel }] : filteredLabels;

  useEffect(() => {
    setActiveLabelIndex((current) => Math.min(current, Math.max(0, menuOptions.length - 1)));
  }, [menuOptions.length]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node | null)) setIsMenuOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [isMenuOpen]);

  const commitLabel = (rawLabel: string) => {
    if (disabled) return;
    const nextLabel = resolveDomainSuggestionValue(rawLabel, suggestions);
    if (!nextLabel) return;
    if (!selectedLabels.some((item) => item.toLowerCase() === nextLabel.toLowerCase())) {
      onChange(formatReferenceList([...selectedLabels, nextLabel]));
    }
    setDraftLabel("");
    setIsMenuOpen(false);
  };

  const removeLabel = (labelToRemove: string) => {
    if (disabled) return;
    onChange(formatReferenceList(selectedLabels.filter((item) => item.toLowerCase() !== labelToRemove.toLowerCase())));
  };

  return (
    <FormField
      className={["canonical-labels-field", className].filter(Boolean).join(" ")}
      composite
      inputId={inputId}
      label={label}
      labelIcon={<TagIcon size={15} />}
      required={required}
    >
      <div className="requirement-label-picker" ref={pickerRef}>
        <div className="requirement-label-combobox">
          <div className="requirement-label-entry">
            <input
              disabled={disabled}
              aria-activedescendant={isMenuOpen && menuOptions.length ? `${menuId}-${activeLabelIndex}` : undefined}
              aria-autocomplete="list"
              aria-controls={menuId}
              aria-expanded={isMenuOpen}
              aria-haspopup="listbox"
              aria-label={`Select or add ${label.toLowerCase()}`}
              id={inputId}
              placeholder={placeholder}
              required={required && !selectedLabels.length}
              role="combobox"
              value={draftLabel}
              onChange={(event) => {
                setDraftLabel(event.target.value);
                setIsMenuOpen(true);
              }}
              onFocus={() => setIsMenuOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const isOpeningMenu = !isMenuOpen;
                  setIsMenuOpen(true);
                  setActiveLabelIndex((current) => {
                    if (!menuOptions.length) return 0;
                    if (isOpeningMenu) return event.key === "ArrowDown" ? 0 : menuOptions.length - 1;
                    const delta = event.key === "ArrowDown" ? 1 : -1;
                    return (current + delta + menuOptions.length) % menuOptions.length;
                  });
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitLabel((isMenuOpen && menuOptions[activeLabelIndex]?.value) || normalizedDraftLabel);
                }
                if (event.key === "Escape") setIsMenuOpen(false);
              }}
            />
            {normalizedDraftLabel ? (
              <button className="ghost-button requirement-label-add-button" disabled={disabled} onClick={() => commitLabel(normalizedDraftLabel)} type="button">
                Add
              </button>
            ) : null}
          </div>
          {!disabled && isMenuOpen && menuOptions.length ? (
            <div aria-label={`Available ${label.toLowerCase()}`} className="requirement-label-menu" id={menuId} role="listbox">
              {filteredLabels.map((item, index) => (
                <button
                  aria-selected={activeLabelIndex === index}
                  className="requirement-label-menu-option"
                  id={`${menuId}-${index}`}
                  key={item.value}
                  onClick={() => commitLabel(item.value)}
                  onMouseEnter={() => setActiveLabelIndex(index)}
                  role="option"
                  type="button"
                >
                  {item.label}
                </button>
              ))}
              {canAddDraftLabel ? (
                <button
                  aria-selected={activeLabelIndex === filteredLabels.length}
                  className="requirement-label-menu-option is-add"
                  id={`${menuId}-${filteredLabels.length}`}
                  onClick={() => commitLabel(normalizedDraftLabel)}
                  onMouseEnter={() => setActiveLabelIndex(filteredLabels.length)}
                  role="option"
                  type="button"
                >
                  Add "{normalizedDraftLabel}"
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {selectedLabels.length ? (
          <div className="requirement-label-chip-row">
            {selectedLabels.map((item) => (
              <button
                aria-label={`Remove label ${item}`}
                disabled={disabled}
                className="requirement-label-chip"
                key={item}
                onClick={() => removeLabel(item)}
                title={`Remove ${item}`}
                type="button"
              >
                <span>{item}</span>
                <strong aria-hidden="true">×</strong>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </FormField>
  );
}
