// Markers carry stable block IDs, never user data. The common model boundary
// expands them from the owning application or node configuration before budgeting/tracing.
function aiInstructionBlock(feature,key){return `⟦HELLOTEST_AI:${feature}:${key}⟧`;}
module.exports={aiInstructionBlock};
