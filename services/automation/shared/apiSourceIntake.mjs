import { parse as parseYaml } from 'yaml';
import { parse as parseScript } from 'acorn';

export const API_SOURCE_LIMITS = Object.freeze({ maxBytes: 2 * 1024 * 1024, maxRequests: 200, maxDepth: 40 });
const METHODS = new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']);
const PRIVATE_KEY = /(?:^|[_\s-])(?:password|passwd|secret|token|credential|api[_-]?key|access[_-]?key|auth|jwt|csrf|authorization|cookie|session)(?:$|[_\s-])/i;
const fail = message => { throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = value => Array.isArray(value) ? value : [];
const text = value => value == null ? '' : String(value);
const bytes = value => new TextEncoder().encode(value).length;
const encodeInput = value => encodeURIComponent(text(value)).replace(/%7B%7B(.*?)%7D%7D/g,(_,name)=>`{{${decodeURIComponent(name)}}}`).replace(/%40([tsr])\./gi,'@$1.');
const privateName = key => PRIVATE_KEY.test(String(key).replace(/([a-z])([A-Z])/g,'$1_$2')) || /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i.test(key);

function boundedTree(value, depth = 0, budget = { nodes: 0 }) {
  if (depth > API_SOURCE_LIMITS.maxDepth || ++budget.nodes > 60_000) fail('This API source is too deeply nested or contains too many fields. Split it into smaller sources.');
  if (value && typeof value === 'object') for (const [key,item] of Object.entries(value)) {
    if (['__proto__','prototype','constructor'].includes(key)) fail('This API source contains an unsupported object key.');
    boundedTree(item, depth + 1, budget);
  }
}

function context() {
  const warnings = new Set(), parameters = {}, privateParameters = new Set(), privateKeys = new Set(), names = new Map();
  const nameFor = (key,identity = key) => {
    const original = text(key).trim();
    if (names.has(identity)) return names.get(identity);
    let name = original.toLowerCase().replace(/[^a-z0-9_-]/g,'_').replace(/^_+|_+$/g,'') || 'parameter';
    if (!/^[a-z]/.test(name)) name = `input_${name}`;
    const stem = name; let index = 1;
    while ([...names.values()].includes(name)) name = `${stem}_${++index}`;
    names.set(identity,name); return name;
  };
  const reference = (key, value = '', secret = false) => {
    if(secret)privateKeys.add(key);
    const hidden = privateKeys.has(key) || privateName(key);
    // Postman folder scopes may redefine a public variable. Keep those values
    // separate rather than making both requests use the first folder's value.
    const name = nameFor(key,JSON.stringify([key,hidden?'':text(value),hidden]));
    if (hidden || privateParameters.has(`t.${name}`)) {
      privateParameters.add(`t.${name}`); parameters[name] = '';
      warnings.add('Credential values were removed. Set the listed private Test parameters before running this case.');
    } else if (!Object.hasOwn(parameters,name) || !parameters[name]) parameters[name] = text(value);
    return `@t.${name}`;
  };
  const variables = (value, defaults = {}) => text(value).replace(/\{\{\s*([^{}]+?)\s*\}\}|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, postman, brace, shell) => {
    const key = postman || brace || shell; return reference(key, defaults[key] ?? '', privateName(key));
  });
  const protectValue = (key,value,defaults) => {
    const normalized = variables(value, defaults);
    if(!privateName(key)||!normalized)return normalized;
    return protectPrivateValue(normalized,key);
  };
  const protectPrivateValue = (value,key) => {
    if(/^@t\.[A-Za-z][A-Za-z0-9_-]*$/.test(value)||/^(?:Bearer|Basic)\s+@t\.[A-Za-z][A-Za-z0-9_-]*$/i.test(value)){
      for(const match of value.matchAll(/@t\.([A-Za-z][A-Za-z0-9_-]*)/g)){privateParameters.add(`t.${match[1]}`);parameters[match[1]]='';}
      return value;
    }
    return reference(`imported_${key}`,'',true);
  };
  return { warnings,parameters,privateParameters,reference,variables,protectValue,protectPrivateValue };
}

