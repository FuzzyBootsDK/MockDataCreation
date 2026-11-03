import type { Row } from "../model.ts";
import type { FormulaNode } from "./compile.ts";
import { FormulaRuntimeError, HELPERS, capText, toNumber } from "./helpers.ts";

export { FormulaRuntimeError } from "./helpers.ts";

function lookup(obj: unknown, key: string): unknown {
  if (obj == null || typeof obj !== "object") return null;
  return Object.hasOwn(obj, key) ? ((obj as Row)[key] ?? null) : null;
}

function arithmetic(op: string, l: unknown, r: unknown): unknown {
  if (l == null || r == null) return null;
  const a = toNumber(l);
  const b = toNumber(r);
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/":
      if (b === 0) throw new FormulaRuntimeError("Division by zero");
      return a / b;
    case "%":
      if (b === 0) throw new FormulaRuntimeError("Division by zero");
      return a % b;
  }
  throw new FormulaRuntimeError(`Operator not allowed: ${op}`);
}

function binary(op: string, l: unknown, r: unknown): unknown {
  switch (op) {
    case "+":
      if (typeof l === "string" || typeof r === "string") return capText((l == null ? "" : String(l)) + (r == null ? "" : String(r)));
      return arithmetic(op, l, r);
    case "-": case "*": case "/": case "%":
      return arithmetic(op, l, r);
    case "==": case "===": return l === r;
    case "!=": case "!==": return l !== r;
    case "<": return (l as number) < (r as number);
    case ">": return (l as number) > (r as number);
    case "<=": return (l as number) <= (r as number);
    case ">=": return (l as number) >= (r as number);
  }
  throw new FormulaRuntimeError(`Operator not allowed: ${op}`);
}

export function evaluateFormula(node: FormulaNode, scope: Row): unknown {
  switch (node.type) {
    case "Literal":
      return node.value;
    case "Identifier":
      return lookup(scope, node.name as string);
    case "MemberExpression":
      return lookup(evaluateFormula(node.object as FormulaNode, scope), (node.property as FormulaNode).name as string);
    case "UnaryExpression": {
      const v = evaluateFormula(node.argument as FormulaNode, scope);
      if (node.operator === "!") return !v;
      if (v == null) return null;
      return node.operator === "-" ? -toNumber(v) : toNumber(v);
    }
    case "BinaryExpression": {
      const op = node.operator as string;
      const left = evaluateFormula(node.left as FormulaNode, scope);
      if (op === "&&") return left ? evaluateFormula(node.right as FormulaNode, scope) : left;
      if (op === "||") return left ? left : evaluateFormula(node.right as FormulaNode, scope);
      return binary(op, left, evaluateFormula(node.right as FormulaNode, scope));
    }
    case "CallExpression": {
      const name = (node.callee as FormulaNode).name as string;
      if (typeof name !== "string" || !Object.hasOwn(HELPERS, name)) throw new FormulaRuntimeError("Unknown function");
      const args = node.arguments as FormulaNode[];
      if (name === "if") {
        // Lazy: only the chosen branch is evaluated; a missing branch yields null.
        const [condNode, thenNode, elseNode] = args;
        const cond = condNode ? evaluateFormula(condNode, scope) : null;
        const chosen = cond ? thenNode : elseNode;
        return chosen ? evaluateFormula(chosen, scope) : null;
      }
      return HELPERS[name](...args.map((a) => evaluateFormula(a, scope)));
    }
  }
  throw new FormulaRuntimeError(`Unsupported syntax: ${node.type}`);
}
