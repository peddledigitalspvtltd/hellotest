const attachments = require('@hellotest/platform/backend/services/attachment.service');
const execution = require('@hellotest/knowledge/backend/services/knowledgeExecution.service');

const isTextAttachment = item => /^(?:text\/|application\/(?:json|xml|javascript|x-ndjson|yaml))/i.test(String(item.mime_type || ''));
async function excerpt({ item, projectId, user, timeoutMs = 600 }) {
  if (!isTextAttachment(item)) return { id:item.id, status:'metadata_only', reason:'Use authorized indexed extraction or supplied compressed images for this file type.' };
  if (Number(item.size_bytes) > 64000) return { id:item.id, status:'metadata_only', reason:'File exceeds the bounded live attachment read; use indexed extraction.' };
  try {
    return await execution.bounded(async signal => {
      const { row, stream } = await attachments.download({ user, id:item.id });
      const stop = () => stream.destroy();
      signal.addEventListener('abort', stop, { once:true });
      try {
        if (signal.aborted) { stop(); throw execution.abortError(); }
        if (row.project_id !== projectId || row.entity_type !== 'requirement' || row.entity_id !== item.story_id) {
          throw Object.assign(new Error('Attachment scope changed.'), { code:'ATTACHMENT_SCOPE_MISMATCH' });
        }
        const chunks=[];let bytes=0,truncated=false;
        for await (const chunk of stream) {
          execution.assertActive();
          const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
          const remaining=16000-bytes;
          chunks.push(buffer.subarray(0,remaining));bytes+=Math.min(buffer.length,remaining);
          if (buffer.length > remaining || bytes >= 16000) { truncated=true;break; }
        }
        const content=Buffer.concat(chunks).toString('utf8');
        return { id:item.id, story_id:item.story_id, status:'excerpt', excerpt:content.slice(0,600),
          excerpt_truncated:truncated||content.length>600, checksum_sha256:row.checksum_sha256||null,
          limitation:'Only this bounded text excerpt was read; omitted content is unknown.' };
      } finally { signal.removeEventListener('abort',stop);stream.destroy(); }
    }, { timeoutMs });
  } catch (error) {
    execution.assertActive();
    return { id:item.id, story_id:item.story_id, status:'unavailable', reason:error.code==='ATTACHMENT_SCOPE_MISMATCH'?'Attachment scope changed.':'Attachment text could not be read within the authorized retrieval budget.' };
  }
}
module.exports = { excerpt, isTextAttachment };
