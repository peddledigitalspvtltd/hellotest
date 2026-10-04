const db = require('../obsDb');
exports.expire = async () => {
  await db.pool.query({ text: `DELETE FROM llm_request_traces WHERE id IN
    (SELECT id FROM llm_request_traces WHERE expires_at <= CURRENT_TIMESTAMP ORDER BY expires_at LIMIT 5000)`, query_timeout: 4000 });
  await db.pool.query({ text: `UPDATE llm_request_traces SET status='failed', error_code='WORKER_INTERRUPTED', completed_at=CURRENT_TIMESTAMP
    WHERE id IN (SELECT id FROM llm_request_traces WHERE status='running' AND started_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes' LIMIT 5000)`, query_timeout: 4000 });
};
