import type { Page } from 'playwright';
import { QualityError, safeText, validQualityUrl } from './contracts.js';
import type { QualityObservation, QualityDecision, QualityRunInput } from '../../contracts/qualityAgents.js';

export async function observeMission(page: Page, sequence: number): Promise<QualityObservation> {
  const observation = await page.evaluate(() => {
    document.querySelectorAll('[data-hellotest-mission]').forEach(e => e.removeAttribute('data-hellotest-mission'));
    const elements = Array.from(document.querySelectorAll('a[href],button,input:not([type=hidden]),textarea,select,[role=button]')).filter(e => {
      const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && !e.closest('[data-sensitive]');
    }).slice(0,80).map((element,index) => {
      const input=element as HTMLInputElement;
      const sensitive=/password|passwd|secret|token|credential|otp|one-time|credit.?card|cvv/i.test([input.type,input.name,input.id,input.autocomplete].join(' '));
      const id=`element-${index+1}`;element.setAttribute('data-hellotest-mission',id);
      return {id,tag:element.tagName.toLowerCase(),label:(element.getAttribute('aria-label')||element.textContent||input.placeholder||input.name||'').trim().slice(0,160),type:input.type||'',sensitive,href:element instanceof HTMLAnchorElement?element.href:undefined};
    });
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT), chunks:string[]=[];let size=0,node:Node|null;
    while((node=walker.nextNode())&&size<10000&&chunks.length<600){const parent=node.parentElement;if(!parent||parent.closest('script,style,input,textarea,[data-sensitive],[aria-hidden=true]'))continue;const style=getComputedStyle(parent),rect=parent.getBoundingClientRect();if(style.visibility==='hidden'||style.display==='none'||rect.width<=0||rect.height<=0)continue;const value=(node.textContent||'').replace(/\s+/g,' ').trim();if(value){chunks.push(value);size+=value.length;}}
    return {url:location.href,title:document.title,text:chunks.join(' ').slice(0,10000),elements};
  });
  return {sequence,url:validQualityUrl(observation.url),title:safeText(observation.title,300),text:safeText(observation.text,10000),elements:observation.elements.map(e=>({...e,label:safeText(e.label,160),...(e.href?{href: (()=>{try{return validQualityUrl(e.href);}catch{return undefined;}})()}: {})}))};
}
export function validateMissionDecision(value: unknown, observation: QualityObservation, target: string): QualityDecision {
  const v=value as QualityDecision;
  if(!v||typeof v!=='object'||!['click','fill','select','press','navigate','extract','complete','blocked','scroll','hover','wait','back','assert_text'].includes(v.action))throw new QualityError('QUALITY_DECISION_INVALID','The browser decision is unsupported.');
  if(typeof v.summary!=='string'||!v.summary.trim()||v.summary.length>1200)throw new QualityError('QUALITY_DECISION_INVALID','A concise browser decision summary is required.');
  const result:QualityDecision={action:v.action,summary:safeText(v.summary)};
  if(['click','fill','select','press','hover'].includes(v.action)) {
    const element=observation.elements.find(e=>e.id===v.element_id);
    if(!element||element.sensitive)throw new QualityError('QUALITY_DECISION_INVALID','Choose an observed non-sensitive browser element.');
    result.element_id=element.id;
    if(v.action==='fill'||v.action==='select') {
      if(typeof v.value!=='string'||v.value.length>500||/[\u0000-\u001f]/.test(v.value)||safeText(v.value,500)!==v.value)throw new QualityError('QUALITY_DECISION_INVALID','Use a bounded non-secret input.');result.value=v.value;
    }
    if(v.action==='press'){if(!['Enter','Tab','Escape','ArrowDown','ArrowUp'].includes(v.key||''))throw new QualityError('QUALITY_DECISION_INVALID','Unsupported browser key.');result.key=v.key;}
  }
  if(v.action==='scroll'){if(!['up','down'].includes(v.direction||''))throw new QualityError('QUALITY_DECISION_INVALID','Choose a bounded scroll direction.');result.direction=v.direction;}
  if(v.action==='assert_text'){if(typeof v.text!=='string'||!v.text.trim()||v.text.length>500||safeText(v.text,500)!==v.text)throw new QualityError('QUALITY_DECISION_INVALID','Choose bounded non-secret text to verify.');result.text=v.text.trim();}
  if(v.action==='navigate') {result.url=validQualityUrl(v.url);if(new URL(result.url).origin!==new URL(target).origin)throw new QualityError('QUALITY_DECISION_INVALID','Stay on the approved application origin.');}
  return result;
}
export async function applyMissionDecision(page:Page,decision:QualityDecision) {
  const locator=page.locator(`[data-hellotest-mission="${decision.element_id}"]`);
  if(['click','fill','select','press','hover'].includes(decision.action)) {
    const unsafe=await locator.evaluate(element=>{const e=element as HTMLInputElement;return /password|passwd|secret|token|credential|otp|one-time|credit.?card|cvv/i.test([e.type,e.name,e.id,e.autocomplete].join(' '));});
    if(unsafe)throw new QualityError('QUALITY_SENSITIVE_FIELD','The current browser element is sensitive.',403);
  }
  if(['click','press'].includes(decision.action)) {
    const danger=await locator.evaluate(element=>/delete|remove account|purchase|pay now|send message|send email|unsubscribe|sign.?out|log.?out|grant access|change password/i.test([element.textContent,element.getAttribute('aria-label'),element.getAttribute('href')].join(' ')));
    if(danger)throw new QualityError('QUALITY_ACTION_REVIEW','This action requires a separately reviewed workflow.',403);
  }

  if(decision.action==='hover')await locator.hover();
  if(decision.action==='wait')await page.waitForTimeout(1000);
  if(decision.action==='back')await page.goBack({waitUntil:'domcontentloaded'});
  if(decision.action==='scroll'){const viewport=page.viewportSize()||{width:1280,height:800};await page.mouse.move(viewport.width/2,viewport.height/2);await page.mouse.wheel(0,decision.direction==='up'?-600:600);await page.waitForTimeout(200);}
  if(decision.action==='assert_text')await page.getByText(decision.text!,{exact:false}).filter({visible:true}).first().waitFor({state:'visible'});
  if(decision.action==='click')await locator.click();
  if(decision.action==='fill')await locator.fill(decision.value!);
  if(decision.action==='select')await locator.selectOption({label:decision.value!});
  if(decision.action==='press')await locator.press(decision.key!);
  if(decision.action==='navigate')await page.goto(decision.url!,{waitUntil:'domcontentloaded'});
}
// Configuration contains only environment references. No credential material enters the run record or model observation.
export function missionCredential(input:QualityRunInput,environment:NodeJS.ProcessEnv) {
  const ref=input.options?.credential_ref;if(!ref)return null;
  let entries;try{entries=JSON.parse(environment.QUALITY_AGENT_CREDENTIAL_REFERENCES||'[]');}catch{throw new QualityError('QUALITY_CREDENTIAL_CONFIGURATION','Browser credential references are misconfigured.',503);}
  const entry=Array.isArray(entries)?entries.find(e=>e.id===ref&&Array.isArray(e.project_ids)&&e.project_ids.includes(input.scope.project_id)&&e.origin===new URL(input.target_url).origin):null;
  if(!entry)throw new QualityError('QUALITY_CREDENTIAL_SCOPE','This credential reference is not authorized for the selected project and target.',403);
  const secret=(name:unknown)=>{if(typeof name!=='string'||!/^QUALITY_SECRET_[A-Z0-9_]+$/.test(name)||!environment[name])throw new QualityError('QUALITY_CREDENTIAL_UNAVAILABLE','The configured browser secret is unavailable.',503);return environment[name]!;};
  if(entry.type==='http_basic')return {httpCredentials:{origin:entry.origin,username:secret(entry.username_env),password:secret(entry.password_env)},steps:[],masks:[]};
  if(entry.type!=='form'||!Array.isArray(entry.fields)||entry.fields.length>4||typeof entry.submit_selector!=='string'||entry.submit_selector.length>240)throw new QualityError('QUALITY_CREDENTIAL_CONFIGURATION','Use a configured HTTP Basic or form credential reference.',503);
  const steps=entry.fields.map((field:{selector:string;secret_env:string})=>{if(typeof field.selector!=='string'||field.selector.length>240)throw new QualityError('QUALITY_CREDENTIAL_CONFIGURATION','Invalid credential field.',503);return {selector:field.selector,value:secret(field.secret_env)};});
  return {httpCredentials:undefined,steps,masks:steps.map((s:{selector:string})=>s.selector),submit:entry.submit_selector};
}
export async function authenticateMission(page:Page,credential:ReturnType<typeof missionCredential>,target:string) {
  if(!credential?.steps.length)return;
  if(new URL(page.url()).origin!==new URL(target).origin)throw new QualityError('QUALITY_CREDENTIAL_SCOPE','Authentication left the approved origin.',403);
  for(const field of credential.steps){await page.locator(field.selector).fill(field.value);}
  await page.locator(credential.submit!).click();
}
