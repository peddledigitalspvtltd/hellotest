async function mapWithConcurrency(items, concurrency, mapper) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError("concurrency must be a positive integer");
  const results = new Array(items.length);
  let cursor = 0;
  let failed = false;
  let failure;
  const worker = async () => {
    while (!failed && cursor < items.length) {
      const index = cursor++;
      try { results[index] = await mapper(items[index], index); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  };
  // Drain in-flight work before returning the first error. A caller can then
  // roll back or release resources without workers continuing in the background.
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failed) throw failure;
  return results;
}

module.exports = { mapWithConcurrency };
