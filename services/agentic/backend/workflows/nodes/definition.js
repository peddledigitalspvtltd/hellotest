const contract=require('@hellotest/contracts/workflow');
const descriptors=contract.assertNodeRegistry(require('../../../shared/workflowNodeKinds.json'));
/** Bind a real kind implementation to the portable schema, ports, presentation
 * and scheduling contract. No executor-family dispatcher is involved here. */
function define(kind,implementation){
  const descriptor=descriptors.kinds[kind];
  if(!descriptor||typeof implementation.execute!=='function'||typeof implementation.validate!=='function')throw new TypeError(`Incomplete workflow node implementation: ${kind}`);
  return Object.freeze({...descriptor,implementation,
    allowsCredentialReference:implementation.allowsCredentialReference===true,acceptsLoopPolicy:implementation.acceptsLoopPolicy===true,acceptsMergePolicy:implementation.acceptsMergePolicy===true,
    timeoutMaxMs:implementation.timeoutMaxMs||(()=>70000),connectionPolicy:implementation.connectionPolicy||{incoming:"required",outgoing:"required"},
    inputContract:implementation.inputContract,validateInput:implementation.validateInput,preflight:implementation.preflight||{},preflightFailure:implementation.preflightFailure,
    connectedLoop:implementation.connectedLoop,specialistAlias:implementation.specialistAlias,
    validate(node,context={}){return [...contract.validateNodeEnvelope(descriptor,node.data||{}),...implementation.validate(node,context),...(context.outgoing&&implementation.validateConnections?implementation.validateConnections(node,context):[])];},
    execute:implementation.execute,
    isExclusive(data={}){return descriptor.exclusive==='always'||descriptor.exclusive==='http_write'&&!['GET','HEAD'].includes(String(data.apiMethod||'GET').toUpperCase());}
  });
}
define.descriptors=descriptors;
module.exports=define;