function normalizedRequest(input, ctx, defaults = {}) {
  const method = text(input.method || 'GET').toUpperCase();
  if (!METHODS.has(method)) fail(`HTTP method ${method} is not supported. No requests were imported.`);
  let url = ctx.variables(input.url, defaults).trim();
  if (!url) fail('Every imported request needs a URL. No requests were imported.');
  if (/\s|\u0000/.test(url)) fail('Encode spaces and remove control characters from imported API URLs.');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^https?:\/\//i.test(url)) fail('Only HTTP and HTTPS API URLs are supported.');
  const inspectUrl=url.replace(/@[tsr]\.[A-Za-z][A-Za-z0-9_-]*/g,'parameter');
  if (/^https?:\/\/[^/]*@/i.test(inspectUrl)) fail('Remove credentials embedded in the API URL; use a private Authorization header instead.');
  if(/^https?:\/\//i.test(inspectUrl)){try{new URL(inspectUrl);}catch{fail('An imported API URL is invalid. Correct it before importing.');}}
  // Keep URL encoding and ordering; redact sensitive literal query values in place.
  url = url.replace(/([?&])([^=&#]+)=([^&#]*)/g, (full, separator, key, value) => {
    let decoded = key; try { decoded = decodeURIComponent(key); } catch { /* retain malformed source spelling */ }
    return privateName(decoded) && value ? `${separator}${key}=${ctx.protectPrivateValue(value,`query_${decoded}`)}` : full;
  });
  const headers = list(input.headers).map(row => {
    const key = text(row.key ?? row.name).trim(), value = ctx.protectValue(key,row.value,defaults);
    if (!key || /[\r\n]/.test(key + value)) fail('Imported headers must have names and may not contain newlines.');
    return { key,value };
  });
  const bodyMode = input.body_mode || (input.body ? 'text' : 'none');
  let body = ctx.variables(input.body ?? '',defaults);
  if (bodyMode === 'json' && body) {
    let parsed; try { parsed = JSON.parse(body); } catch { fail('An imported JSON request body is invalid. Correct it before importing.'); }
    const protect = value => {
      if (Array.isArray(value)) return value.map(protect);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).map(([key,item]) => [key, privateName(key) && item != null && item !== '' ? ctx.protectPrivateValue(text(item),`body_${key}`) : protect(item)]));
    };
    body = JSON.stringify(protect(parsed), null, 2);
  } else if (bodyMode === 'form' && body) {
    body = body.split('&').map(pair => {
      const at = pair.indexOf('='); if (at < 0) return pair;
      const key = pair.slice(0,at); let decoded = key; try { decoded = decodeURIComponent(key.replace(/\+/g,' ')); } catch {}
      return privateName(decoded) ? `${key}=${ctx.protectPrivateValue(pair.slice(at+1),`body_${decoded}`)}` : pair;
    }).join('&');
  } else if (body && /(?:password|passwd|secret|token|credential|api[_-]?key)\s*[=:]/i.test(body)) {
    body = ctx.reference('request_body','',true);
    ctx.warnings.add('A free-text body contains credential-like fields. Supply its complete value as the private request_body parameter.');
  }
  const validations = list(input.validations).map(item => ({...item}));
  if (!validations.length) ctx.warnings.add('Some requests have no declared response assertion. Review their expected results and add assertions before relying on a passing run.');
  return { method,url,headers,body_mode:bodyMode,body:bodyMode === 'none' ? null : body,validations,captures:list(input.captures),timeout_ms:30_000,follow_redirects:false };
}

function addStep(steps, ctx, request, title, description, defaults = {}) {
  if (steps.length >= API_SOURCE_LIMITS.maxRequests) fail(`This source exceeds ${API_SOURCE_LIMITS.maxRequests} requests. Split it into smaller cases; no partial import was applied.`);
  const api_request = normalizedRequest(request,ctx,defaults);
  const declaredStatus = api_request.validations.find(item=>item.kind === 'status')?.expected;
  steps.push({ step_order:steps.length+1,step_type:'api',action:text(title).trim() || `Send ${api_request.method} request ${steps.length+1}`,
    expected_result:declaredStatus ? `The response status is ${declaredStatus}.` : description || '',api_request });
}

