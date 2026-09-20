/** Capitalize metric words without damaging acronyms, numbers, or punctuation. */
export function metricTitle(label: string): string {
  return label.replace(/(^|[\s/\-–—(])([\p{L}])/gu, (_, boundary: string, letter: string) => boundary + letter.toLocaleUpperCase());
}
