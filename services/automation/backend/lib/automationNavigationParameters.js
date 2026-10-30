const token='@(?:(?:t|s|r)\\.)?(?:\\[(?:\\\\.|[^\\]\\\\\\r\\n])+\\]|[A-Za-z][A-Za-z0-9_-]*)';
const authoredNavigation=new RegExp('\\b(?:open|navigate(?:\\s+to)?|go\\s+to|visit|browse(?:\\s+to)?)\\s+(?:the\\s+)?["\'`]?('+token+')','gi');

function canonicalNavigationUrl(value){
  if(typeof value!=='string'||!value||value.length>2000||value!==value.trim())return null;
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}

/** Select names from original authored navigation clauses only. URL-like
 * values elsewhere in the data map cannot turn a literal into a binding. */
function navigationParameterNames(actions,referencedParameterNames){
  const names=new Set();
  for(const row of actions||[]){
    const source=typeof row==='string'?row:row?.action;
    if(typeof source!=='string')continue;
    const text=source.replace(/<[^>]*>/g,' ');
    for(const match of text.matchAll(authoredNavigation))for(const name of referencedParameterNames([{action:match[1],expected_result:''}]))names.add(name);
  }
  return [...names];
}

module.exports={canonicalNavigationUrl,navigationParameterNames};
