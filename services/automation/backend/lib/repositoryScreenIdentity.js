const {recordedLocatorIdentity}=require('./automationLocatorIdentity');
const text=value=>typeof value==='string'?value.trim():'';
const metadata=row=>row?.metadata&&typeof row.metadata==='object'?row.metadata:{};
const isScreen=row=>row.locator_intent==='__screen__'||metadata(row).record_kind==='screen'||row.source==='manual_screen';
const name=row=>text(metadata(row).screen_name)||text(row.page_key)||'Screen';
const member=row=>{const value=text(metadata(row).object_name)||text(row.locator_intent)||'Field';return value.startsWith(name(row)+'.')?value.slice(name(row).length+1):value;};
const scope=row=>JSON.stringify([row.project_id||null,row.app_type_id||null]);
const strings=value=>Array.isArray(value)?value.filter(item=>typeof item==='string'&&item):[];
const routeDigest=row=>/^[a-f0-9]{64}$/.test(metadata(row).observed_route_sha256||'')?metadata(row).observed_route_sha256:null;
const identityKeys=['merged_into_entry_id','reference_aliases','screen_aliases','source_owners','repository_identity_version'];
function repositoryInputMetadata(value) {const clean={...(value&&typeof value==='object'&&!Array.isArray(value)?value:{})};for(const key of identityKeys)delete clean[key];return clean;}
function canonicalPageUrl(value) {
  const input=text(value);
  if(!input||/^about:blank(?:#.*)?$/i.test(input))return null;
  try {
    if(input.startsWith('/')&&!input.startsWith('//')){const url=new URL(input,'https://repository.invalid');return url.pathname+url.search+url.hash;}
    const url=new URL(input);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;
  }catch{return null;}
}
const compareRank=(a,b)=>{const pending=Number(Boolean(a._pending))-Number(Boolean(b._pending));if(pending)return pending;const left=new Date(a.created_at).getTime(),right=new Date(b.created_at).getTime();return (Number.isFinite(left)&&Number.isFinite(right)?left-right:String(a.created_at||'').localeCompare(String(b.created_at||'')))||String(a.id).localeCompare(String(b.id));};
const ranked=rows=>[...rows].sort(compareRank);
const union=values=>[...new Set(values.flat().filter(value=>typeof value==='string'&&value))];
const sourceOwners=(family,target)=>{const owners=new Map();for(const row of family)for(const value of [...(Array.isArray(row.metadata.source_owners)?row.metadata.source_owners:[]),{entry_id:row._pending?target.id:row.id,test_case_id:row.test_case_id||null,source:row.source||null}]){const owner={entry_id:value.entry_id,test_case_id:value.test_case_id||null,source:value.source||null};if(typeof owner.entry_id==='string')owners.set(JSON.stringify([owner.entry_id,owner.test_case_id,owner.source]),owner);}return [...owners.values()];};
const inheritEvidence=(target,family)=>{for(const row of ranked(family))for(const [key,value]of Object.entries(row.metadata))if(![...identityKeys,'screen_name','object_name','screen_entry_id'].includes(key)&&value!==null&&value!==undefined&&(target.metadata[key]===undefined||target.metadata[key]===null||target.metadata[key]===''))target.metadata[key]=value;};

/** Non-destructive projection. Redirect rows retain their original IDs and data. */
function canonicalizeRepositoryRows(input) {
  const rows=input.map(row=>({...row,metadata:{...metadata(row)}}));
  const byId=new Map(rows.map(row=>[row.id,row]));
  const route=row=>{const parent=byId.get(metadata(row).screen_entry_id);return parent&&scope(parent)===scope(row)&&isScreen(parent)?routeDigest(parent)||routeDigest(row):routeDigest(row);};
  const resolve=row=>{const seen=new Set();let current=row;while(current?.metadata.merged_into_entry_id){if(seen.has(current.id))return null;seen.add(current.id);const target=byId.get(current.metadata.merged_into_entry_id);if(!target||scope(target)!==scope(row)||isScreen(target)!==isScreen(row)||route(target)!==route(row))return null;current=target;}return current;};
  for(const row of rows)if(row.metadata.merged_into_entry_id){const target=resolve(row);if(!target||target.id===row.id)delete row.metadata.merged_into_entry_id;else row.metadata.merged_into_entry_id=target.id;}
  const namedScreens=new Map();
  for(const row of ranked(rows.filter(isScreen)))if(canonicalPageUrl(row.page_url)){const key=scope(row)+'::'+name(row);if(!namedScreens.has(key))namedScreens.set(key,row);}
  const groups=new Map();
  // A parent screen supplies identity for legacy fields without their own URL.
  for(const row of rows) {
    const identity=resolve(row)||row;
    const rawParent=byId.get(identity.metadata.screen_entry_id),parent=rawParent?resolve(rawParent):null;
    const matching=namedScreens.get(scope(row)+'::'+name(identity));
    const parentUrl=parent&&scope(parent)===scope(row)?canonicalPageUrl(parent.page_url):null;
    const url=parentUrl||canonicalPageUrl(identity.page_url)||canonicalPageUrl(matching?.page_url);
    const routeIdentity=parent&&scope(parent)===scope(row)?routeDigest(parent)||routeDigest(identity):routeDigest(identity)||(!canonicalPageUrl(identity.page_url)?routeDigest(matching):null);
    const key=scope(row)+'::'+(url?'url:'+url:'name:'+name(identity))+(routeIdentity?'::observed-route:'+routeIdentity:'');
    const group=groups.get(key)||[];group.push(row);groups.set(key,group);
  }
  const usedScreenNames=new Map();
  const orderedGroups=[...groups.values()].sort((left,right)=>compareRank(ranked(left)[0],ranked(right)[0]));
  for(const group of orderedGroups) {
    const active=group.filter(row=>!row.metadata.merged_into_entry_id);
    if(!active.length)continue;
    const screen=ranked(active.filter(isScreen))[0]||ranked(active)[0];
    const established=active.filter(row=>!row._pending);
    const nameOwner=ranked(established.filter(isScreen))[0]||ranked(established)[0]||screen;
    const originalScreenName=name(nameOwner),screenId=isScreen(screen)?screen.id:null;
    const screenUrl=canonicalPageUrl(screen.page_url)||group.map(row=>canonicalPageUrl(row.page_url)).find(Boolean);
    if(screenUrl)for(const row of group)if(!canonicalPageUrl(row.page_url))row.page_url=screenUrl;
    const taken=usedScreenNames.get(scope(screen))||new Set();let screenName=originalScreenName,suffix=2;
    while(taken.has(screenName))screenName=originalScreenName+' '+suffix++;
    taken.add(screenName);usedScreenNames.set(scope(screen),taken);
    const screenAliases=union([[screenName],...group.map(row=>[name(row),...strings(row.metadata.screen_aliases)])]).sort();
    const fields=new Map();
    for(const row of group.filter(row=>!isScreen(row))) {
      const target=resolve(row)||row;
      const platform=text(metadata(target).platform)||'web',locator=text(target.locator);
      const key=platform+'::'+(platform==='web'&&recordedLocatorIdentity(locator)||locator||'id:'+row.id);
      const family=fields.get(key)||[];family.push(row);fields.set(key,family);
    }
    const families=[...fields.values()].map(family=>({family,target:ranked(family.filter(row=>!row.metadata.merged_into_entry_id))[0]||ranked(family)[0]}));
    const used=new Set();
    for(const {family,target}of families.sort((a,b)=>compareRank(a.target,b.target))) {
      const original=member(target);let objectName=original,index=2;
      while(used.has(objectName))objectName=original+' '+index++;
      used.add(objectName);
      const aliases=union([[`${screenName}.${objectName}`],...family.map(row=>[...(row.metadata.merged_into_entry_id?[]:[`${name(row)}.${member(row)}`]),...strings(row.metadata.reference_aliases)])]).sort();
      const owners=sourceOwners(family,target);
      inheritEvidence(target,family);
      target.metadata={...target.metadata,screen_name:screenName,object_name:objectName,screen_aliases:screenAliases,reference_aliases:aliases,source_owners:owners,...(screenId?{screen_entry_id:screenId}:{}),repository_identity_version:1};
      delete target.metadata.merged_into_entry_id;
      for(const row of family)if(row!==target)row.metadata={...row.metadata,reference_aliases:union([strings(row.metadata.reference_aliases),row.metadata.merged_into_entry_id?[]:[`${name(row)}.${member(row)}`]]),merged_into_entry_id:target.id,screen_name:screenName,screen_aliases:screenAliases,repository_identity_version:1};
    }
    const screens=group.filter(isScreen);
    inheritEvidence(screen,screens);
    for(const row of screens) {
      row.metadata={...row.metadata,screen_name:screenName,screen_aliases:screenAliases,repository_identity_version:1};
      if(row.id===screen.id)row.metadata.source_owners=sourceOwners(screens,screen);
      if(row.id!==screen.id)row.metadata.merged_into_entry_id=screen.id;
      else delete row.metadata.merged_into_entry_id;
    }
  }
  return {all:rows,rows:rows.filter(row=>!row.metadata.merged_into_entry_id),byId:new Map(rows.map(row=>[row.id,row]))};
}
module.exports={canonicalPageUrl,canonicalizeRepositoryRows,repositoryInputMetadata,isRepositoryScreen:isScreen};
