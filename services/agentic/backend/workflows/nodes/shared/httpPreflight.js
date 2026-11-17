const connections=require('../../connections');
module.exports=async({workflow,node},method)=>{
 const data=node.data||{}, {connection}=await connections.resolve(data.connectionId,workflow.project_id,data.apiUrl,'http');
 if(!(connection?.methods||['GET','HEAD']).includes(method))throw connections.fail('This HTTP method is not enabled for the selected connection.');
 connections._internals.authHeaders(connection);
};
