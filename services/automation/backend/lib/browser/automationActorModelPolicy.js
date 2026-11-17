// Browser decisions need visible typed JSON as well as reasoning tokens. Keep
// this capability allowlist separate from general provider/model inference:
// proxies, chat variants and unrelated phases retain their existing policy.
const knownGpt5=/^gpt-5(?:-mini|-nano)?(?:-2025-08-07)?$/;
function browserActorRequestPolicy(integration,browserActor,browserReview=false){
  if(browserActor!==true&&browserReview!==true)return {};
  let official=false;
  try{official=new URL(integration?.base_url||'https://api.openai.com/v1').origin==='https://api.openai.com';}catch{}
  return official&&knownGpt5.test(integration?.model||'')
    ?{max_completion_tokens:4096,reasoning_effort:'low'}
    :browserActor===true?{max_tokens:2048}:{};
}
module.exports={browserActorRequestPolicy};