function postmanUrl(value) {
  if (typeof value === 'string') return value;
  const url = object(value);
  if (url.raw) return url.raw;
  const host = Array.isArray(url.host) ? url.host.join('.') : text(url.host);
  const path = Array.isArray(url.path) ? url.path.join('/') : text(url.path);
  const base = `${url.protocol ? `${url.protocol}://` : ''}${host}${path ? `/${path.replace(/^\//,'')}` : ''}`;
  const query = list(url.query).filter(row=>!row.disabled&&row.key).map(row=>`${encodeURIComponent(row.key)}=${encodeURIComponent(text(row.value)).replace(/%7B%7B(.+?)%7D%7D/g,'{{$1}}')}`).join('&');
  return `${base}${query ? `?${query}` : ''}`;
}
function postmanAuth(auth, headers, ctx, defaults) {
  const value = object(auth);
  if (!value.type || value.type === 'noauth' || headers.some(row=>/authorization/i.test(row.key))) return;
  const fields = Object.fromEntries(list(value[value.type]).map(item=>[item.key,item.value]));
  if (value.type === 'bearer') headers.push({key:'Authorization',value:ctx.protectPrivateValue(`Bearer ${ctx.variables(fields.token,defaults)}`,'authorization')});
  else if (value.type === 'basic') headers.push({key:'Authorization',value:ctx.reference('authorization','',true)});
  else if (value.type === 'apikey' && fields.in === 'query') return {key:text(fields.key)||'api_key',value:ctx.protectPrivateValue(ctx.variables(fields.value,defaults),text(fields.key)||'api_key')};
  else if (value.type === 'apikey') headers.push({key:text(fields.key)||'X-API-Key',value:ctx.protectPrivateValue(ctx.variables(fields.value,defaults),text(fields.key)||'api_key')});
  else fail(`Postman ${value.type} authentication cannot be imported faithfully. Configure a private request header or query parameter before importing.`);
}
function postmanChecks(events,ctx,defaults) {
  const statuses=new Set(),captures=new Map();let unsupported=false,hasStatusChecks=false;
  const memberPath=node=>node?.type==='Identifier'?node.name:node?.type==='MemberExpression'&&!node.optional
    ? `${memberPath(node.object)}.${node.computed?node.property?.value:node.property?.name}` : '';
  for(const event of list(events)){
    if(event.listen!=='test'){unsupported=true;continue;}
    const lines=event.script?.exec;
    if(!Array.isArray(lines)){unsupported=true;continue;}
    const source=lines.join('\n');if(bytes(source)>64*1024){unsupported=true;continue;}
    let tree;try{tree=parseScript(source,{ecmaVersion:'latest'});}catch{unsupported=true;continue;}
    const forbidden=node=>{
      if(!node||typeof node!=='object')return false;
      if(['AssignmentExpression','UpdateExpression','IfStatement','SwitchStatement','ForStatement','ForInStatement','ForOfStatement','WhileStatement','DoWhileStatement','TryStatement','ConditionalExpression','FunctionDeclaration','WithStatement'].includes(node.type))return true;
      return Object.values(node).some(value=>Array.isArray(value)?value.some(forbidden):value&&typeof value==='object'&&forbidden(value));
    };
    if(forbidden(tree)){unsupported=true;continue;}
    const scriptStatuses=new Set(),scriptCaptures=new Map();let scriptUnsupported=false;
    const aliases=new Map();
    const responsePath=node=>{
      if(node?.type==='CallExpression'&&memberPath(node.callee)==='pm.response.json'&&node.arguments.length===0)return '$';
      if(node?.type==='Identifier')return aliases.get(node.name);
      if(node?.type==='MemberExpression'&&!node.optional){const parent=responsePath(node.object);const key=node.computed?node.property?.value:node.property?.name;
        if(parent&&typeof key==='number'&&Number.isInteger(key)&&key>=0)return `${parent}[${key}]`;
        if(parent&&typeof key==='string'&&/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key))return `${parent}.${key}`;
      }
      return null;
    };
    const statusValue=node=>{
      const name=memberPath(node.callee);
      if(name==='pm.response.to.have.status'&&node.arguments[0]?.type==='Literal')return node.arguments[0].value;
      if(node.callee?.type==='MemberExpression'&&['eql','equal','equals'].includes(node.callee.property?.name)){
        const expected=node.callee.object?.object;
        if(expected?.type==='CallExpression'&&memberPath(expected.callee)==='pm.expect'&&memberPath(expected.arguments[0])==='pm.response.code')return node.arguments[0]?.value;
      }
      return null;
    };
    const walk=node=>{
      if(!node)return;
      if(node.type==='Program'||node.type==='BlockStatement'){node.body.forEach(walk);return;}
      if(node.type==='VariableDeclaration'){
        for(const declaration of node.declarations){const path=responsePath(declaration.init);if(node.kind==='const'&&declaration.id?.type==='Identifier'&&path)aliases.set(declaration.id.name,path);else scriptUnsupported=true;}
        return;
      }
      if(node.type==='ExpressionStatement'){walk(node.expression);return;}
      if(node.type!=='CallExpression'){scriptUnsupported=true;return;}
      const name=memberPath(node.callee),status=statusValue(node);
      if(status!=null){if(Number.isInteger(status)&&status>=100&&status<=599)scriptStatuses.add(String(status));else scriptUnsupported=true;return;}
      if(name==='pm.test'){
        const callback=node.arguments[1];if(callback&&['FunctionExpression','ArrowFunctionExpression'].includes(callback.type)&&callback.params.length===0)walk(callback.body);else scriptUnsupported=true;return;
      }
      if(/^pm\.(?:environment|collectionVariables|globals|variables)\.set$/.test(name)){
        const key=node.arguments[0]?.value,path=responsePath(node.arguments[1]);
        if(typeof key==='string'&&key.trim()&&path){const parameter=ctx.reference(key,defaults[key]??'',privateName(key)||privateName(path)).slice(1);scriptCaptures.set(parameter,{path,parameter});}
        else scriptUnsupported=true;
        return;
      }
      scriptUnsupported=true;
    };
    walk(tree);
    if(scriptUnsupported){unsupported=true;continue;}
    for(const status of scriptStatuses)statuses.add(status);
    hasStatusChecks ||= scriptStatuses.size>0;
    for(const [name,capture] of scriptCaptures)captures.set(name,capture);
  }
  if(statuses.size>1){statuses.clear();ctx.warnings.add('Postman tests declare conflicting response statuses. Review their conditions and choose an explicit assertion.');}
  if(unsupported)ctx.warnings.add('Only direct Postman status checks and JSON response-variable captures were translated. Review other scripts, conditions and pre-request behavior manually; scripts are never executed.');
  return {validations:[...statuses].map(expected=>({kind:'status',expected})),captures:[...captures.values()],hasStatusChecks};
}
function fromPostman(document,ctx) {
  const steps=[];
  const defaults = variables => Object.fromEntries(list(variables).filter(row=>row.key||row.id).map(row=>[text(row.key||row.id),row.value]));
  const visit=(items,inherited={},inheritedAuth,inheritedEvents=[])=>{
    for (const item of list(items)) {
      const local={...inherited,...defaults(item.variable)}, auth=item.auth ?? inheritedAuth;
      const events=[...inheritedEvents,...list(item.event)];
      if (Array.isArray(item.item)) { visit(item.item,local,auth,events); continue; }
      const request=typeof item.request==='string'?{url:item.request}:object(item.request);
      if (!Object.keys(request).length) fail('A Postman item has no request. No requests were imported.');
      const headers=list(request.header).filter(row=>!row.disabled).map(row=>({key:row.key,value:row.value}));
      const authQuery=postmanAuth(request.auth ?? auth,headers,ctx,local);
      let url=postmanUrl(request.url);
      if(authQuery)url+=`${url.includes('?')?'&':'?'}${encodeURIComponent(authQuery.key)}=${authQuery.value}`;
      const mode=request.body?.mode; let body='',body_mode='none';
      if(mode==='raw') {body=text(request.body.raw);body_mode=request.body.options?.raw?.language==='json'||headers.some(row=>/content-type/i.test(row.key)&&/json/i.test(row.value))?'json':request.body.options?.raw?.language==='xml'?'xml':'text';}
      else if(mode==='urlencoded') {body=list(request.body.urlencoded).filter(row=>!row.disabled).map(row=>`${encodeURIComponent(row.key)}=${encodeInput(row.value)}`).join('&');body_mode='form';}
      else if(mode&&mode!=='none') fail(`Postman ${mode} bodies need manual file/binary setup. No requests were imported.`);
      // Saved example statuses are observations, not generic assumptions. Multiple examples need explicit review.
      const statuses=[...new Set(list(item.response).map(row=>Number(row.code)).filter(code=>code>=100&&code<=599))];
      if(statuses.length>1)ctx.warnings.add('A Postman request has multiple example statuses. No single expected status was chosen for it.');
      const checks=postmanChecks(events,ctx,local);
      addStep(steps,ctx,{method:request.method,url,headers,body_mode,body,captures:checks.captures,validations:checks.hasStatusChecks?checks.validations:statuses.length===1?[{kind:'status',expected:String(statuses[0])}]:[]},item.name,undefined,local);
    }
  };
  visit(document.item,defaults(document.variable),document.auth,list(document.event));
  return {title:document.info?.name||'Imported API collection',steps};
}

