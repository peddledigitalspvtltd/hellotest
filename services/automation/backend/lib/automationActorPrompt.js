const select=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined&&value[key]!==null).map(key=>[key,value[key]]));
const caseKeys=['id','display_id','title','description','preconditions','gherkin_document','priority','labels'];
const stepKeys=['id','step_order','step_type','action','expected_result','parameterized_expected_result','group_id','group_name'];

// Project the already authorized, parameter-resolved task. Full source, cached
// selectors and duplicate DB metadata remain host-side. Only current browser
// observations can bind model targets to executable locators.
function projectAutomationActorTask(task={}){
  const context=task.build_context||{};
  const repository=task.repository||[];
  const screens=new Map();
  for(const row of repository){
    const key=row.screen_name||row.page_key||row.page_url;
    if(!key)continue;
    const screen=screens.get(key)||{...select(row,['screen_name','page_key','page_url']),fields:[]};
    const field=select(row,['object_name','object_role','intent']);
    if(Object.keys(field).length&&!screen.fields.some(item=>JSON.stringify(item)===JSON.stringify(field)))screen.fields.push(field);
    screens.set(key,screen);
  }
  return {
    ...select(task,['start_url','user_request']),
    case:select(task.case,caseKeys),
    current_section:select(task.current_section,stepKeys),
    parameter_data:context.parameter_data||{values:task.case?.parameter_values||{}},
    build_context:{
      ...select(context,['environment','configuration','data_set','story_context','retrieval','browser_policy','generation_scope']),
      linked_manual_cases:(context.linked_manual_cases||[]).map(item=>({...select(item,caseKeys),steps:(item.steps||[]).map(step=>select(step,stepKeys))}))
    },
    repository_screens:[...screens.values()],
    ...select(task,['knowledge','captured_actions','captured_network'])
  };
}

function projectAutomationActorFeedback(feedback={}){
  return {
    ...select(feedback,['attempt','max_attempts','generation_mode','active_step_id','active_manual_step_ids','section_attempt','completed_step_ids','available_section_ids','available_parameters','validation_errors']),
    required_section_ids:(feedback.required_sections||[]).map(step=>step.step_id),
    required_manual_steps:(feedback.required_manual_steps||[]).map(step=>select(step,['manual_step_id','manual_test_case_id']))
  };
}

// The browser loop adds the single configurable actor protocol. This helper
// contains task data only, so every turn does not repeat that instruction block.
function buildAutomationActorPrompt({task}){
  return JSON.stringify({kind:'automation_actor_task',...projectAutomationActorTask(task)});
}
module.exports={buildAutomationActorPrompt,projectAutomationActorTask,projectAutomationActorFeedback};
