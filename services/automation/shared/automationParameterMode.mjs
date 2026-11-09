export const PARAMETER_EXPRESSIONS_MARKER = '// @hellotest-parameter-bindings expressions-v1';

/** Portable section provenance, only before executable source. String and
 * block-comment contents never opt a program into another binding mode. */
export function usesExpressionParameterBindings(source) {
  const code = String(source || '');
  let offset = code.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (offset < code.length) {
    const whitespace = code.slice(offset).match(/^\s*/)[0]; offset += whitespace.length;
    if (code.startsWith('//', offset)) {
      const boundary = code.slice(offset).search(/[\r\n]/), end = boundary < 0 ? -1 : offset + boundary;
      const line = code.slice(offset, end < 0 ? code.length : end).trimEnd();
      if (line === PARAMETER_EXPRESSIONS_MARKER) return true;
      if (end < 0) return false;
      offset = end + 1;
    } else if (code.startsWith('/*', offset)) {
      const end = code.indexOf('*/', offset + 2); if (end < 0) return false;
      offset = end + 2;
    } else return false;
  }
  return false;
}

export function markExpressionParameterBindings(source) {
  return usesExpressionParameterBindings(source) ? source : `${PARAMETER_EXPRESSIONS_MARKER}\n${source}`;
}
