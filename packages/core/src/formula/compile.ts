import jsep from "jsep";
import { HELPER_NAMES } from "./helpers.ts";

export interface FormulaNode {
  type: string;
  [k: string]: unknown;
}

export interface CompiledFormula {
  ast: FormulaNode;
  refs: string[];
}

export class FormulaError extends Error {}

export const BINARY_OPERATORS: ReadonlySet<string> = new Set([
  "+", "-", "*", "/", "%", "==", "!=", "===", "!==", "<", ">", "<=", ">=", "&&", "||",
]);
export const UNARY_OPERATORS: ReadonlySet<string> = new Set(["-", "+", "!"]);

export const MAX_FORMULA_LENGTH = 2000;

export function compileFormula(source: string): CompiledFormula {
  if (source.length > MAX_FORMULA_LENGTH) {
    throw new FormulaError(`Formula is too long (max ${MAX_FORMULA_LENGTH} characters)`);
  }
  let ast: FormulaNode;
  const refs: string[] = [];
  try {
    ast = jsep(source) as unknown as FormulaNode;
    check(ast, refs);
  } catch (e) {
    // Deeply nested input exhausts the call stack in jsep or check; report it as a formula error.
    if (e instanceof RangeError) throw new FormulaError("Formula is too deeply nested");
    if (e instanceof FormulaError) throw e;
    throw new FormulaError((e as Error).message);
  }
  return { ast, refs };
}

function addRef(refs: string[], name: string) {
  if (!refs.includes(name)) refs.push(name);
}

function rootName(node: FormulaNode): string {
  let cur = node;
  while (cur.type === "MemberExpression") {
    if (cur.computed) throw new FormulaError("Computed property access (a[b]) is not allowed");
    const prop = cur.property as FormulaNode;
    if (prop.type !== "Identifier") throw new FormulaError("Only plain property names are allowed after '.'");
    cur = cur.object as FormulaNode;
  }
  if (cur.type !== "Identifier") throw new FormulaError(`Unsupported syntax: ${cur.type}`);
  return cur.name as string;
}

function check(node: FormulaNode, refs: string[]): void {
  switch (node.type) {
    case "Literal":
      return;
    case "Identifier":
      addRef(refs, node.name as string);
      return;
    case "MemberExpression":
      addRef(refs, rootName(node));
      return;
    case "UnaryExpression":
      if (!UNARY_OPERATORS.has(node.operator as string)) throw new FormulaError(`Operator not allowed: ${String(node.operator)}`);
      check(node.argument as FormulaNode, refs);
      return;
    case "BinaryExpression":
      if (!BINARY_OPERATORS.has(node.operator as string)) throw new FormulaError(`Operator not allowed: ${String(node.operator)}`);
      check(node.left as FormulaNode, refs);
      check(node.right as FormulaNode, refs);
      return;
    case "CallExpression": {
      const callee = node.callee as FormulaNode;
      if (callee.type !== "Identifier") throw new FormulaError("Only helper functions can be called, e.g. lower(x)");
      const name = callee.name as string;
      if (!HELPER_NAMES.has(name)) {
        throw new FormulaError(`Unknown function: ${name}. Available: ${[...HELPER_NAMES].join(", ")}`);
      }
      for (const arg of node.arguments as FormulaNode[]) check(arg, refs);
      return;
    }
    default:
      throw new FormulaError(`Unsupported syntax: ${node.type}`);
  }
}
