// Markers carry stable block IDs, never user data. The common model boundary
// expands them from the published configuration before context budgeting/tracing.
function aiInstructionBlock(feature,key){return `⟦HELLOTEST_AI:${feature}:${key}⟧`;}
module.exports={aiInstructionBlock};
