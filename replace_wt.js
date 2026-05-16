const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'backend/api/src/services/workspaceTransaction.service.js');
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/const db = require\("\.\.\/db"\);/g, 'const db = require("../db");\nconst obsDb = require("../obsDb");');

code = code.replace(/const selectTransaction = db\.prepare\(`\s*SELECT\s*workspace_transactions\.\*,\s*users\.email AS created_user_email,\s*users\.name AS created_user_name,\s*users\.avatar_data_url AS created_user_avatar_data_url,\s*\(\s*SELECT COUNT\(\*\)\s*FROM workspace_transaction_events\s*WHERE workspace_transaction_events\.transaction_id = workspace_transactions\.id\s*\) AS event_count,\s*\(\s*SELECT MAX\(created_at\)\s*FROM workspace_transaction_events\s*WHERE workspace_transaction_events\.transaction_id = workspace_transactions\.id\s*\) AS latest_event_at\s*FROM workspace_transactions\s*LEFT JOIN users ON users\.id = workspace_transactions\.created_by\s*WHERE workspace_transactions\.id = \?\s*`\);/s, `const selectTransaction = obsDb.prepare(\`
  SELECT
    workspace_transactions.*,
    (
      SELECT COUNT(*)
      FROM workspace_transaction_events
      WHERE workspace_transaction_events.transaction_id = workspace_transactions.id
    ) AS event_count,
    (
      SELECT MAX(created_at)
      FROM workspace_transaction_events
      WHERE workspace_transaction_events.transaction_id = workspace_transactions.id
    ) AS latest_event_at
  FROM workspace_transactions
  WHERE workspace_transactions.id = ?
\`);`);

code = code.replace(/const selectTransactionByRelated = db\.prepare\(`\s*SELECT\s*workspace_transactions\.\*,\s*users\.email AS created_user_email,\s*users\.name AS created_user_name,\s*users\.avatar_data_url AS created_user_avatar_data_url,\s*\(\s*SELECT COUNT\(\*\)\s*FROM workspace_transaction_events\s*WHERE workspace_transaction_events\.transaction_id = workspace_transactions\.id\s*\) AS event_count,\s*\(\s*SELECT MAX\(created_at\)\s*FROM workspace_transaction_events\s*WHERE workspace_transaction_events\.transaction_id = workspace_transactions\.id\s*\) AS latest_event_at\s*FROM workspace_transactions\s*LEFT JOIN users ON users\.id = workspace_transactions\.created_by\s*WHERE workspace_transactions\.related_kind = \?\s*AND workspace_transactions\.related_id = \?\s*ORDER BY workspace_transactions\.created_at DESC, workspace_transactions\.id DESC\s*LIMIT 1\s*`\);/s, `const selectTransactionByRelated = obsDb.prepare(\`
  SELECT
    workspace_transactions.*,
    (
      SELECT COUNT(*)
      FROM workspace_transaction_events
      WHERE workspace_transaction_events.transaction_id = workspace_transactions.id
    ) AS event_count,
    (
      SELECT MAX(created_at)
      FROM workspace_transaction_events
      WHERE workspace_transaction_events.transaction_id = workspace_transactions.id
    ) AS latest_event_at
  FROM workspace_transactions
  WHERE workspace_transactions.related_kind = ?
    AND workspace_transactions.related_id = ?
  ORDER BY workspace_transactions.created_at DESC, workspace_transactions.id DESC
  LIMIT 1
\`);`);

