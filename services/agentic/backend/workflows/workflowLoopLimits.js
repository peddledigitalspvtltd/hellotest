const limits = require('../../shared/workflowNodeKinds.json').limits;

// Shared numeric policy has no dependency on node execution or budget estimation.
module.exports = Object.freeze({ batches: limits.max_loop_batches, node_executions: limits.max_loop_node_executions, items: limits.max_loop_items });
