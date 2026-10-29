// Compact native evidence structurally. Never turn a record snapshot into an
// unterminated JSON prefix, or truncate the IDs/revisions used for approval.
module.exports = function compactNativeEvidence(input, maximum) {
  const value = JSON.parse(JSON.stringify(input));
  const identity = /^(?:id|.*_ids?|revision|evidence_type)$/;
  const clean = node => {
    if (Array.isArray(node)) return node.map(clean);
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(Object.entries(node).filter(([key,item]) => key === 'evidence_permissions' || item != null && item !== ''
      && (!Array.isArray(item) || item.length) && (typeof item !== 'object' || Object.keys(item).length)).map(([key,item])=>[key,clean(item)]));
  };
  let reduced = clean(value), omitted = false;
  const omittedItems = {};
  const encode = () => JSON.stringify(reduced);
  // Aggregate examples and prose duplicate the native records. Detailed
  // selected records have precedence when a packet cannot contain both.
  if (Array.isArray(reduced.records) && reduced.records.length) {
    const essential = new Set(['evidence_type','evidence_permissions','records','total_records','returned_records','context_window']);
    for (const key of Object.keys(reduced)) if (!essential.has(key)) { delete reduced[key]; omitted = true; }
  }
  const note = () => {
    if (Array.isArray(reduced.records)) reduced.returned_records=reduced.records.length;
    if (Array.isArray(reduced.steps) && Number.isFinite(reduced.coverage?.total_steps)) reduced.coverage.omitted_steps=Math.max(0,reduced.coverage.total_steps-reduced.steps.length);
    if (omitted) reduced.context_window = { bounded:true, note:'Partial excerpt; omitted fields and records are unknown.', ...(Object.keys(omittedItems).length?{omitted_items:omittedItems}:{}) };
  };
  note();
  if (encode().length>maximum && Array.isArray(reduced.records)) {
    const core = new Set(['id','display_id','title','name','description','revision','acceptance_criteria','specification_content','gherkin_scenarios',
      'priority','status','automated','steps','requirement_ids','parameter_values','prerequisites','expected_result',
      'execution_mode','release','sprint','build','result_count','passed_count','failed_count','blocked_count','created_at','ended_at']);
    reduced.records = reduced.records.map(record => Object.fromEntries(Object.entries(record).filter(([key])=>core.has(key))));
    omitted=true;note();
  }
  for (let round=0;encode().length>maximum && round<200;round++) {
    const strings=[],lists=[];
    const visit=(node,path=[])=>{
      if (!node || typeof node!=='object') return;
      for (const [key,item] of Object.entries(node)) {
        if (key==='evidence_permissions'||key==='context_window') continue;
        if (typeof item==='string'&&!identity.test(key)&&item.length>80) strings.push({node,key,length:item.length});
        else if (Array.isArray(item)) { if(item.length>1) lists.push({node,key,length:item.length,path:[...path,key].join('.')}); item.forEach((entry,index)=>visit(entry,[...path,key,index])); }
        else visit(item,[...path,key]);
      }
    };
    visit(reduced);
    // Retain whole short descriptions and acceptance criteria where possible.
    const long = strings.filter(item=>item.length>320).sort((a,b)=>b.length-a.length)[0];
    const list = lists.sort((a,b)=>b.length-a.length)[0];
    const short = strings.sort((a,b)=>b.length-a.length)[0];
    if(long) long.node[long.key]=long.node[long.key].slice(0,Math.max(160,Math.floor(long.length/2)));
    else if(list) {
      const entries=list.node[list.key];
      const removable=list.key==='steps'?entries.map((entry,index)=>({entry,index})).filter(({entry})=>!['failed','blocked'].includes(entry?.observed_status)).at(-1)?.index:entries.length-1;
      if(removable==null) break; // Keep every observed failing step, or omit the packet explicitly.
      entries.splice(removable,1);omittedItems[list.path]=(omittedItems[list.path]||0)+1;
    }
    else if(short) short.node[short.key]=short.node[short.key].slice(0,Math.max(80,Math.floor(short.length/2)));
    else break;
    omitted=true;note();
  }
  if(encode().length<=maximum) return encode();
  // An explicit omission marker is safe; a partial record identity is not.
  const marker=JSON.stringify({evidence_type:value.evidence_type,evidence_permissions:value.evidence_permissions||[],context_window:{bounded:true,note:'Record omitted: context budget too small.'}});
  return marker.length<=maximum?marker:'';
};
