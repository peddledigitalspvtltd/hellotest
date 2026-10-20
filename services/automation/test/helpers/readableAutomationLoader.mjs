import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as keywordInputs from '../../frontend/lib/automationKeywordInputs.ts';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../../frontend/lib/automationReadableInstructions.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
export const readableAutomation={};
new Function('require','exports',compiled)(name=>name==='./automationKeywordInputs'?keywordInputs:require(name),readableAutomation);