function fromHar(document,ctx) {
  const steps=[];
  for(const entry of list(document.log?.entries)) {
    const request=object(entry.request),post=object(request.postData),mime=text(post.mimeType).toLowerCase();
    if(post.params?.some(row=>row.fileName))fail('HAR file upload requests need manual file setup. No requests were imported.');
    if(post.text && (post.encoding==='base64'||/octet-stream|multipart\/form-data/.test(mime)))fail('HAR binary and multipart bodies require manual setup. No requests were imported.');
    const body=post.text ?? list(post.params).map(row=>`${encodeURIComponent(row.name)}=${encodeURIComponent(text(row.value))}`).join('&');
    const headers=list(request.headers).filter(row=>!row.name?.startsWith(':')&&!/^(host|content-length|connection|accept-encoding)$/i.test(row.name)).map(row=>({key:row.name,value:row.value}));
    if(list(request.cookies).length&&!headers.some(row=>/^cookie$/i.test(row.key)))headers.push({key:'Cookie',value:request.cookies.map(row=>`${row.name}=${row.value}`).join('; ')});
    const status=Number(entry.response?.status);
    addStep(steps,ctx,{method:request.method,url:request.url,headers,body_mode:!body?'none':mime.includes('json')?'json':mime.includes('x-www-form-urlencoded')?'form':mime.includes('xml')?'xml':'text',body,validations:status>=100&&status<=599?[{kind:'status',expected:String(status)}]:[]},`${request.method||'GET'} ${request.url?.split('?')[0]||'API request'}`);
  }
  ctx.warnings.add('HAR requests and observed statuses are imported as recorded. Review volatile IDs, request order, authentication and expected behavior before running.');
  return {title:'Imported HAR API journey',steps};
}

