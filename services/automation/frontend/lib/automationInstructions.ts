import { parse, type Comment } from "acorn";

export type AutomationInstruction = { before: string; source: string };
export type AutomationInstructionDocument = { prefix: string; instructions: AutomationInstruction[]; suffix: string; valid: boolean; framed?: boolean };
type Statement = { type: string; start: number; end: number; body?: Statement | Statement[]; [key: string]: unknown };

const statementList = (node: Statement): Statement[] => Array.isArray(node.body) ? node.body : [];
const blockBody = (node: Statement): Statement | null => {
  const body = node.body;
  return body && !Array.isArray(body) && body.type === "BlockStatement" ? body : null;
};

function program(code: string) {
  const comments: Comment[] = [];
  const ast = parse(code, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, onComment: comments }) as unknown as Statement;
  return { ast, comments };
}

/** Only actual, whole-line metadata comments are hidden; template/string contents remain literal. */
export function stripAutomationSettingsComments(code: string) {
  try {
    const { comments } = program(code);
    const settings = comments.filter(comment => comment.type === "Line" && /^\s*@hellotest-options\b/.test(comment.value)
      && /^[\t ]*$/.test(code.slice(code.lastIndexOf("\n", comment.start - 1) + 1, comment.start)));
    return settings.reverse().reduce((text, comment) => text.slice(0, comment.start) + text.slice(comment.end), code);
  } catch { return code; }
}

/** Statement ranges preserve multiline calls, loops, callbacks, comments and incomplete drafts. */
export function readAutomationInstructions(code: string, { unwrapEntry = false }: { unwrapEntry?: boolean } = {}): AutomationInstructionDocument {
  try {
    const { ast, comments } = program(code);
    const frame = unwrapEntry ? singleInstructionFrame(ast) : null;
    const nodes = statementList(frame || ast);
    const bodyStart = frame ? frame.start + 1 : 0;
    const bodyEnd = frame ? frame.end - 1 : code.length;
    let prefixEnd = bodyStart;
    for (const comment of comments) {
      if (comment.start < bodyStart) continue;
      if (comment.start >= (nodes[0]?.start ?? bodyEnd)) break;
      if (comment.type === "Line" && /^\s*@hellotest-options\b/.test(comment.value)) {
        prefixEnd = comment.end;
        if (code[prefixEnd] === "\r") prefixEnd++;
        if (code[prefixEnd] === "\n") prefixEnd++;
      }
    }
    const prefix = code.slice(0, prefixEnd);
    let cursor = prefixEnd;
    const instructions: AutomationInstruction[] = [];
    for (const node of nodes) {
      let gap = code.slice(cursor, node.start);
      const trailingComment = instructionsForTrailingComment(comments, cursor, node.start, code);
      if (trailingComment && instructions.length) {
        instructions[instructions.length - 1].source += code.slice(cursor, trailingComment.end);
        gap = code.slice(trailingComment.end, node.start);
      }
      const before = gap.match(/^\s*/)?.[0] || "";
      cursor = node.end;
      instructions.push({ before, source: gap.slice(before.length) + code.slice(node.start, node.end) });
    }
    const trailing = code.slice(cursor, bodyEnd);
    let suffix = code.slice(bodyEnd);
    if (trailing.trim()) {
      if (instructions.length) instructions[instructions.length - 1].source += trailing;
      else instructions.push({ before: "", source: trailing });
    } else {
      suffix = trailing + suffix;
    }
    return { prefix, instructions, suffix, valid: true, framed: Boolean(frame) };
  } catch {
    return { prefix: "", instructions: code ? [{ before: "", source: code }] : [], suffix: "", valid: false };
  }
}

/** Expose one entry body's statements while keeping its surrounding source intact. */
function singleInstructionFrame(ast: Statement): Statement | null {
  const nodes = statementList(ast);
  const entries = nodes.flatMap(node => {
    const expression = node.type === "ExpressionStatement" ? node.expression as Statement : null;
    const call = expression?.type === "AwaitExpression" ? expression.argument as Statement : expression;
    if (call?.type !== "CallExpression") return [];
    const name = (target: Statement): string => target?.type === "Identifier" ? String(target.name)
      : target?.type === "MemberExpression" && !target.computed ? `${name(target.object as Statement)}.${name(target.property as Statement)}` : "";
    if (!/^(?:test|it)(?:\.(?:step|only|skip|fixme))?$/.test(name(call.callee as Statement))) return [];
    const callback = (call.arguments as Statement[] || []).at(-1);
    const body = callback && ["ArrowFunctionExpression", "FunctionExpression"].includes(callback.type) ? blockBody(callback) : null;
    return body ? [body] : [];
  });
  if (entries.length === 1) return entries[0];
  if (entries.length) return null;
  const declarations = nodes.filter(node => node.type !== "ImportDeclaration");
  if (declarations.length !== 1) return null;
  const entry = declarations[0].type === "ExportDefaultDeclaration" ? declarations[0].declaration as Statement : declarations[0];
  return ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(entry.type) ? blockBody(entry) : null;
}

function instructionsForTrailingComment(comments: Comment[], after: number, before: number, code: string) {
  return comments.find(comment => comment.type === "Line" && comment.start >= after && comment.end <= before
    && !/[\r\n]/.test(code.slice(after, comment.start)));
}

/** Apply an explicit instruction operation without changing the other statements' source. */
export function joinAutomationInstructions(document: AutomationInstructionDocument, instructions = document.instructions) {
  return document.prefix + instructions.map((instruction, index) => {
    const before = index > 0 && !/[\r\n]/.test(instruction.before) ? `\n${instruction.before}` : instruction.before;
    return before + instruction.source;
  }).join("") + document.suffix;
}

/** Add readable statement/block line breaks without reprinting JavaScript or rewriting literals. */
export function formatAutomationSourceLines(code: string): string {
  try {
    const { ast } = program(code);
    const breaks = new Map<number, number>();
    const add = (at: number, depth: number, after: number) => {
      if (!/[\r\n]/.test(code.slice(after, at))) breaks.set(at, depth);
    };
    const visit = (node: Statement, depth: number) => {
      if (node.type === "TemplateLiteral") return;
      const block = node.type === "BlockStatement" || node.type === "StaticBlock";
      const list = node.type === "Program" || block ? statementList(node) : null;
      if (list?.length) {
        list.forEach((statement, index) => {
          if (index || block) add(statement.start, depth + (block ? 1 : 0), index ? list[index - 1].end : node.start + 1);
        });
        if (block) add(node.end - 1, depth, list[list.length - 1].end);
      }
      for (const value of Object.values(node)) {
        for (const child of Array.isArray(value) ? value : [value]) {
          if (child && typeof child === "object" && "type" in child) visit(child as Statement, depth + (block ? 1 : 0));
        }
      }
    };
    visit(ast, 0);
    let formatted = code;
    for (const [at, depth] of [...breaks].sort(([left], [right]) => right - left)) formatted = formatted.slice(0, at) + `\n${"  ".repeat(depth)}` + formatted.slice(at);
    return formatted;
  } catch { return code; }
}
