const executionCache = new Map();
const invalidateExecutionCache = id => executionCache.delete(id);
module.exports = { executionCache, invalidateExecutionCache };
