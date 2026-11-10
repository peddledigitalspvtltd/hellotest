import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createLiveViewGrant, verifyLiveViewGrant } from '../dist/lib/liveViewGrant.js';
const backend = createRequire(import.meta.url)('../../../services/automation/backend/lib/automationLiveViewGrant.js');
const secret='a-viewer-specific-fixture-secret-over-32-characters', now=1800000000000;

test('application-minted live grants authorize only the selected run and provider within expiry',()=>{
 const token=backend.createLiveViewGrant({engineRunId:'case',provider:'playwright',secret,now});
 assert.equal(token,createLiveViewGrant({engineRunId:'case',provider:'playwright',secret,now}));
 const input={token,engineRunId:'case',provider:'playwright',secrets:[secret],now};
 assert.equal(verifyLiveViewGrant(input),secret);
 for(const change of [{engineRunId:'other'},{provider:'selenium'},{secrets:['different-secret']},{token:token+'changed'},{now:now+300000},{now:now-601000},{token:'malformed'}, {token:'x'.repeat(2049)}])assert.equal(verifyLiveViewGrant({...input,...change}),null);
});
