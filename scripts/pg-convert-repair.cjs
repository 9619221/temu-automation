#!/usr/bin/env node
"use strict";

/**
 * 修复 pass2b scope bug 产生的错误 withTransaction 调用。
 *
 * 问题：旧 pass2b 用 Map<varName> 存 transaction 声明，同名变量互相覆盖。
 * 结果：const tx = db.transaction(correct_callback) 没被删，
 *       tx(data) 被替换成 withTransaction(db, wrong_callback)。
 *
 * 修复逻辑：
 * 1. 找到仍存在的 const VAR = db.transaction(callback) 声明
 * 2. 在同一函数内找紧随的 await withTransaction(db, async (txDb) => { const P = ARG; ...wrong... })
 * 3. 用原始 callback 替换 wrong callback，把 ARG 注入回调体
 * 4. 删除 db.transaction 声明
 *
 * 用法: node scripts/pg-convert-repair.cjs <file> [--dry-run|--write]
 */

const fs = require("fs");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const t = require("@babel/types");
const generate = require("@babel/generator").default;

const filePath = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const doWrite = process.argv.includes("--write");

if (!filePath) {
  console.error("用法: node scripts/pg-convert-repair.cjs <file> [--dry-run|--write]");
  process.exit(1);
}

const source = fs.readFileSync(filePath, "utf-8");

let ast;
try {
  ast = parser.parse(source, {
    sourceType: "script",
    plugins: ["dynamicImport"],
    allowReturnOutsideFunction: true,
  });
} catch (e) {
  console.error(`解析失败: ${e.message}`);
  process.exit(1);
}

let repairedCount = 0;

traverse(ast, {
  VariableDeclarator(path) {
    const { node } = path;
    if (!node.init || !t.isCallExpression(node.init)) return;
    const call = node.init;
    if (!t.isMemberExpression(call.callee)) return;
    if (!t.isIdentifier(call.callee.property, { name: "transaction" })) return;
    if (!t.isIdentifier(node.id)) return;
    if (!call.arguments[0]) return;

    const dbObj = call.callee.object;
    let dbRefText;
    if (t.isIdentifier(dbObj)) {
      dbRefText = dbObj.name;
    } else if (t.isMemberExpression(dbObj) && t.isIdentifier(dbObj.property, { name: "db" })) {
      dbRefText = generate(dbObj).code;
    } else {
      return;
    }

    const correctCallback = call.arguments[0];
    const varName = node.id.name;
    const binding = path.scope.getBinding(varName);

    // 如果变量还有引用（tx(data) 没被替换），跳过
    if (binding && binding.referencePaths && binding.referencePaths.length > 0) return;

    // 找同一函数体内的下一个 withTransaction 调用
    const declarationPath = path.parentPath;
    const containerBody = declarationPath.parentPath;
    if (!containerBody || !containerBody.node || !Array.isArray(containerBody.node.body || containerBody.node)) return;
    const siblings = containerBody.node.body || containerBody.node;
    const declIdx = siblings.indexOf(declarationPath.node);
    if (declIdx === -1) return;

    // 搜索后续语句中的 withTransaction
    let wrongStmtPath = null;
    let wrongCallNode = null;
    let extractedArg = null;

    for (let i = declIdx + 1; i < siblings.length; i++) {
      const stmt = siblings[i];
      let awaitExpr = null;

      if (t.isExpressionStatement(stmt)) {
        if (t.isAwaitExpression(stmt.expression)) {
          awaitExpr = stmt.expression;
        } else if (t.isAssignmentExpression(stmt.expression) && t.isAwaitExpression(stmt.expression.right)) {
          awaitExpr = stmt.expression.right;
        }
      } else if (t.isReturnStatement(stmt) && stmt.argument && t.isAwaitExpression(stmt.argument)) {
        awaitExpr = stmt.argument;
      } else if (t.isVariableDeclaration(stmt) && stmt.declarations.length === 1) {
        const vd = stmt.declarations[0];
        if (vd.init && t.isAwaitExpression(vd.init)) {
          awaitExpr = vd.init;
        }
      }
      if (!awaitExpr) continue;

      const callExpr = awaitExpr.argument;
      if (!t.isCallExpression(callExpr)) continue;
      if (!t.isIdentifier(callExpr.callee, { name: "withTransaction" })) continue;

      const wrongCallback = callExpr.arguments[1];
      if (!wrongCallback) continue;
      if (!t.isFunctionExpression(wrongCallback) && !t.isArrowFunctionExpression(wrongCallback)) continue;

      // 检查回调体第一条是否是 const PARAM = ARG（旧 pass2b 的标记）
      const body = wrongCallback.body;
      if (t.isBlockStatement(body) && body.body.length > 0) {
        const first = body.body[0];
        if (t.isVariableDeclaration(first) && first.declarations.length === 1) {
          const decl = first.declarations[0];
          if (decl.init) {
            extractedArg = decl.init;
          }
        }
      }

      wrongStmtPath = containerBody.get("body." + i);
      wrongCallNode = callExpr;
      break;
    }

    if (!wrongStmtPath || !wrongCallNode) return;

    // 构建正确的 withTransaction：用原始 callback
    const cloned = t.cloneNode(correctCallback, true);
    cloned.async = true;

    const existingParams = cloned.params || [];

    // 把 extractedArg 注入回调体开头
    if (extractedArg && existingParams.length > 0) {
      const body = cloned.body;
      if (t.isBlockStatement(body)) {
        for (let i = existingParams.length - 1; i >= 0; i--) {
          const arg = i === 0 && extractedArg ? extractedArg : t.identifier("undefined");
          body.body.unshift(
            t.variableDeclaration("const", [t.variableDeclarator(existingParams[i], arg)])
          );
        }
      }
    }
    cloned.params = [t.identifier("txDb")];

    // 替换 wrong withTransaction 的 callback
    wrongCallNode.arguments[1] = cloned;

    // 同时修正回调体内的 db→txDb（手动递归遍历，不用 traverse 以避免 scope 问题）
    const helpers = new Set(["queryAll", "queryOne", "execute", "execSql", "tableHasColumn"]);
    function fixDbRefs(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(fixDbRefs); return; }
      if (t.isCallExpression(node) && t.isIdentifier(node.callee) && helpers.has(node.callee.name) && node.arguments.length >= 1) {
        const firstArg = node.arguments[0];
        if (t.isIdentifier(firstArg) && firstArg.name === dbRefText) {
          node.arguments[0] = t.identifier("txDb");
        }
      }
      for (const key of t.VISITOR_KEYS[node.type] || []) {
        fixDbRefs(node[key]);
      }
    }
    fixDbRefs(cloned.body);

    // 删除 const tx = db.transaction(...) 声明
    if (t.isVariableDeclaration(declarationPath.node) &&
        declarationPath.node.declarations.length === 1) {
      declarationPath.remove();
    } else {
      path.remove();
    }

    repairedCount++;
  },
});

const output = generate(ast, { retainLines: true, compact: false }, source);

if (dryRun) {
  console.log(`=== ${filePath} ===`);
  console.log(`修复: ${repairedCount} 处`);
} else if (doWrite) {
  fs.writeFileSync(filePath, output.code, "utf-8");
  console.log(`已写入 ${filePath} — 修复: ${repairedCount} 处`);
} else {
  process.stdout.write(output.code);
}
