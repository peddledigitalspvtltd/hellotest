// Shared in-memory fake of the graph store used by the graph unit tests.
const {createGraph}=require('../../backend/services/knowledgeGraph.service');

const node=id=>({id,entity_type:'text',entity_key:`native-${id}`,title:`Source ${id}`,aliases:[]});
function fixture({ids=['source-A','source-B','source-C','source-D'],links=[['source-A','source-B'],['source-B','source-C'],['source-C','source-D']],revokeFinal=[],content='A recorded relationship.'}={}){
  const nodes=ids.map(node),calls=[];let reads=0;
  const edges=links.map(([source,target],index)=>({id:`edge-${index}`,source_node_id:source,target_node_id:target,relation_type:'RELATED_TO',provenance_type:'HUMAN_VERIFIED',source_kind:'text',source_key:`native-${source}`,source_title:source,source_aliases:[],target_kind:'text',target_key:`native-${target}`,target_title:target,target_aliases:[],chunk_id:`chunk-${index}`,document_id:`document-${index}`,evidence_source_id:source,document_version:1,version_hash:'version-hash',span_start:0,span_end:Array.from(content).length,content,heading:'Related context',char_start:0,char_end:content.length,evidence_source_kind:'text',evidence_source_ref_id:`native-${source}`,evidence_title:source,source_hash:'source-hash',effective_from:'2026-01-01T00:00:00Z',effective_to:null}));
  const store={prepare(sql){return {get:async(...args)=>{calls.push({sql,args});if(sql.includes('FROM users'))return{id:'actor'};throw Error(`Unexpected get ${sql}`);},all:async(...args)=>{calls.push({sql,args});if(sql.includes('SELECT nodes.id')){reads++;const requested=new Set(args.filter(arg=>typeof arg==='string'&&(ids.includes(arg)||arg.startsWith('native-'))));return nodes.filter(row=>(!requested.size||requested.has(row.id)||requested.has(row.entity_key))&&!(reads>1&&revokeFinal.includes(row.id)));}if(sql.includes('JOIN LATERAL')){const frontier=JSON.parse(args.find(arg=>typeof arg==='string'&&arg.startsWith('[')));const rows=[];for(const anchor of frontier)edges.filter(edge=>(edge.source_node_id===anchor||edge.target_node_id===anchor)&&!args.includes(edge.id)).slice(0,args.at(-1)).forEach(edge=>rows.push({...edge,anchor_id:anchor}));return rows;}throw Error(`Unexpected all ${sql}`);}};}};
  const auth={predicate:()=>({sql:'TRUE /* source document fragment ACL */',params:[]}),applicationContextPredicate:()=>"TRUE /* immutable permission profile */",getEvidenceAccess:async({evidence})=>({allowed:evidence,partial:false})};
  const graph=createGraph({db:store,authorization:auth,permissions:{hasPermission:async()=>true},features:{getFeatureKeysForPermission:()=>[],areEnabled:async()=>true},projectAccess:{getProject:async()=>({id:'project'})}});
  return {graph,calls,edges,nodes};
}

module.exports={fixture,node};
