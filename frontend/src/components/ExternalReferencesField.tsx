import { useId, useMemo, useState } from "react";
import { IconLink as LinkIcon, IconX } from "@tabler/icons-react";

import { formatReferenceList, parseReferenceList } from "../lib/externalReferences";
import { FormField } from "./FormField";

export function ExternalReferencesField({
  className = "",
  disabled = false,
  placeholder = "Paste Jira links, docs, IDs; press ; to add",
  value,
  onChange
}: {
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draftReference, setDraftReference] = useState("");
  const inputId = `external-reference-${useId().replace(/:/g, "")}`;
  const references = useMemo(() => parseReferenceList(value), [value]);

  const commitReference = (rawReference: string) => {
    const normalizedReference = rawReference.trim();
    if (!normalizedReference) return;
    if (references.some((reference) => reference.toLowerCase() === normalizedReference.toLowerCase())) {
      setDraftReference("");
      return;
    }
    onChange(formatReferenceList([...references, normalizedReference]));
    setDraftReference("");
  };

  const removeReference = (referenceToRemove: string) => {
    onChange(formatReferenceList(references.filter((reference) => reference.toLowerCase() !== referenceToRemove.toLowerCase())));
  };

  return (
    <FormField
      className={["canonical-external-references-field", className].filter(Boolean).join(" ")}
      composite
      inputId={inputId}
      label="External references"
      labelIcon={<LinkIcon size={15} />}
      hint="Type a reference, then press semicolon or Enter to add it."
    >
      <div className="requirement-reference-picker">
        <div className="requirement-reference-entry">
          <input
            aria-describedby={`${inputId}-hint`}
            aria-label="Add external reference"
            disabled={disabled}
            id={inputId}
            placeholder={placeholder}
            value={draftReference}
            onBlur={() => commitReference(draftReference)}
            onChange={(event) => {
              const nextValue = event.target.value;
              if (/[;\n]$/.test(nextValue)) {
                commitReference(nextValue.replace(/[;\n]+$/g, ""));
                return;
              }
              setDraftReference(nextValue);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ";") {
                event.preventDefault();
                commitReference(draftReference);
              }
            }}
          />
          <button className="ghost-button requirement-label-add-button" disabled={disabled || !draftReference.trim()} onClick={() => commitReference(draftReference)} type="button">
            Add
          </button>
        </div>
        {references.length ? (
          <div className="requirement-reference-chip-row">
            {references.map((reference) => {
              const content = /^https?:\/\//i.test(reference) ? (
                <a href={reference} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank">
                  {reference}
                </a>
              ) : <span>{reference}</span>;

              return (
                <span className="requirement-reference-chip" key={reference} title={`Remove ${reference}`}>
                  {content}
                  <button aria-label={`Remove ${reference}`} disabled={disabled} onClick={() => removeReference(reference)} type="button">
                    <IconX aria-hidden="true" size={13} stroke={2.2} />
                  </button>
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
    </FormField>
  );
}
