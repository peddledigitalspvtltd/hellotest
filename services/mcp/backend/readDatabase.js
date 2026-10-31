const db=require('@hellotest/platform/backend/src/db');
const adapters=new Map();
function database(source='application'){
 if(!['application','observability'].includes(source))throw new Error('Unknown fixed MCP projection source.');
 if(!adapters.has(source)){
  const {createPostgresAdapter}=require('@hellotest/platform/backend/src/db/createPostgresAdapter');
  const native=source==='observability'?require('@hellotest/platform/backend/src/obsDb'):db;
  adapters.set(source,createPostgresAdapter({poolConfig:{...native.pool.options,...(source==='application'&&process.env.HELLOTEST_MCP_DATABASE_URL?{connectionString:process.env.HELLOTEST_MCP_DATABASE_URL}:{}),application_name:'hellotest-mcp-projections-'+source,max:3,min:0,statement_timeout:3000,query_timeout:3500,lock_timeout:500,connectionTimeoutMillis:3000},statementNamespace:'hellotest_mcp_read_'+source}));
 }
 return adapters.get(source);
}
async function all(sql,...values){
 return allFrom('application',sql,...values);
}
async function allFrom(source,sql,...values){
 const read=database(source);
 return read.transaction(async()=>{
  await read.query('SET TRANSACTION READ ONLY');
  await read.query("SET LOCAL statement_timeout = '3000ms'");
  await read.query("SET LOCAL lock_timeout = '500ms'");
  return read.prepare(sql).all(...values);
 })();
}
async function close(){await Promise.all([...adapters.values()].map(adapter=>adapter.close()));adapters.clear();}
module.exports={all,allFrom,close};
