
// Legacy specialist alias uses the same bounded specialist review contract.
const specialist=require('./shared/specialistExecution');
const {policy}=require('../specialistPolicy');
const validate=require('./shared/specialistValidation');
module.exports=require("./definition")("llmAgent",{preflight:{model:require('./shared/modelPreflight')},preflightFailure:(_phase,failure)=>failure.publicMessage||"Check this agent's version and model connection.",validate,execute:specialist.execute});
