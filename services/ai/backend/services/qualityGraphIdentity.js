// Quality is a revisioned projection of native records. It never allocates a
// second canonical source identity or writes inferred Knowledge relationships.
const kinds=Object.freeze({story:'requirement',test:'test_case',run:'execution',attempt:'execution_result',defect:'bug'});
const boundary=Object.freeze({contract_version:'quality-graph-boundary/1',owner:'ai-quality',canonical_identity:'native_kind_and_record_id',canonical_source_owner:'knowledge',relationship_scope:'observed_native_quality_projection',inferred_relationships_promoted:false});
function record(kind,id){return kinds[kind]?{kind:kinds[kind],ref_id:id}:null;}
function derived(kind,id,path){return {...record(kind,id),derived_path:path};}
module.exports={boundary,record,derived};
