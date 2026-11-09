const {createHash}=require('node:crypto');
const {browserReceipt}=require('./automationInteractiveEvidence');
const {snapshotFrameScope,framePathKey}=require('./automationFrameScope');

// Only the actual host observe boundary registers these identities. A model
// packet, serialized history or a copied receipt cannot request automatic work.
const nativeSnapshots=new WeakMap(),nativeTransitions=new WeakSet();
const mutations=new Set(['browser_navigate','browser_click','browser_fill','browser_press_key','browser_select_option','browser_hover','browser_check','browser_uncheck']);
const fingerprint=page=>createHash('sha256').update(JSON.stringify(page)).digest('hex');
function recordNativeSnapshotRecoveryObservation(observation){
  if(!observation||typeof observation!=='object'||observation.mcp_call===false||observation.result?.isError)return;
  const page=browserReceipt(observation);
  if(!page)return;
  if(mutations.has(observation.tool)&&page.action_outcome==='completed')nativeTransitions.add(observation);
  if(observation.tool==='browser_snapshot'&&typeof page.observation_id==='string'&&page.observation_id
    &&Array.isArray(page.elements)&&snapshotFrameScope(page))nativeSnapshots.set(observation,fingerprint(page));
}
function nativePage(observation){
  if(!observation||observation.tool!=='browser_snapshot'||observation.mcp_call===false||observation.result?.isError)return null;
  const proof=nativeSnapshots.get(observation),page=proof&&browserReceipt(observation);
  return page&&fingerprint(page)===proof?page:null;
}
function needsRecovery(page){
  // This is the native AX-only fallback, not a claim that a requested element
  // is absent. Partially grounded snapshots with useful targets remain usable.
  return page?.partial===true&&Array.isArray(page.elements)&&page.elements.length===0
    &&typeof page.accessibility==='string'&&Boolean(page.accessibility.trim());
}
const unreadable=()=>Object.assign(new Error('The browser returned accessibility text without usable native targets, including after one bounded read-only refresh. No action was replayed or new target authority granted. Review the page loading state and retry discovery before rebuilding this section.'),{
  code:'AUTOMATION_BROWSER_CONTEXT_UNREADABLE',statusCode:422,nonRetryable:true,action_outcome:'not_attempted',retry_safe:false,
  details:{issue_kind:'native_targets_unavailable',recovery_snapshot_attempts:1,action_outcome:'not_attempted'}
});
function createAutomationSnapshotTargetRecovery(){
  const initial={},attempted=new WeakMap();
  return {
    async recover({snapshot,observations=[],capture,assertActive=()=>{},beforeRead=()=>{}}){
      const page=nativePage(snapshot);
      if(!needsRecovery(page))return false;
      const scope=snapshotFrameScope(page);
      if(!scope)return false;
      const transition=observations.findLast(row=>nativeTransitions.has(row))||initial;
      const key=framePathKey(scope.path),used=attempted.get(transition)||new Set();
      if(used.has(key))throw unreadable();
      assertActive();beforeRead();
      used.add(key);attempted.set(transition,used);
      const fresh=await capture([...scope.path]);
      assertActive();
      const current=nativePage(fresh),currentScope=current&&snapshotFrameScope(current);
      // A failed read leaves the prior successful snapshot in history. It must
      // not masquerade as a fresh result or silently switch embedded documents.
      if(!current||fresh===snapshot||!currentScope||framePathKey(currentScope.path)!==key||needsRecovery(current))throw unreadable();
      try{if(new URL(current.url).origin!==new URL(page.url).origin)throw unreadable();}
      catch(error){if(error.code==='AUTOMATION_BROWSER_CONTEXT_UNREADABLE')throw error;throw unreadable();}
      return true;
    }
  };
}
module.exports={recordNativeSnapshotRecoveryObservation,createAutomationSnapshotTargetRecovery};
