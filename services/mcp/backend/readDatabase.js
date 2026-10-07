const db=require('@hellotest/platform/backend/src/db');
let adapter;
function database(){
 if(!adapter){
  const {createPostgresAdapter}=require('@hellotest/platform/backend/src/db/createPostgresAdapter');
  adapter=createPostgresAdapter({poolConfig:{...db.pool.options,...(process.env.HELLOTEST_MCP_DATABASE_URL?{connectionString:process.env.HELLOTEST_MCP_DATABASE_URL}:{}),application_name:'hellotest-mcp-projections',max:3,min:0,statement_timeout:3000,query_timeout:3500,lock_timeout:500,connectionTimeoutMillis:3000},statementNamespace:'hellotest_mcp_read'});
 }
 return adapter;
}
async function all(sql,...values){
 const read=database();
 return read.transaction(async()=>{
  await read.query('SET TRANSACTION READ ONLY');
  await read.query("SET LOCAL statement_timeout = '3000ms'");
  await read.query("SET LOCAL lock_timeout = '500ms'");
  return read.prepare(sql).all(...values);
 })();
}
async function close(){if(adapter){await adapter.close();adapter=undefined;}}
module.exports={all,close};
