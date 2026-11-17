const test=require('node:test');
const {verify}=require('./agentActivity.postgres.fixture');
test('canonical activity migration backfills history and projects native lifecycle atomically',{skip:process.env.RUN_AGENT_ACTIVITY_POSTGRES!=='1'},async()=>{
 const db=require('@hellotest/platform/backend/src/db');const client=await db.pool.connect();
 try{await verify(client,[...require('../../backend/agents/activitySchema'),...require('../../backend/agents/activityTransactionSchema'),...require('../../backend/agents/activityOutboxSchema')]);}
 finally{client.release();await db.pool.end();}
});
