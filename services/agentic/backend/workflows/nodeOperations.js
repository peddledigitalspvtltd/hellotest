// Stable compatibility port; each kind owns its actual validator and executor.
const registry=require('./nodeRegistry');
const KINDS=registry.kindsFor('operation');
function validate(node){const kind=node.data?.kind||node.type;return KINDS.has(kind)?registry.get(kind).validate(node):[];}
function execute(context){const kind=context.node.data?.kind||context.node.type;if(!KINDS.has(kind))throw require('./connections').fail('This node does not have an execution adapter.');return registry.get(kind).execute(context);}
module.exports={KINDS,validate,execute,_internals:require('./nodes/shared/values')};
