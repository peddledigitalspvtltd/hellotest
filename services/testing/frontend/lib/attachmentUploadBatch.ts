/** Upload independently, retaining failed file objects for a safe retry. */
export async function uploadAttachmentBatch<T>(files: readonly T[], upload: (file: T) => Promise<unknown>, concurrency = 3): Promise<{ uploaded: number; failed: T[]; firstError: string }> {
  const failedIndexes = new Set<number>();
  let cursor = 0;
  let uploaded = 0;
  let firstError = "";
  const worker = async () => {
    while (cursor < files.length) {
      const index = cursor++;
      try { await upload(files[index]); uploaded += 1; }
      catch (error) {
        failedIndexes.add(index);
        if (!firstError) firstError = error instanceof Error ? error.message : "The upload could not be completed.";
      }
    }
  };
  const workerCount = Math.min(files.length, Math.max(1, Math.trunc(concurrency) || 1));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return { uploaded, failed: files.filter((_, index) => failedIndexes.has(index)), firstError };
}
