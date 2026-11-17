
// Trigger state is the accepted immutable workflow input.
module.exports=require("./definition")("trigger",{connectionPolicy:{incoming:'forbidden',outgoing:'required'},validate:()=>[],execute:async({run})=>({request:run.input_payload})});
