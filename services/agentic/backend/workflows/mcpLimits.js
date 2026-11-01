// Catalog schemas can exceed a normal tool result. Keep discovery separately
// bounded across all pages without increasing the execution response limit.
module.exports = Object.freeze({ MAX_CATALOG_BYTES: 512 * 1024, MAX_CATALOG_TOOLS: 100, MAX_CATALOG_PAGES: 5 });