function tokenizeCurl(source) {
  const commands=[];let args=[],value='',quote='',active=false;
  const flush=()=>{if(active){args.push(value);value='';active=false;}};
  for(let i=0;i<source.length;i++){
    const char=source[i];
    if(char==='#'&&!quote&&!active&&!args.length){while(i<source.length&&!/[\r\n]/.test(source[i]))i++;continue;}
    if(char==='\\'&&source[i+1]==='\n'){i++;continue;}
    if(char==='\\'&&source[i+1]==='\r'&&source[i+2]==='\n'){i+=2;continue;}
    if(char==='\\'&&quote!=="'") {if(i+1>=source.length)fail('The cURL source ends with an incomplete escape.');value+=source[++i];active=true;continue;}
    if(quote){if(char===quote)quote='';else value+=char;active=true;continue;}
    if(char==='"'||char==="'"){quote=char;active=true;continue;}
    if(/[\s]/.test(char)){flush();if((char==='\n'||char==='\r')&&args.length){commands.push(args);args=[];}continue;}
    if(char===';'||(char==='&'&&source[i+1]==='&')){flush();if(args.length)commands.push(args);args=[];if(char==='&')i++;continue;}
    if('|<>`'.includes(char)||char==='&')fail('Only cURL request commands can be imported. Remove pipes, redirections and shell operators.');
    value+=char;active=true;
  }
  if(quote)fail('The cURL source has an unclosed quote.');flush();if(args.length)commands.push(args);return commands;
}
function fromCurl(source,ctx) {
  if(/\$\(|`/.test(source))fail('Shell substitutions cannot be imported. Paste literal cURL requests with parameter placeholders.');
  const steps=[];
  for(const tokens of tokenizeCurl(source)){
    if(tokens.shift()!=='curl')fail('Every command must start with curl; other shell commands are not executed.');
    let method='',url='',headers=[],parts=[],body_mode='none',get=false,head=false;
    const take=flag=>{if(!tokens.length)fail(`${flag} needs a value.`);return tokens.shift();};
    while(tokens.length){
      let arg=tokens.shift();
      const longValue=/^(--[^=]+)=(.*)$/.exec(arg);
      const shortValue=/^(-[XHdbuA])(.*)$/.exec(arg);
      if(longValue){arg=longValue[1];tokens.unshift(longValue[2]);}
      else if(shortValue&&shortValue[2]){arg=shortValue[1];tokens.unshift(shortValue[2]);}
      else if(/^-[sSLI]{2,}$/.test(arg)){tokens.unshift(...arg.slice(1).split('').map(flag=>`-${flag}`));continue;}
      if(arg==='--'){if(tokens.length!==1||url)fail('Use one URL per cURL command.');url=tokens.shift();continue;}
      if(arg==='-X'||arg==='--request')method=take(arg);
      else if(arg==='--url')url=take(arg);
      else if(arg==='-H'||arg==='--header'){const header=take(arg),at=header.indexOf(':');if(at<1)fail('Each cURL header needs a name and colon.');headers.push({key:header.slice(0,at),value:header.slice(at+1).trim()});}
      else if(['-d','--data','--data-raw','--data-binary','--data-ascii','--data-urlencode','--json'].includes(arg)){
        const value=take(arg);if(value.startsWith('@')&&arg!=='--data-raw')fail('cURL file bodies need manual setup; local files are never read.');
        if(arg==='--data-urlencode'){const at=value.indexOf('=');if(at<1)fail('Use name=value for --data-urlencode.');parts.push(`${encodeURIComponent(value.slice(0,at))}=${encodeURIComponent(value.slice(at+1))}`);body_mode='form';}
        else{parts.push(value);if(arg==='--json'){body_mode='json';headers.push({key:'Content-Type',value:'application/json'});}else if(body_mode==='none')body_mode='form';}
      } else if(arg==='-G'||arg==='--get')get=true;
      else if(arg==='-I'||arg==='--head')head=true;
      else if(['-s','--silent','-S','--show-error','--fail','--fail-with-body','-L','--location','--compressed'].includes(arg)){if(['-L','--location'].includes(arg))ctx.warnings.add('cURL redirect-following is disabled for the draft; review destination policy before enabling redirects.');}
      else if(arg==='-b'||arg==='--cookie')headers.push({key:'Cookie',value:take(arg)});
      else if(arg==='-u'||arg==='--user'){take(arg);headers.push({key:'Authorization',value:ctx.reference('authorization','',true)});ctx.warnings.add('cURL user credentials were removed. Supply the complete Authorization value as a private Test parameter.');}
      else if(arg==='-A'||arg==='--user-agent')headers.push({key:'User-Agent',value:take(arg)});
      else if(arg.startsWith('-'))fail(`Unsupported cURL option ${arg}. Remove it or configure its behavior manually before importing.`);
      else if(url)fail('Use one URL per cURL command. Put additional requests in separate curl commands.');
      else url=arg;
    }
    let body=parts.join('&');
    if(headers.some(row=>/^content-type$/i.test(row.key)&&/json/i.test(row.value)))body_mode='json';
    if(get&&body){url+=`${url.includes('?')?'&':'?'}${body}`;body='';body_mode='none';}
    if(!body)body_mode='none';
    addStep(steps,ctx,{method:method||(head?'HEAD':get?'GET':body?'POST':'GET'),url,headers,body_mode,body},`Send ${method||(head?'HEAD':get?'GET':body?'POST':'GET')} request ${steps.length+1}`);
  }
  return {title:'Imported cURL API journey',steps};
}

function fromOpenApi(document,ctx) {
  const steps=[];
  const resolve=(value,seen=new Set())=>{
    if(!value?.$ref)return value;
    if(typeof value.$ref!=='string'||!value.$ref.startsWith('#/'))fail('External OpenAPI references are not fetched. Inline or bundle the referenced document first.');
    if(seen.has(value.$ref)||seen.size>20)fail('Circular OpenAPI references need an explicit request example.');
    seen.add(value.$ref);let result=document;
    for(const key of value.$ref.slice(2).split('/').map(part=>part.replace(/~1/g,'/').replace(/~0/g,'~')))result=result?.[key];
    if(!result)fail('An OpenAPI reference could not be resolved.');return resolve(result,seen);
  };
  const example=(value)=>{
    const target=resolve(value)||{};
    if(Object.hasOwn(target,'example'))return target.example;
    const examples=Object.values(object(target.examples));if(examples.length){if(examples.length>1)ctx.warnings.add('An operation has multiple request examples. The first declared example was prepared for review.');const selected=resolve(examples[0]);if(selected.externalValue)fail('External OpenAPI examples are not fetched. Inline the example value before importing.');if(Object.hasOwn(selected,'value'))return selected.value;}
    const schema=resolve(target.schema);return schema&&Object.hasOwn(schema,'example')?schema.example:undefined;
  };
  const swagger=String(document.swagger||'').startsWith('2.');
  for(const [path,rawPath] of Object.entries(object(document.paths))){
    const pathItem=resolve(rawPath);
    for(const [verb,rawOperation] of Object.entries(pathItem||{})){
      const method=verb.toUpperCase();
      if(['TRACE','CONNECT'].includes(method))fail(`HTTP method ${method} is not supported. No requests were imported.`);
      if(!METHODS.has(method))continue;
      const operation=resolve(rawOperation),servers=operation.servers||pathItem.servers||document.servers;
      if(!swagger&&servers?.length>1)ctx.warnings.add('The document offers multiple servers. The first declared server was prepared for review.');
      let base=swagger?`${document.schemes?.[0]||'https'}://${document.host||''}${document.basePath||''}`:text(servers?.[0]?.url);
      if(!base||swagger&&!document.host){base=ctx.reference('base_url');ctx.warnings.add('The document has no API server URL. Set the base_url Test parameter before running.');}
      if(!swagger&&servers?.[0]?.variables)for(const [name,configuration] of Object.entries(servers[0].variables))base=base.replaceAll(`{${name}}`,text(configuration.default??ctx.reference(name)));
      let url=base.replace(/\/$/,'')+path,headers=[],body='',body_mode='none',query=[];
      const parameters=new Map([...list(pathItem.parameters),...list(operation.parameters)].map(value=>{const p=resolve(value);return [`${p.in}:${p.name}`,p];}));
      for(const parameter of parameters.values()){
        let value=example(parameter);if(value===undefined&&parameter.schema&&Object.hasOwn(resolve(parameter.schema),'default'))value=resolve(parameter.schema).default;
        if(value===undefined&&Object.hasOwn(parameter,'default'))value=parameter.default;
        if(parameter.in==='body'){
          const media=list(operation.consumes||document.consumes)[0]||'application/json';
          body_mode=media.includes('json')?'json':media.includes('xml')?'xml':'text';
          if(value===undefined){body=ctx.reference(`request_body_${steps.length+1}`);body_mode='text';ctx.warnings.add('An operation has no body example. Set its complete request_body Test parameter before running; schema fields were not invented.');}
          else body=typeof value==='string'?value:JSON.stringify(value);
          headers.push({key:'Content-Type',value:media});continue;
        }
        if(value===undefined)value=ctx.reference(parameter.name);
        if(typeof value==='object')fail(`OpenAPI parameter ${parameter.name} needs manual serialization; only scalar request parameters are imported.`);
        value=ctx.variables(text(value));
        if(parameter.in==='path')url=url.replaceAll(`{${parameter.name}}`,value);
        else if(parameter.in==='query')query.push(`${encodeURIComponent(parameter.name)}=${value.startsWith('@t.')?value:encodeURIComponent(value)}`);
        else if(parameter.in==='header')headers.push({key:parameter.name,value});
        else if(parameter.in==='cookie')headers.push({key:'Cookie',value:ctx.reference('cookie','',true)});
        else if(parameter.in==='formData')fail('Swagger form/file parameters require manual body setup. No requests were imported.');
      }
      url=url.replace(/\{([^{}]+)\}/g,(_,name)=>ctx.reference(name));
      if(query.length)url+=`${url.includes('?')?'&':'?'}${query.join('&')}`;
      if(!swagger&&operation.requestBody){
        const requestBody=resolve(operation.requestBody),contents=Object.entries(object(requestBody.content));
        if(!contents.length)fail('An OpenAPI request body has no media-type contract.');
        const [media,contract]=contents.find(([type])=>type==='application/json')||contents[0];
        if(contents.length>1)ctx.warnings.add('An operation has multiple request media types. One declared representation was prepared; review its Content-Type and body.');
        if(/multipart|octet-stream/.test(media))fail('OpenAPI multipart/binary bodies need manual file setup. No requests were imported.');
        const supplied=example(contract);
        body_mode=media.includes('json')?'json':media.includes('x-www-form-urlencoded')?'form':media.includes('xml')?'xml':'text';
        if(supplied===undefined){body=ctx.reference(`request_body_${steps.length+1}`);body_mode='text';ctx.warnings.add('An operation has no body example. Set its complete request_body Test parameter and verify its Content-Type; schema fields were not invented.');}
        else body=typeof supplied==='string'?supplied:JSON.stringify(supplied);
        headers.push({key:'Content-Type',value:media});
      }
      const security=operation.security??document.security;
      if(list(security).length&&!security.some(item=>Object.keys(object(item)).length===0)){
        if(security.length>1)ctx.warnings.add('This operation offers alternative security schemes. The first declared scheme was prepared; review it before running.');
        for(const name of Object.keys(object(security[0]))){
          const schemes=swagger?document.securityDefinitions:document.components?.securitySchemes;
          const scheme=resolve(schemes?.[name]);
          if(!scheme)fail(`OpenAPI security scheme ${name} could not be resolved.`);
          if(scheme.type==='apiKey'){
            const key=text(scheme.name);if(!key)fail('An OpenAPI API key security scheme has no parameter name.');
            const value=ctx.reference(`auth_${key}`,'',true);
            if(scheme.in==='query')url+=`${url.includes('?')?'&':'?'}${encodeURIComponent(key)}=${value}`;
            else if(scheme.in==='header')headers.push({key,value});
            else if(scheme.in==='cookie')headers.push({key:'Cookie',value:ctx.reference('cookie','',true)});
            else fail('The API key security location is not supported.');
          }else if(['basic','oauth2','openIdConnect'].includes(scheme.type)||scheme.type==='http'&&['basic','bearer'].includes(text(scheme.scheme).toLowerCase())){
            headers.push({key:'Authorization',value:ctx.reference(`authorization_${name}`,'',true)});
          }else fail(`OpenAPI ${scheme.type||'unknown'} authentication needs managed client configuration before import.`);
        }
        ctx.warnings.add('Documented credentials were replaced with private inputs. Supply complete Authorization/Cookie header values where requested before running.');
      }
      const statuses=Object.keys(object(operation.responses)).filter(code=>/^\d{3}$/.test(code)&&Number(code)>=100&&Number(code)<=599);
      const success=statuses.filter(code=>Number(code)<300&&Number(code)>=200);
      const status=success.length===1?success[0]:statuses.length===1?statuses[0]:null;
      if(statuses.length&&!status)ctx.warnings.add('An operation documents multiple response outcomes; no single status assertion was chosen.');
      addStep(steps,ctx,{method,url,headers,body_mode,body,validations:status?[{kind:'status',expected:status}]:[]},operation.summary||operation.operationId||`${method} ${path}`);
    }
  }
  ctx.warnings.add('OpenAPI operation order is document order, not a verified business journey. Review prerequisites, captures and request sequence before execution.');
  return {title:document.info?.title||'Imported API document',steps};
}

