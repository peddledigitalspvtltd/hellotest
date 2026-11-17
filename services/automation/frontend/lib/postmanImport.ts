import { parseApiSourceIntake } from '../../shared/apiSourceIntake.mjs';
import type { ImportedTestCaseRow } from '@hellotest/testing/frontend/lib/testCaseImport';
import type { StepApiRequest } from '@hellotest/platform/frontend/src/types';

type ParsedPostmanCollection = { rows: ImportedTestCaseRow[]; warnings: string[] };
type RequestLocation = {name:string;folders:string[]};
const collapse = (value:string) => value.replace(/\s+/g,' ').trim();

function requestLocations(items:unknown, folders:string[] = []): RequestLocation[] {
  if(!Array.isArray(items))return [];
  return items.flatMap((item,index)=>{
    const name=collapse(String(item?.name||''))||`Request ${index+1}`;
    return Array.isArray(item?.item)?requestLocations(item.item,[...folders,name]):[{name,folders}];
  });
}

function smartTitle(method:string,url:string,fallback:string) {
  let path=url.split(/[?#]/)[0];
  try{path=new URL(path.replace(/@t\.[A-Za-z][A-Za-z0-9_-]*/g,'parameter'),'https://hellotest.local').pathname;}catch{/* Use the original path when its base URL is a parameter. */}
  const words=path.split('/').filter(Boolean).filter(segment=>!/^@t\.|^(?:api|rest|graphql|v\d+)$/i.test(segment)).slice(-3).map(segment=>{
    let decoded=segment;try{decoded=decodeURIComponent(segment);}catch{}
    if(/^[:@{]|^[\da-f]{8,}$/i.test(decoded))return 'By Id';
    return decoded.replace(/[_-]+/g,' ').replace(/([a-z0-9])([A-Z])/g,'$1 $2').split(/\s+/).map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join(' ');
  }).join(' ');
  const verb=method==='POST'?'Create':['PUT','PATCH'].includes(method)?'Update':method==='DELETE'?'Delete':method==='HEAD'?'Check':method==='OPTIONS'?'Inspect':'Get';
  return collapse(`${verb} ${words||fallback||'API Request'}`).slice(0,255);
}

/** Ordinary source import keeps one case per request; the Agent intake groups all requests in one case. */
export function parsePostmanCollectionTestCases(source:string):ParsedPostmanCollection {
  let document:{item?:unknown};
  try{document=JSON.parse(source) as {item?:unknown};}catch{return {rows:[],warnings:['The Postman collection export must be valid JSON.']};}
  try{
    const prepared=parseApiSourceIntake(source,{format:'postman'});
    const locations=requestLocations(document.item);
    const rows=prepared.steps.map((step,index):ImportedTestCaseRow=>{
      const location=locations[index]||{name:step.action,folders:[]};
      const request=step.api_request as StepApiRequest;
      const body=JSON.stringify(request);
      const names=new Set([...body.matchAll(/@t\.([A-Za-z][A-Za-z0-9_-]*)/g)].map(match=>match[1]));
      for(const capture of request.captures||[])if(capture.parameter?.startsWith('t.'))names.add(capture.parameter.slice(2));
      const privateNames=prepared.private_parameter_names.filter(name=>names.has(name.replace(/^t\./,'')));
      return {title:smartTitle(request.method||'GET',request.url||'',location.name),description:collapse([
        'Imported from a Postman collection.',`Collection: ${prepared.title}.`,location.folders.length?`Folder: ${location.folders.join(' / ')}.`:'',`Postman item: ${location.name}.`
      ].filter(Boolean).join(' ')),automated:'yes',automation_status:'incomplete',status:'draft',suite:prepared.title,
        parameter_values:Object.fromEntries(Object.entries(prepared.parameter_values).filter(([name])=>names.has(name))),
        ...(privateNames.length?{test_data_options:{private_parameter_names:privateNames}}:{}),
        steps:[{...step,step_order:1,api_request:request}]};
    });
    return {rows,warnings:prepared.warnings};
  }catch(error){return {rows:[],warnings:[error instanceof Error?error.message:'The Postman collection could not be imported.']};}
}
