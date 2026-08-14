import{c as p,r as d,j as t,F as y}from"./index-ISem8_Te.js";import{p as g,f}from"./externalReferences-BMoigrJN.js";/**
 * @license @tabler/icons-react v3.45.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */const j=[["path",{d:"M7 8l-4 4l4 4",key:"svg-0"}],["path",{d:"M17 8l4 4l-4 4",key:"svg-1"}],["path",{d:"M14 4l-4 16",key:"svg-2"}]],I=p("outline","code","Code",j);/**
 * @license @tabler/icons-react v3.45.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */const b=[["path",{d:"M9 15l6 -6",key:"svg-0"}],["path",{d:"M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464",key:"svg-1"}],["path",{d:"M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463",key:"svg-2"}]],v=p("outline","link","Link",b);/**
 * @license @tabler/icons-react v3.45.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */const R=[["path",{d:"M18 6l-12 12",key:"svg-0"}],["path",{d:"M6 6l12 12",key:"svg-1"}]],C=p("outline","x","X",R);function L({className:h="",disabled:a=!1,placeholder:x="Paste Jira links, docs, IDs; press ; to add",value:u,onChange:m}){const[r,i]=d.useState(""),l=`external-reference-${d.useId().replace(/:/g,"")}`,s=d.useMemo(()=>g(u),[u]),o=e=>{const n=e.trim();if(n){if(s.some(c=>c.toLowerCase()===n.toLowerCase())){i("");return}m(f([...s,n])),i("")}},k=e=>{m(f(s.filter(n=>n.toLowerCase()!==e.toLowerCase())))};return t.jsx(y,{className:["canonical-external-references-field",h].filter(Boolean).join(" "),composite:!0,inputId:l,label:"External references",labelIcon:t.jsx(v,{size:15}),hint:"Type a reference, then press semicolon or Enter to add it.",children:t.jsxs("div",{className:"requirement-reference-picker",children:[t.jsxs("div",{className:"requirement-reference-entry",children:[t.jsx("input",{"aria-describedby":`${l}-hint`,"aria-label":"Add external reference",disabled:a,id:l,placeholder:x,value:r,onBlur:()=>o(r),onChange:e=>{const n=e.target.value;if(/[;\n]$/.test(n)){o(n.replace(/[;\n]+$/g,""));return}i(n)},onKeyDown:e=>{(e.key==="Enter"||e.key===";")&&(e.preventDefault(),o(r))}}),t.jsx("button",{className:"ghost-button requirement-label-add-button",disabled:a||!r.trim(),onClick:()=>o(r),type:"button",children:"Add"})]}),s.length?t.jsx("div",{className:"requirement-reference-chip-row",children:s.map(e=>{const n=/^https?:\/\//i.test(e)?t.jsx("a",{href:e,onClick:c=>c.stopPropagation(),rel:"noreferrer",target:"_blank",children:e}):t.jsx("span",{children:e});return t.jsxs("span",{className:"requirement-reference-chip",title:`Remove ${e}`,children:[n,t.jsx("button",{"aria-label":`Remove ${e}`,disabled:a,onClick:()=>k(e),type:"button",children:t.jsx(C,{"aria-hidden":"true",size:13,stroke:2.2})})]},e)})}):null]})})}export{L as E,v as I,I as a,C as b};
