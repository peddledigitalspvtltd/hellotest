type CapturedInput = { index: number; type: string; locator?: string | null; text?: string | null; value?: string | null };
const privateField = /password|secret|token|credential|api.?key|passcode|(?:^|[._ -])pin(?:$|[._ -])|otp|verification.?code|one.?time.?code/i;

/** Display-only projection. The original capture remains intact so a private
 * input can still be bound to a configured parameter before it is saved. */
export function createRecorderDisplayPrivacy(actions: CapturedInput[], privateValues: string[] = [], privateBindings: Set<number> = new Set()) {
  const isPrivateInput = (action: CapturedInput) => privateBindings.has(action.index)
    || ['fill', 'change', 'select', 'upload'].includes(action.type) && privateField.test(`${action.locator || ''} ${action.text || ''}`);
  const values = [...new Set([...privateValues, ...actions.filter(isPrivateInput).map(action => action.value || '')].filter(Boolean))]
    .flatMap(value => [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)]).sort((a, b) => b.length - a.length);
  const text = (value?: string | null) => {
    let projected = value || '';
    for (const secret of values) projected = projected.split(secret).join('[private input]');
    return projected;
  };
  const url = (value?: string | null) => {
    if (!value) return 'Current page';
    try {
      const parsed = new URL(value);
      for (const key of new Set(parsed.searchParams.keys())) {
        const original = parsed.searchParams.getAll(key), projected = original.map(value => privateField.test(key) ? '[private input]' : text(value));
        if (projected.some((value, index) => value !== original[index])) {
          parsed.searchParams.delete(key);
          for (const value of projected) parsed.searchParams.append(key, value);
        }
      }
      return text(`${parsed.pathname}${parsed.search}`);
    } catch { return text(value); }
  };
  return { text, url, actionText: (action: CapturedInput) => isPrivateInput(action) ? '[private input]' : text(action.text || action.value) };
}
