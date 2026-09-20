// Only deployment-owned table/column definitions from the deletion repository
// can reach DDL. Run outside a transaction on the worker's dedicated session.
const readIndexes = async (client, index) => {
  const { rows } = await client.query(`SELECT c.relname AS name, i.indisvalid AS valid,
    i.indisready AS ready, i.indrelid = to_regclass($1) AS target_table,
    am.amname AS access_method, i.indpred IS NULL AS full_index,
    i.indexprs IS NULL AS plain_index,
    ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, position)
      LEFT JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = key.attnum
      WHERE key.position <= i.indnkeyatts ORDER BY key.position) AS key_columns
    FROM pg_class c LEFT JOIN pg_index i ON c.oid = i.indexrelid
    LEFT JOIN pg_am am ON am.oid = c.relam
    WHERE i.indrelid = to_regclass($1) OR c.oid = to_regclass($2)`,
  [`public.${index.table}`, `public.${index.name}`]);
  return rows;
};

const hasRequiredDefinition = (row, index) => row.target_table && row.access_method === "btree"
  && row.full_index && row.plain_index && Array.isArray(row.key_columns)
  && row.key_columns.length >= index.columns.length
  && index.columns.every((column, position) => row.key_columns[position] === column);

const usable = (row, index) => row.valid && row.ready && hasRequiredDefinition(row, index);

async function ensureProjectDeletionIndexes(client, indexes) {
  for (const index of indexes) {
    const rows = await readIndexes(client, index);
    if (rows.some(row => usable(row, index))) continue;
    const owned = rows.find(row => row.name === index.name);
    // Expression keys have attnum=0; keep them visible so IF NOT EXISTS cannot
    // silently accept a same-name index that cannot serve the foreign key.
    if (owned && !hasRequiredDefinition(owned, index)) {
      throw Object.assign(new Error("A project deletion index has a conflicting definition"), { code: "DELETION_INDEX_CONFLICT" });
    }
    if (owned && !owned.valid) await client.query(`DROP INDEX CONCURRENTLY "public"."${index.name}"`);
    try {
      await client.query("SET statement_timeout = '5min'");
      await client.query({ text: index.sql, query_timeout: 305_000 });
    } finally {
      await client.query("SET statement_timeout = '60s'");
    }
    const verified = (await readIndexes(client, index)).find(row => row.name === index.name);
    if (!verified || !usable(verified, index)) throw Object.assign(new Error("Project deletion index did not complete"), { code: "DELETION_INDEX_INCOMPLETE" });
  }
}

module.exports = { ensureProjectDeletionIndexes };
