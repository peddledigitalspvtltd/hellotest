import { useMemo } from "react";
import {
  summarizeCatalogDescription,
  type CatalogDescriptionProfile
} from "../lib/catalogDescriptionSummary";

export function CatalogCardDescription({
  fallback,
  profile,
  value
}: {
  fallback: string;
  profile: CatalogDescriptionProfile;
  value?: string | null;
}) {
  const summary = useMemo(
    () => summarizeCatalogDescription(value, { fallback, profile }),
    [fallback, profile, value]
  );

  return (
    <div
      className="catalog-card-description-block"
      data-omitted-section={summary.omittedSection || undefined}
    >
      <span className="catalog-card-field-label">Description</span>
      <p
        className="catalog-card-description-summary"
        title={summary.wasCharacterTruncated ? summary.narrativeText : undefined}
      >
        {summary.text}
      </p>
    </div>
  );
}