export function parseApiSourceIntake(source, { format = 'auto' } = {}) {
  if(typeof source!=='string'||!source.trim())fail('Paste an API source or choose a source file.');
  if(bytes(source)>API_SOURCE_LIMITS.maxBytes)fail('API sources are limited to 2 MB. Split this source into smaller cases.');
  const ctx=context();let document,result,resolved=format;
  if(format==='curl'||format==='auto'&&/^\s*(?:#[^\r\n]*[\r\n]\s*)*curl(?:\s|$)/.test(source)){resolved='curl';result=fromCurl(source,ctx);}
  else{
    try{document=JSON.parse(source);}catch{
      try{document=parseYaml(source,{maxAliasCount:0,uniqueKeys:true,merge:false});}catch{fail('This source is not valid JSON or YAML. Correct the document before importing.');}
    }
    boundedTree(document);
    if(!document||typeof document!=='object'||Array.isArray(document))fail('Choose a Postman collection, HAR file or OpenAPI document.');
    if(format==='postman'||format==='auto'&&Array.isArray(document.item)){resolved='postman';result=fromPostman(document,ctx);}
    else if(format==='har'||format==='auto'&&Array.isArray(document.log?.entries)){resolved='har';result=fromHar(document,ctx);}
    else if(format==='openapi'||format==='auto'&&(document.openapi||document.swagger)){resolved='openapi';result=fromOpenApi(document,ctx);}
    else fail('This document is not a supported Postman collection, HAR file or OpenAPI document. For prose API documentation, supply an OpenAPI export or explicit cURL requests.');
  }
  if(!result.steps.length)fail('No API requests were found. No draft steps were changed.');
  const serialized=JSON.stringify(result.steps);
  if(bytes(serialized)>API_SOURCE_LIMITS.maxBytes)fail('The expanded requests exceed the 2 MB draft limit. Split the source into smaller cases.');
  return { title:text(result.title).slice(0,255),description:`Prepared from ${resolved === 'openapi' ? 'an OpenAPI document' : resolved === 'postman' ? 'a Postman collection' : resolved === 'har' ? 'a HAR capture' : 'cURL requests'}. Review all requests and assertions before running.`,source_format:resolved,steps:result.steps,parameter_values:ctx.parameters,private_parameter_names:[...ctx.privateParameters],warnings:[...ctx.warnings] };
}
