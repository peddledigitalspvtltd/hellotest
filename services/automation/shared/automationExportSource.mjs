import { parse } from "acorn";
const playwrightModules = new Set(["@playwright/test", "playwright/test"]);
const unsupportedSuiteCalls = new Set(["describe", "use", "beforeEach", "afterEach", "beforeAll", "afterAll", "extend", "only", "skip", "fixme"]);
/** Conservative dependency discovery, never a saved-source rewrite. Unknown
 * modules and dynamic bindings retain the complete compatibility runtime. */
export function automationExportRuntimeUsage(sources) {
    const names = new Set();
    try {
        for (const source of sources) {
            const tree = parse(String(source || ""), { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
            const statements = tree.body.filter(node => !["EmptyStatement", "ImportDeclaration"].includes(node.type));
            const entry = statements.length === 1 && statements[0];
            // The exporter injects whole or positional bindings into these
            // entrypoints, regardless of the author's local argument names.
            if (entry && (entry.type === "FunctionDeclaration" || entry.type === "ExportDefaultDeclaration"
                || entry.type === "ExpressionStatement" && ["FunctionExpression", "ArrowFunctionExpression", "AssignmentExpression"].includes(entry.expression.type)))
                return { web: true, api: true, readJsonPath: true };
            const pending = [tree];
            while (pending.length) {
                const node = pending.pop();
                if (!node || typeof node !== "object") continue;
                if (node.type === "Identifier") names.add(node.name);
                if (node.type === "ImportExpression" || node.type === "ImportDeclaration" && !playwrightModules.has(node.source.value))
                    return { web: true, api: true, readJsonPath: true };
                for (const value of Object.values(node))
                    if (Array.isArray(value)) pending.push(...value);
                    else if (value && typeof value === "object") pending.push(value);
            }
        }
        if (["bindings", "eval", "Function", "globalThis", "require"].some(name => names.has(name)))
            return { web: true, api: true, readJsonPath: true };
        return { web: names.has("web"), api: names.has("api"), readJsonPath: names.has("api") || names.has("readJsonPath") };
    } catch {
        return { web: true, api: true, readJsonPath: true };
    }
}
/** Lift module imports and invoke the same single-test/function entry points as
 * the runner. AST offsets preserve every statement inside the saved section. */
export function prepareAutomationExportSource(input, sectionIndex, options = {}) {
    const fence = input.trim().match(/^```(?:[A-Za-z0-9_-]+)?\s*([\s\S]*?)\s*```$/);
    const source = fence ? fence[1] : input;
    const imports = [], dependencies = [];
    const edits = [];
    const testNames = new Set(["test", "it"]);
    const playwrightNamespaces = new Set();
    const bindings = [];
    const moduleName = (node) => typeof node?.value === "string" ? node.value : "";
    const requirePortableModule = (module) => {
        if (/^@hellotest(?:\/|$)|^\/(?:src|services|@fs)(?:\/|$)|^@\//.test(module))
            throw new Error(`Application module ${JSON.stringify(module)} is unavailable outside HelloTest. Replace it with standalone Playwright operations or an exported local helper.`);
    };
    let importedIndex = 0;
    const importedBinding = (module, specifier) => {
        const local = specifier.local.name;
        const imported = specifier.type === "ImportSpecifier" ? specifier.imported.name || specifier.imported.value : "";
        if (playwrightModules.has(module) && ["test", "expect"].includes(imported)) {
            if (imported === "test")
                testNames.add(local);
            if (local !== imported)
                bindings.push(`const ${local} = ${imported};`);
            return;
        }
        if (playwrightModules.has(module) && specifier.type === "ImportNamespaceSpecifier")
            playwrightNamespaces.add(local);
        const alias = `__qaira_section_${sectionIndex}_import_${importedIndex++}`;
        const clause = specifier.type === "ImportDefaultSpecifier" ? alias
            : specifier.type === "ImportNamespaceSpecifier" ? `* as ${alias}`
                : `{ ${JSON.stringify(imported)} as ${alias} }`;
        imports.push(`import ${clause} from ${JSON.stringify(module)};`);
        bindings.push(`const ${local} = ${playwrightNamespaces.has(local) ? `{...${alias},test,expect}` : alias};`);
        dependencies.push(module);
    };
    try {
        const tree = parse(source, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
        const hasInstructions = (body) => body.some(node => !["EmptyStatement", "ImportDeclaration"].includes(node.type) && !(node.type === "ReturnStatement" && !node.argument));
        if (!hasInstructions(tree.body))
            throw new Error("This section has no executable instructions. Build or author the section before exporting it.");
        // Saved programs are JavaScript. Annotate their dynamic callback boundary in
        // the TypeScript export without rewriting statements, strings or assertions.
        const annotations = [];
        const inspectParameters = (node) => {
            if (!node || typeof node !== "object")
                return;
            if (options.typescript && ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) {
                for (const parameter of node.params) {
                    const binding = parameter.type === "AssignmentPattern" ? parameter.left : parameter.type === "RestElement" ? parameter.argument : parameter;
                    const unparenthesized = node.type === "ArrowFunctionExpression" && node.params.length === 1 && parameter.type === "Identifier" && !source.slice(node.start, parameter.start).trimEnd().endsWith("(");
                    annotations.push(unparenthesized
                        ? { start: binding.start, end: binding.end, value: `(${source.slice(binding.start, binding.end)}: any)` }
                        : { start: binding.end, end: binding.end, value: parameter.type === "RestElement" ? ": any[]" : ": any" });
                }
            }
            if (options.typescript && node.type === "CatchClause" && node.param)
                annotations.push({ start: node.param.end, end: node.param.end, value: ": any" });
            for (const value of Object.values(node))
                if (Array.isArray(value))
                    value.forEach(inspectParameters);
                else if (value && typeof value === "object")
                    inspectParameters(value);
        };
        inspectParameters(tree);
        const slice = (start, end) => {
            let result = source.slice(start, end);
            for (const edit of annotations.filter(edit => edit.start >= start && edit.end <= end).sort((left, right) => right.start - left.start))
                result = result.slice(0, edit.start - start) + edit.value + result.slice(edit.end - start);
            return result;
        };
        const inspectModules = (node) => {
            if (!node || typeof node !== "object")
                return;
            if (node.type === "ImportExpression") {
                const module = moduleName(node.source);
                if (!module)
                    throw new Error("Computed module imports cannot be hydrated for a standalone export. Use an explicit module path.");
                requirePortableModule(module);
                dependencies.push(module);
            }
            if (node.type === "CallExpression" && node.callee.name === "require")
                requirePortableModule(moduleName(node.arguments[0]));
            for (const value of Object.values(node))
                if (Array.isArray(value))
                    value.forEach(inspectModules);
                else if (value && typeof value === "object")
                    inspectModules(value);
        };
        inspectModules(tree);
        let statements = tree.body.filter((node) => node.type !== "ImportDeclaration" && node.type !== "EmptyStatement");
        for (const node of tree.body) {
            if (node.type !== "ImportDeclaration")
                continue;
            const module = moduleName(node.source);
            requirePortableModule(module);
            if (!node.specifiers.length) {
                imports.push(`import ${JSON.stringify(module)};`);
                dependencies.push(module);
            }
            node.specifiers.forEach((specifier) => importedBinding(module, specifier));
            edits.push({ start: node.start, end: node.end, value: "" });
        }
        const requires = statements.filter((node) => node.type === "VariableDeclaration" && node.declarations.some((declaration) => declaration.init?.type === "CallExpression" && declaration.init.callee.name === "require"));
        for (const node of requires) {
            const declaration = node.declarations[0];
            if (node.declarations.length !== 1 || !playwrightModules.has(moduleName(declaration.init.arguments[0])) || declaration.id.type !== "ObjectPattern" || declaration.id.properties.some((item) => item.type !== "Property" || !["test", "expect"].includes(item.key.name) || item.value.type !== "Identifier")) {
                throw new Error("Convert CommonJS module loading into explicit ES module imports before exporting this section.");
            }
            for (const property of declaration.id.properties)
                importedBinding(moduleName(declaration.init.arguments[0]), { type: "ImportSpecifier", imported: property.key, local: property.value });
            edits.push({ start: node.start, end: node.end, value: "" });
        }
        statements = statements.filter((node) => !requires.includes(node));
        const memberName = (node) => node.computed ? node.property.value : node.property.name;
        const testPath = (node) => {
            if (node?.type === "Identifier" && testNames.has(node.name))
                return [];
            if (node?.type !== "MemberExpression")
                return null;
            if (playwrightNamespaces.has(node.object.name) && memberName(node) === "test")
                return [];
            const parent = testPath(node.object);
            return parent ? [...parent, memberName(node)] : null;
        };
        const isTestCallee = (node) => testPath(node)?.length === 0;
        const tests = statements.filter((node) => node.type === "ExpressionStatement" && node.expression.type === "CallExpression" && isTestCallee(node.expression.callee));
        for (const node of statements) {
            const expression = node.type === "ExpressionStatement" ? node.expression : null;
            if (expression?.type === "CallExpression" && unsupportedSuiteCalls.has(testPath(expression.callee)?.[0] || "")) {
                throw new Error("Suite settings, hooks and test selection cannot be moved into a section. Configure them in the exported Playwright suite before running.");
            }
        }
        if (tests.length > 1)
            throw new Error("A section contains multiple Playwright tests. Split them into separate automation cases before exporting.");
        if (tests.length) {
            const statement = tests[0], callback = statement.expression.arguments.at(-1);
            if (!["ArrowFunctionExpression", "FunctionExpression"].includes(callback?.type))
                throw new Error("The Playwright test callback must be included in the saved section.");
            if (callback.body.type === "BlockStatement" && !hasInstructions(callback.body.body))
                throw new Error("The saved Playwright test has no executable instructions. Build or author the section before exporting it.");
            const callable = options.typescript ? `((${slice(callback.start, callback.end)}) as (...args: any[]) => any)` : `(${slice(callback.start, callback.end)})`;
            edits.push({ start: statement.start, end: statement.end, value: `await ${callable}({page,request,context,browser,browserName},testInfo);` });
        }
        else if (statements.length === 1) {
            const statement = statements[0];
            const entry = statement.type === "ExportDefaultDeclaration" ? statement.declaration
                : statement.type === "FunctionDeclaration" ? statement
                    : statement.type === "ExpressionStatement" && ["ArrowFunctionExpression", "FunctionExpression"].includes(statement.expression.type) ? statement.expression
                        : statement.type === "ExpressionStatement" && statement.expression.type === "AssignmentExpression" && /^(?:module\.exports|exports\.default)$/.test(source.slice(statement.expression.left.start, statement.expression.left.end)) ? statement.expression.right : null;
            if (entry && ["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(entry.type)) {
                if (entry.body.type === "BlockStatement" && !hasInstructions(entry.body.body))
                    throw new Error("The saved automation function has no executable instructions. Build or author the section before exporting it.");
                edits.push({ start: statement.start, end: statement.end, value: `const __qaira_automation${options.typescript ? ": (...args: any[]) => any" : ""} = (${slice(entry.start, entry.end)});\nawait (__qaira_automation.length > 1\n  ? __qaira_automation(page,web,expect,params,capture,playwrightPage,driver,bindings)\n  : __qaira_automation({...bindings,bindings}));` });
            }
            else if (statement.type.startsWith("Export"))
                throw new Error("This section export is not an executable automation function.");
        }
        for (const node of statements)
            if (node.type.startsWith("Export") && !edits.some(edit => edit.start === node.start && edit.end === node.end))
                throw new Error("Module exports must be converted to an automation function before exporting this section.");
        edits.push(...annotations.filter(annotation => !edits.some(edit => annotation.start >= edit.start && annotation.end <= edit.end)));
        let code = source;
        for (const edit of edits.sort((left, right) => right.start - left.start))
            code = code.slice(0, edit.start) + edit.value + code.slice(edit.end);
        return { code: [...bindings, code.trim()].filter(Boolean).join("\n"), imports, dependencies: [...new Set(dependencies)] };
    }
    catch (error) {
        const issue = error instanceof Error ? error.message : "This section could not be converted into a standalone Playwright step.";
        return { code: `throw new Error(${JSON.stringify(`Standalone export blocked: ${issue}`)});`, imports: [], dependencies: [], issue };
    }
}
