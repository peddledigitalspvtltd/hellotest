export type PendingStoryAttachments = {
  projectId: string;
  storyId: string;
  storyTitle: string;
  files: File[];
  errors: string[];
};

export function validateStoryPromptFiles(files: File[], meta: { enabled: boolean; uploadLimit: number }) {
  if (!files.length) return;
  if (!meta.enabled) throw new Error('Attachments are disabled. Enable attachment storage before accepting Stories with prompt files.');
  const invalid = files.find(file => !file.size || !Number.isFinite(meta.uploadLimit) || meta.uploadLimit <= 0 || file.size > meta.uploadLimit);
  if (invalid) throw new Error(`${invalid.name} is empty or exceeds the configured attachment limit. Remove it before accepting the Story.`);
}

export async function uploadStoryPromptFiles(input: Omit<PendingStoryAttachments, 'errors'>, {
  upload,
  uploadLimit
}: {
  upload: (scope: { project_id: string; entity_type: 'requirement'; entity_id: string }, file: File, options: { checksumSha256: string }) => Promise<unknown>;
  uploadLimit: number;
}): Promise<PendingStoryAttachments | null> {
  validateStoryPromptFiles(input.files, { enabled: true, uploadLimit });
  const remaining: File[] = [], errors: string[] = [];
  for (const file of input.files) {
    try {
      // One bounded original at a time; preview compression never replaces the
      // actual user file. The server verifies this digest and deduplicates it.
      const checksumSha256 = await attachmentChecksum(await file.arrayBuffer());
      await upload({ project_id: input.projectId, entity_type: 'requirement', entity_id: input.storyId }, file, { checksumSha256 });
    } catch (error) {
      remaining.push(file);
      errors.push(`${file.name}: ${error instanceof Error ? error.message : 'upload failed'}`);
    }
  }
  return remaining.length ? { ...input, files: remaining, errors } : null;
}
import {attachmentChecksum} from './attachmentChecksum';
