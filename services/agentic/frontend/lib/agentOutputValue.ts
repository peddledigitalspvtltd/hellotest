/** Readable export/cell text for untrusted, potentially nested tool output. */
export function agentOutputText(value: unknown, depth = 0): string {
  let remaining = 500;
  const visit = (item: unknown, level: number): string => {
    if (remaining-- <= 0) return 'Display limit reached · open JSON for full details';
    if (item === null || item === undefined) return 'Not supplied';
    if (typeof item === 'string') return item;
    if (typeof item === 'boolean') return item ? 'Yes' : 'No';
    if (typeof item === 'number') return Number.isFinite(item) ? String(item) : 'Not measured';
    if (level >= 6) return 'Nested data · open JSON for full details';
    if (Array.isArray(item)) {
      const values: string[] = [];
      for (const child of item.slice(0, 100)) { values.push(visit(child, level + 1)); if (remaining <= 0) break; }
      return values.length ? values.join('\n') : 'No items';
    }
    if (typeof item === 'object') {
      const values: string[] = [];
      for (const [key, child] of Object.entries(item).slice(0, 100)) { values.push(`${agentOutputLabel(key)}: ${visit(child, level + 1)}`); if (remaining <= 0) break; }
      return values.length ? values.join('\n') : 'No fields';
    }
    return 'Unsupported value';
  };
  return visit(value, depth);
}

export function agentOutputLabel(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase());
}

export function agentOutputRows(value: unknown): { rows: Record<string, unknown>[]; columns: string[] } | null {
  if (!Array.isArray(value) || !value.length || !value.every(item => item !== null && typeof item === 'object' && !Array.isArray(item))) return null;
  const rows = value.slice(0, 100) as Record<string, unknown>[];
  return { rows, columns: [...new Set(rows.flatMap(row => Object.keys(row)))].slice(0, 12) };
}
