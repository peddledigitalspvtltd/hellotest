// The authoring UI already labels reviewed context and selected templates.
// Keep those inputs separate from the user's typed instructions at synthesis.
function splitGenerationContext(value='') {
  const selected_template=[],reviewed_context=[];
  let user_request=String(value||'').replace(/(?:\n\n---\n\n)?\[HELLOTEST_(SMART|TEMPLATE)_CONTEXT_START\]([\s\S]*?)\[HELLOTEST_\1_CONTEXT_END\](?:\n\n---\n\n)?/g,(_,kind,text)=>{
    (kind==='SMART'?reviewed_context:selected_template).push(text.trim());return '\n\n';
  }).trim();
  const incomplete=user_request.indexOf('[HELLOTEST_');
  const unclassified_context=incomplete<0?[]:[user_request.slice(incomplete)];
  if(incomplete>=0)user_request=user_request.slice(0,incomplete).trim();
  return {user_request,selected_template,reviewed_context,...(unclassified_context.length?{unclassified_context,context_pack_status:'incomplete'}:{})};
}
function generationRetrievalQuery(content) {
  try {
    const text=Array.isArray(content)?content.filter(part=>part.type==='text').map(part=>part.text).join('\n'):content;
    const task=JSON.parse(text);
    const stories=(task.stories||[task.story]).filter(Boolean).map(story=>({id:story.id,title:story.title,acceptance_criteria:story.acceptance_criteria,specification_content:story.specification_content}));
    const user_request=task.generation_request?.user_request;
    const template_focus=!user_request?.trim()?task.generation_request?.selected_template:undefined;
    // Image bytes and private file metadata provide evidence to the authoring
    // model, but do not provide a meaningful text search for the context graph.
    if(!user_request?.trim()&&!template_focus?.length&&!stories.length&&!task.current_case?.title&&!task.selected_step)return null;
    return JSON.stringify({user_request,...(template_focus?{template_focus}:{}),stories,case_title:task.current_case?.title,selected_step:task.selected_step});
  }catch{return undefined;}
}
module.exports={splitGenerationContext,generationRetrievalQuery};
