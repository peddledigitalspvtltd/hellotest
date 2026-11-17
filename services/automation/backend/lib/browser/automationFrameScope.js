// Shape validation does not grant frame authority. MCP inventory and the
// current immutable host snapshot remain the authority for every operation.
const validFramePath = value => Array.isArray(value) && value.length > 0 && value.length <= 3
  && value.every(item => typeof item === 'string' && item.length > 0 && item.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(item));
const framePathKey = value => JSON.stringify(value || []);
function snapshotFrameScope(page) {
  if (page?.frame_path === undefined) return page?.frame_url !== undefined || page?.frame_document_id !== undefined
    ? null : { path: [], identity: 'main' };
  if (!validFramePath(page.frame_path) || typeof page.frame_document_id !== 'string'
    || !/^[A-Za-z0-9_.:-]{1,200}$/.test(page.frame_document_id) || typeof page.frame_url !== 'string') return null;
  try {
    const parent = new URL(page.url), child = new URL(page.frame_url);
    if (!['http:', 'https:'].includes(parent.protocol) || child.origin !== parent.origin || child.username || child.password) return null;
  } catch { return null; }
  return { path: [...page.frame_path], url: page.frame_url, document_id: page.frame_document_id,
    identity: JSON.stringify([page.frame_path, page.frame_url, page.frame_document_id]) };
}
module.exports = { validFramePath, framePathKey, snapshotFrameScope };
