import { platformApi } from '@hellotest/platform/client';
import { buildFileContextSection, SMART_CONTEXT_START, SMART_CONTEXT_END } from '@hellotest/ai/frontend/lib/aiDesignStudio';
import { attachmentChecksum } from '@hellotest/manual/frontend/lib/attachmentChecksum';

export async function prepareAiPromptFiles({ projectId, files, additionalContext, signal, maxContextChars = 18_000 }: {projectId:string;files:File[];additionalContext:string;signal?:AbortSignal;maxContextChars?:number}) {
  if (additionalContext.length > maxContextChars) throw new Error(`The existing context exceeds the ${maxContextChars.toLocaleString()} character authoring limit. Shorten the context before generating.`);
  if (!files.length) return { additionalContext, attachmentIds:[] as string[] };
  if (files.length > 12) throw new Error('Select at most twelve prompt files and reference images.');
  const meta = await platformApi.attachments.meta();
  if (!meta.enabled) throw new Error('Enable attachment storage before generating with files so the supplied evidence can be retained.');
  if (files.some(file => !file.size || file.size > meta.uploadLimit)) throw new Error('Remove empty files or files above the configured attachment limit.');
  const documents = files.filter(file => !file.type.startsWith('image/'));
  const context = await buildFileContextSection(documents);
  if (context.overLimit) throw new Error(context.blocked.join(' '));
  if (context.skipped.length) throw new Error(`These files cannot be read as prompt text: ${context.skipped.join(', ')}. Supply a text, Markdown, CSV, JSON, XML, YAML, or Gherkin file, or add a supported screenshot.`);
  const references = [];
  for (const file of files) {
    signal?.throwIfAborted();
    const checksumSha256 = await attachmentChecksum(await file.arrayBuffer());
    const attachment = await platformApi.attachments.upload({project_id:projectId,entity_type:'project',entity_id:projectId},file,{checksumSha256});
    signal?.throwIfAborted();
    let access: {url:string;expires_at:string}|null = null;
    try { access = await platformApi.attachments.aiAccess(attachment.id,projectId); }
    catch (error) {
      // Private/local deployments still supply extracted text and inline image
      // bytes. They must never publish an internal/loopback URL to a provider.
      if ((error as {status?:number;statusCode?:number}).status !== 503 && (error as {statusCode?:number}).statusCode !== 503) throw error;
    }
    references.push({id:attachment.id,name:file.name,mime_type:file.type,checksum_sha256:checksumSha256,...(access||{})});
  }
  const evidence = JSON.stringify({files:references,text_excerpts:context.section,content_boundary:'Only the supplied excerpts and image bytes are provided as model input. File links are temporary source references; URL text alone does not prove the model fetched a document.'});
  const packed = [additionalContext,`${SMART_CONTEXT_START}\n${evidence}\n${SMART_CONTEXT_END}`].filter(Boolean).join('\n\n');
  if (packed.length > maxContextChars) throw new Error(`The files and existing context exceed the ${maxContextChars.toLocaleString()} character authoring limit. Select fewer files or shorten the context.`);
  return {additionalContext:packed,attachmentIds:references.map(item=>item.id)};
}
