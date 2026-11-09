import type { Page } from "playwright";
import { resolveRepositoryLocator } from "./repositoryLocator.js";

type Candidate = { locator: string; confidenceScore: number; matchCount: number; warning: string | null; recommended: boolean };

/** Capture-time DOM guesses cannot establish Playwright matching semantics.
 * Recheck every candidate and keep only selectors containing the clicked node. */
export async function validateInspectionLocatorCandidates<T extends Candidate>(page: Page, candidates: T[], selectionToken?: string): Promise<T[]> {
  const checked = await Promise.all(candidates.map(async (candidate): Promise<T | null> => {
    try {
      const locator = resolveRepositoryLocator(page, candidate.locator);
      const matchCount = await locator.count();
      const identifiesSelection = !selectionToken || await locator.evaluateAll((elements, token) => {
        const target = (window as typeof window & { __hellotestInspectTargets?: Map<string, Element> }).__hellotestInspectTargets?.get(token);
        return Boolean(target && elements.includes(target as HTMLElement));
      }, selectionToken);
      if (!identifiesSelection) return null;
      const warning = matchCount !== 1 ? `Matches ${matchCount} elements on this screen.`
        : /^Matches \d+ elements/.test(candidate.warning || "") ? null : candidate.warning;
      const confidenceScore = candidate.matchCount === 1 && matchCount !== 1 ? Math.max(0.25, candidate.confidenceScore - 0.24) : candidate.confidenceScore;
      return { ...candidate, matchCount, confidenceScore, warning, recommended: matchCount === 1 && confidenceScore >= 0.9 && !warning };
    } catch { return null; }
  }));
  const valid: T[] = [];
  for (const candidate of checked) if (candidate !== null) valid.push(candidate as T);
  return valid.sort((left, right) => Number(right.matchCount === 1) - Number(left.matchCount === 1) || right.confidenceScore - left.confidenceScore);
}
