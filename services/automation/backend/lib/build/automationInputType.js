// Keep this browser-only read identical to the independently packaged
// TestEngine reader. It checks the native effective type, never an attribute.
function readEffectiveInputType(element) {
    return element instanceof HTMLInputElement ? element.type : null;
}

module.exports = { readEffectiveInputType, effectiveInputTypeSource: readEffectiveInputType.toString() };
