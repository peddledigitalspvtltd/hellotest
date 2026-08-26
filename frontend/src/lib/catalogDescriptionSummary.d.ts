export type CatalogDescriptionProfile = "project" | "story" | "test-case";

export type CatalogDescriptionSummary = {
  text: string;
  narrativeText: string;
  fullText: string;
  wasTruncated: boolean;
  wasCharacterTruncated: boolean;
  omittedSection: string;
};

export type CatalogDescriptionSummaryOptions = {
  fallback: string;
  maxCharacters?: number;
  profile: CatalogDescriptionProfile;
};

export function summarizeCatalogDescription(
  value: string | null | undefined,
  options: CatalogDescriptionSummaryOptions
): CatalogDescriptionSummary;
