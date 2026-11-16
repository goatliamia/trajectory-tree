// 用 TypeScript 语法树复算圈复杂度。
//
// 口径与 Code Relations 的 ts-metrics 一致：每个函数或方法以 1 为基线，
// 加显式判定（if、for、for-in、for-of、while、do、catch、三目）、逻辑运算
// （&&、||、??、对应的赋值形式）、可选链，以及带初值的参数和绑定初值。
// 嵌套函数单独计算，不并入外层。
//
// 一致性由 test/complexity/engine-baseline.json 核对：该文件是引擎对
// test/complexity/fixtures 的逐单元输出，scripts/code-status.mjs 每次生成前
// 会复算并比对。

import { readFileSync } from 'node:fs';

const LOGICAL = ['AmpersandAmpersandToken', 'BarBarToken', 'QuestionQuestionToken',
  'AmpersandAmpersandEqualsToken', 'BarBarEqualsToken', 'QuestionQuestionEqualsToken'];

export function createCounter(ts) {
  const logicalKinds = new Set(LOGICAL.map((name) => ts.SyntaxKind[name]));

  const isDecision = (node) => (
    ts.isIfStatement(node)
    || ts.isForStatement(node)
    || ts.isForInStatement(node)
    || ts.isForOfStatement(node)
    || ts.isWhileStatement(node)
    || ts.isDoStatement(node)
    || ts.isCatchClause(node)
    || ts.isCaseClause(node)
    || ts.isConditionalExpression(node)
    || ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && Boolean(node.questionDotToken))
    || (ts.isCallExpression(node) && Boolean(node.questionDotToken))
    || (ts.isBinaryExpression(node) && logicalKinds.has(node.operatorToken.kind))
  );

  const bindingInitializers = (pattern) => {
    let count = 0;
    const visit = (node) => {
      if (ts.isBindingElement(node) && node.initializer) count += 1;
      ts.forEachChild(node, visit);
    };
    visit(pattern);
    return count;
  };

  const count = (fn) => {
    let total = 1;
    for (const parameter of fn.parameters) {
      if (parameter.initializer) total += 1;
      total += bindingInitializers(parameter.name);
    }
    const body = fn.body;
    const visit = (node) => {
      if (ts.isFunctionLike(node)) return;
      if (isDecision(node)) total += 1;
      ts.forEachChild(node, visit);
    };
    if (!ts.isBlock(body)) {
      if (isDecision(body)) total += 1;
      ts.forEachChild(body, visit);
    } else {
      ts.forEachChild(body, visit);
    }
    return total;
  };

  return { count };
}

export function measureFile(ts, repo, relativePath) {
  const text = readFileSync(`${repo}/${relativePath}`, 'utf8');
  const source = ts.createSourceFile(relativePath, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const counter = createCounter(ts);

  const nameOf = (node) => {
    const own = node.name?.getText(source);
    if (own) return own;
    const parent = node.parent;
    if (parent && (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent))) {
      const name = parent.name?.getText(source);
      if (name) return name;
    }
    return '<匿名>';
  };

  const units = [];
  const visit = (node) => {
    if (ts.isFunctionLike(node) && node.body) {
      const start = node.getStart(source);
      const line = source.getLineAndCharacterOfPosition(start).line + 1;
      const end = node.getEnd();
      const endLine = source.getLineAndCharacterOfPosition(end).line + 1;
      units.push({
        file: relativePath,
        name: nameOf(node),
        start,
        line,
        cyclomatic: counter.count(node),
        lines: Math.max(1, endLine - line + 1),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return units;
}
