const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const normalizeInlineArtifactRefs = (artifactBundle) => {
  const refs = Array.isArray(artifactBundle?.artifact_refs) ? artifactBundle.artifact_refs : [];

  return refs
    .filter((ref) => ref && typeof ref === "object" && !Array.isArray(ref))
    .map((ref) => {
      const fileName = normalizeText(ref.file_name || ref.fileName)
        || normalizeText(ref.path)?.split("/").pop()
        || `${normalizeText(ref.kind) || "artifact"}.bin`;
      const contentType = normalizeText(ref.content_type || ref.mime_type || ref.mimeType) || "application/octet-stream";
      const contentBase64 = normalizeText(ref.content_base64 || ref.contentBase64);
      const dataUrl = normalizeText(ref.data_url || ref.dataUrl);
      const content = dataUrl || (contentBase64 ? `data:${contentType};base64,${contentBase64}` : null);

      return content
        ? {
            file_name: fileName,
            mime_type: contentType,
            content
          }
        : null;
    })
    .filter(Boolean);
};

// Artifact persistence is a supplied port: this module owns evidence formatting
// and failure isolation, not workspace storage or execution outcome updates.
const createInlineArtifactAttacher = (createArtifact) => async (transactionId, artifactBundle) => {
  if (!transactionId) return [];
  const created = [];
  for (const ref of normalizeInlineArtifactRefs(artifactBundle)) {
    try { created.push(await createArtifact(transactionId, ref)); }
    catch { /* Evidence storage must not reject a completed execution. */ }
  }
  return created;
};

const screenshotCaptureAllowed = (policy = {}, outcome, failureOverride = false) => {
  const failed = outcome === 'failed' || outcome === 'blocked';
  if (failed && failureOverride) return true;
  if (policy.screenshot_mode === 'all') return true;
  if (policy.screenshot_mode === 'passed') return !failed;
  if (policy.screenshot_mode === 'failed') return failed;
  if (policy.screenshot_mode === 'off') return false;
  return failed ? policy.screenshot_on_failure !== false : policy.screenshot_on_success === true;
};

const hasFailureScreenshotOverride = (steps = [], hooks = []) => [...(Array.isArray(steps) ? steps : []), ...(Array.isArray(hooks) ? hooks : []).flatMap(hook => Array.isArray(hook?.steps) ? hook.steps : [])].some(step => {
  const directive = String(step?.automation_code || '').match(/^\s*\/\/\s*@hellotest-options\s+([^\r\n]*)/i)?.[1] || '';
  return directive.split(/\s+/).includes('screenshotOnFailure');
});

module.exports = { normalizeInlineArtifactRefs, createInlineArtifactAttacher, screenshotCaptureAllowed, hasFailureScreenshotOverride };
