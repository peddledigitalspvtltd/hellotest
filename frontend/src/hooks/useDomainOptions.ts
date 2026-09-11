import type { DomainOption } from "../types";
import { getDomainOptions, getDomainSuggestions } from "../lib/domainOptions";
import { useDomainMetadata } from "./useDomainMetadata";

export function useDomainOptions(field: string, fallback: readonly DomainOption[] = [], currentValues: readonly string[] = []) {
  return getDomainOptions(useDomainMetadata().data, field, fallback, currentValues);
}

export function useDomainSuggestions(field: string, observed: readonly string[] = []) {
  return getDomainSuggestions(useDomainMetadata().data, field, observed);
}
