const {normalizeParameterKey}=require('@hellotest/platform/backend/src/utils/stepParameterResolution');

// Embedded templates use explicit scopes. A frozen value is inserted once and
// is never scanned again for apparent references inside application data.
const TEMPLATE_PARAMETER=/(?<![A-Za-z0-9_])@([tsr])\.(\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi;
function hasInvalidParameterTemplate(value){
 if(typeof value!=='string')return false;
 const starts=new Set([...value.matchAll(TEMPLATE_PARAMETER)].map(match=>match.index));
 return [...value.matchAll(/(?<![A-Za-z0-9_])@[tsr]\./gi)].some(match=>!starts.has(match.index));
}
function parameterTemplateParts(value){
 if(typeof value!=='string'||value.length>2000)return null;
 const parts=[];let offset=0;
 for(const match of value.matchAll(TEMPLATE_PARAMETER)){
  if(match.index>offset)parts.push({literal:value.slice(offset,match.index)});
  parts.push({key:normalizeParameterKey(match[0]),reference:match[0]});offset=match.index+match[0].length;
 }
 if(!parts.some(part=>part.key))return null;
 if(offset<value.length)parts.push({literal:value.slice(offset)});
 return parts;
}
function compositeParameterSource(value){
 const parts=parameterTemplateParts(value);
 if(!parts||!parts.some(part=>part.literal))return null;
 return '('+parts.map(part=>part.key?`String(params[${JSON.stringify(part.key)}])`:JSON.stringify(part.literal)).join(' + ')+')';
}
module.exports={parameterTemplateParts,compositeParameterSource,hasInvalidParameterTemplate};