code = code.replace(/const insertTransaction = db\.prepare/g, 'const insertTransaction = obsDb.prepare');
code = code.replace(/const updateTransaction = db\.prepare/g, 'const updateTransaction = obsDb.prepare');
code = code.replace(/const insertTransactionEvent = db\.prepare/g, 'const insertTransactionEvent = obsDb.prepare');
code = code.replace(/const selectTransactionEvents = db\.prepare/g, 'const selectTransactionEvents = obsDb.prepare');
code = code.replace(/const insertTransactionArtifact = db\.prepare/g, 'const insertTransactionArtifact = obsDb.prepare');
code = code.replace(/const selectTransactionArtifacts = db\.prepare/g, 'const selectTransactionArtifacts = obsDb.prepare');
code = code.replace(/const selectTransactionArtifact = db\.prepare/g, 'const selectTransactionArtifact = obsDb.prepare');
code = code.replace(/const deleteTransactionEvents = db\.prepare/g, 'const deleteTransactionEvents = obsDb.prepare');
code = code.replace(/const deleteTransactionArtifacts = db\.prepare/g, 'const deleteTransactionArtifacts = obsDb.prepare');
code = code.replace(/const deleteBatchJob = db\.prepare/g, 'const deleteBatchJob = obsDb.prepare');
code = code.replace(/const deleteTransactionById = db\.prepare/g, 'const deleteTransactionById = obsDb.prepare');

code = code.replace(/const hydrateTransaction = \(transaction\) => {/g, `const hydrateTransaction = async (transaction) => {
  if (!transaction) {
    return null;
  }
  
  if (transaction.created_by && !transaction.created_user_email) {
    const user = await db.prepare('SELECT email, name, avatar_data_url FROM users WHERE id = ?').get(transaction.created_by);
    if (user) {
      transaction.created_user_email = user.email;
      transaction.created_user_name = user.name;
      transaction.created_user_avatar_data_url = user.avatar_data_url;
    }
  }
`);

code = code.replace(/return hydrateTransaction\(transaction\);/g, 'return await hydrateTransaction(transaction);');
code = code.replace(/hydrateTransaction\(await selectTransactionByRelated\.get\(related_kind, related_id\)\)/g, 'await hydrateTransaction(await selectTransactionByRelated.get(related_kind, related_id))');
code = code.replace(/return rows\.map\(hydrateTransaction\);/g, 'return Promise.all(rows.map(hydrateTransaction));');

code = code.replace(/exports\.deleteTransaction = async \(id\) => \{\s*const existing = await exports\.getTransaction\(id\);\s*const transaction = db\.transaction\(async \(\) => \{\s*await deleteTransactionEvents\.run\(id\);\s*await deleteTransactionArtifacts\.run\(id\);\s*await deleteBatchJob\.run\(id\);\s*await deleteTransactionById\.run\(id\);\s*\}\);\s*await transaction\(\);\s*return \{ deleted: true \};\s*\};/s, `exports.deleteTransaction = async (id) => {
  const existing = await exports.getTransaction(id);

  const transaction = obsDb.transaction(async () => {
    await deleteTransactionEvents.run(id);
    await deleteTransactionArtifacts.run(id);
    await deleteBatchJob.run(id);
    await deleteTransactionById.run(id);
  });

  await transaction();
  return { deleted: true };
};`);

code = code.replace(/const rows = await db\.prepare\(query\)\.all\(\.\.\.params\);/g, 'const rows = await obsDb.prepare(query).all(...params);');

code = code.replace(/SELECT\s*workspace_transactions\.\*,\s*users\.email AS created_user_email,\s*users\.name AS created_user_name,\s*users\.avatar_data_url AS created_user_avatar_data_url,\s*\(\s*SELECT COUNT\(\*\)\s*FROM workspace_transaction_events\s*WHERE workspace_transaction_events\.transaction_id = workspace_transactions\.id\s*\) AS event_count,\s*\(\s*SELECT MAX\(created_at\)\s*FROM workspace_transaction_events\s*WHERE workspace_transaction_events\.transaction_id = workspace_transactions\.id\s*\) AS latest_event_at\s*FROM workspace_transactions\s*LEFT JOIN users ON users\.id = workspace_transactions\.created_by/s, `SELECT
      workspace_transactions.*,
      (
        SELECT COUNT(*)
        FROM workspace_transaction_events
        WHERE workspace_transaction_events.transaction_id = workspace_transactions.id
      ) AS event_count,
      (
        SELECT MAX(created_at)
        FROM workspace_transaction_events
        WHERE workspace_transaction_events.transaction_id = workspace_transactions.id
      ) AS latest_event_at
    FROM workspace_transactions`);


fs.writeFileSync(file, code);
