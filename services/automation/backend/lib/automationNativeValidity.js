// Keep this browser-side read identical to TestEngine's exported reader. The
// independently packaged runtimes verify AST and real-browser parity in tests.
function readNativeConstraintValidity(element) {
  if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return null;
  if (!('willValidate' in element) || element.willValidate !== true || !('validity' in element)) return null;
  const validity = element.validity;
  return validity && typeof validity === 'object' && 'valid' in validity && typeof validity.valid === 'boolean' ? validity.valid : null;
}

module.exports = { readNativeConstraintValidity, nativeConstraintValiditySource: readNativeConstraintValidity.toString() };
