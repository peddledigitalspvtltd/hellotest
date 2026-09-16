function h(l,s={}){const c=[],u=e=>s.preserveWhitespace?e:e.trim();let r="",i=[],t=!1;for(let e=0;e<l.length;e+=1){const n=l[e],o=l[e+1];if(n==='"'){if(t&&o==='"')r+='"',e+=1;else{if(s.strict&&!t&&r.length)throw new Error("A CSV quote must start at the beginning of a cell.");if(s.strict&&t&&o&&![",","\r",`
`].includes(o))throw new Error("A closing CSV quote must be followed by a comma or line break.");t=!t}continue}if(!t&&n===","){i.push(u(r)),r="";continue}if(!t&&(n===`
`||n==="\r")){n==="\r"&&o===`
`&&(e+=1),i.push(u(r)),c.push(i),r="",i=[];continue}r+=n}if(s.strict&&t)throw new Error("A CSV quoted value is missing its closing quote.");return(r||i.length)&&(i.push(u(r)),c.push(i)),c.filter(e=>e.some(n=>n.trim().length))}export{h as p};
