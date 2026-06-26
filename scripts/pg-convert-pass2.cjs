#!/usr/bin/env node
"use strict";

/**
 * 第二轮转换：处理「分离 prepare」和「db.transaction()」模式
 *
 * 1. const stmt = db.prepare(SQL); stmt.run/all/get(params)
 *    → await execute/queryAll/queryOne(db, SQL, params)
 *    → 移除 const stmt = ... 声明
 *
 * 2. const run = db.transaction(() => { ... }); run();
 *    → await withTransaction(db, async (txDb) => { ... });
 *    → 事务体内 queryAll(db, → queryAll(txDb, 等
 *
 * 用法: node scripts/pg-convert-pass2.cjs <file.cjs> [--dry-run] [--write]
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
  console.error("用法: node scripts/pg-convert-pass2.cjs <file.cjs> [--dry-run] [--write]");
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

const manualItems = [];
function flagManual(node, reason) {
  const loc = node.loc ? `${node.loc.start.line}:${node.loc.start.column}` : "?";
  manualItems.push({ loc, reason });
}

const functionsToAsync = new Set();
function markParentAsync(path) {
  let p = path;
  while (p) {
    if (t.isFunctionDeclaration(p.node) || t.isFunctionExpression(p.node) ||
        t.isArrowFunctionExpression(p.node) || t.isObjectMethod(p.node) ||
        t.isClassMethod(p.node)) {
      functionsToAsync.add(p.node);
      return;
    }
    p = p.parentPath;
  }
}

// ═══════════════════════════════════════════════
// Pass 2a: 分离 prepare → 内联到调用点（作用域感知）
// ═══════════════════════════════════════════════

let stmtConvertedCount = 0;
let prepareRemovedCount = 0;

// 收集所有 prepare 声明，每个带独立 ID 避免同名覆盖
const prepareEntries = [];

traverse(ast, {
  VariableDeclarator(path) {
    const { node } = path;
    if (!node.init || !t.isCallExpression(node.init)) return;
    const call = node.init;
    if (!t.isMemberExpression(call.callee)) return;
    if (!t.isIdentifier(call.callee.property, { name: "prepare" })) return;
    if (!t.isIdentifier(node.id)) return;

    const dbObj = call.callee.object;
    let dbRefText;
    if (t.isIdentifier(dbObj)) {
      dbRefText = dbObj.name;
    } else if (t.isMemberExpression(dbObj) && t.isIdentifier(dbObj.property, { name: "db" })) {
      dbRefText = generate(dbObj).code;
    } else {
      return;
    }

    const sqlNode = call.arguments[0];
    if (!sqlNode) return;

    // 用 binding 找该变量的所有引用点
    const varName = node.id.name;
    const binding = path.scope.getBinding(varName);
    if (!binding) return;

    const refs = binding.referencePaths || [];
    let convertedForThis = 0;

    for (const refPath of refs) {
      // 引用应是 stmt.run/all/get(params) 中的 stmt
      const parent = refPath.parentPath;
      if (!parent || !t.isMemberExpression(parent.node)) continue;
      if (parent.node.object !== refPath.node) continue;

      const methodId = parent.node.property;
      if (!t.isIdentifier(methodId)) continue;
      const methodName = methodId.name;
      if (methodName !== "run" && methodName !== "all" && methodName !== "get") continue;

      const callPath = parent.parentPath;
      if (!callPath || !t.isCallExpression(callPath.node)) continue;
      if (callPath.node.callee !== parent.node) continue;

      const helperMap = { all: "queryAll", get: "queryOne", run: "execute" };
      const helperName = helperMap[methodName];

      const params = callPath.node.arguments;
      let paramsArg = null;
      if (params.length === 1 && t.isObjectExpression(params[0])) {
        paramsArg = params[0];
      } else if (params.length > 0) {
        paramsArg = t.arrayExpression(params);
      }

      let dbRef;
      try { dbRef = parser.parseExpression(dbRefText); } catch { dbRef = t.identifier("db"); }

      const callArgs = [dbRef, t.cloneNode(sqlNode)];
      if (paramsArg) callArgs.push(paramsArg);

      const newCall = t.awaitExpression(
        t.callExpression(t.identifier(helperName), callArgs)
      );

      callPath.replaceWith(newCall);
      markParentAsync(callPath);
      stmtConvertedCount++;
      convertedForThis++;
    }

    // 所有引用都已转换，移除声明
    if (convertedForThis > 0) {
      const declarationPath = path.parentPath;
      if (t.isVariableDeclaration(declarationPath.node) &&
          declarationPath.node.declarations.length === 1) {
        declarationPath.remove();
      } else {
        path.remove();
      }
      prepareRemovedCount++;
    }
  },
});

// 立刻应用 async 标记（在 pass2b 克隆前）
for (const fnNode of functionsToAsync) {
  if (!fnNode.async) fnNode.async = true;
}
functionsToAsync.clear();

// ═══════════════════════════════════════════════
// Pass 2b: db.transaction() → withTransaction()
// 使用 binding 解析 + 支持 IIFE 模式
// ═══════════════════════════════════════════════

let txConvertedCount = 0;

function extractDbRef(dbObj) {
  if (t.isIdentifier(dbObj)) return dbObj.name;
  if (t.isMemberExpression(dbObj) && t.isIdentifier(dbObj.property, { name: "db" })) {
    return generate(dbObj).code;
  }
  return null;
}

function buildWithTransaction(dbRefText, callback, invocationArgs, nodeForFlag) {
  if (!t.isFunctionExpression(callback) && !t.isArrowFunctionExpression(callback)) {
    flagManual(nodeForFlag, `transaction callback 不是函数表达式: ${generate(callback).code.slice(0, 50)}`);
    return null;
  }

  const cloned = t.cloneNode(callback, true);
  cloned.async = true;

  const existingParams = cloned.params || [];
  if (invocationArgs.length > 0 && existingParams.length > 0) {
    const body = cloned.body;
    if (t.isBlockStatement(body)) {
      for (let i = existingParams.length - 1; i >= 0; i--) {
        body.body.unshift(
          t.variableDeclaration("const", [
            t.variableDeclarator(existingParams[i], invocationArgs[i] || t.identifier("undefined"))
          ])
        );
      }
    }
  }
  cloned.params = [t.identifier("txDb")];

  let dbRef;
  try { dbRef = parser.parseExpression(dbRefText); } catch { dbRef = t.identifier("db"); }

  return t.awaitExpression(
    t.callExpression(t.identifier("withTransaction"), [dbRef, cloned])
  );
}

// 模式 A: const VARNAME = db.transaction(callback); ... VARNAME(args)
// 使用 binding 解析避免同名冲突
traverse(ast, {
  VariableDeclarator(path) {
    const { node } = path;
    if (!node.init || !t.isCallExpression(node.init)) return;
    const call = node.init;
    if (!t.isMemberExpression(call.callee)) return;
    if (!t.isIdentifier(call.callee.property, { name: "transaction" })) return;
    if (!t.isIdentifier(node.id)) return;
    if (!call.arguments[0]) return;

    const dbRefText = extractDbRef(call.callee.object);
    if (!dbRefText) return;

    const callback = call.arguments[0];
    const varName = node.id.name;
    const binding = path.scope.getBinding(varName);
    if (!binding) return;

    const refs = binding.referencePaths || [];
    let converted = 0;

    for (const refPath of refs) {
      // ref 应在 VARNAME() 或 VARNAME(args) 中
      const callPath = refPath.parentPath;
      if (!callPath || !t.isCallExpression(callPath.node)) continue;
      if (callPath.node.callee !== refPath.node) continue;

      const invocationArgs = callPath.node.arguments;
      const withTxCall = buildWithTransaction(dbRefText, callback, invocationArgs, callPath.node);
      if (!withTxCall) continue;

      // 判断上下文并替换
      const container = callPath.parentPath;
      if (t.isExpressionStatement(container.node)) {
        container.replaceWith(t.expressionStatement(withTxCall));
        markParentAsync(container);
      } else if (t.isReturnStatement(container.node)) {
        container.replaceWith(t.returnStatement(withTxCall));
        markParentAsync(container);
      } else if (t.isVariableDeclarator(container.node)) {
        const varDeclPath = container.parentPath;
        varDeclPath.replaceWith(
          t.variableDeclaration("const", [t.variableDeclarator(container.node.id, withTxCall)])
        );
        markParentAsync(varDeclPath);
      } else if (t.isAssignmentExpression(container.node)) {
        container.replaceWith(t.assignmentExpression("=", container.node.left, withTxCall));
        markParentAsync(container);
      } else {
        callPath.replaceWith(withTxCall);
        markParentAsync(callPath);
      }
      converted++;
      txConvertedCount++;
    }

    if (converted > 0) {
      const declarationPath = path.parentPath;
      if (t.isVariableDeclaration(declarationPath.node) &&
          declarationPath.node.declarations.length === 1) {
        try { declarationPath.remove(); } catch {}
      } else {
        try { path.remove(); } catch {}
      }
    }
  },
});

// 模式 B: IIFE — db.transaction(callback)() 或 db.transaction(callback)(args)
traverse(ast, {
  CallExpression(path) {
    const { node } = path;
    // 外层调用的 callee 是另一个 CallExpression (db.transaction(cb))
    if (!t.isCallExpression(node.callee)) return;
    const innerCall = node.callee;
    if (!t.isMemberExpression(innerCall.callee)) return;
    if (!t.isIdentifier(innerCall.callee.property, { name: "transaction" })) return;
    if (!innerCall.arguments[0]) return;

    const dbRefText = extractDbRef(innerCall.callee.object);
    if (!dbRefText) return;

    const callback = innerCall.arguments[0];
    const invocationArgs = node.arguments;
    const withTxCall = buildWithTransaction(dbRefText, callback, invocationArgs, node);
    if (!withTxCall) return;

    path.replaceWith(withTxCall);
    markParentAsync(path);
    txConvertedCount++;
  },
});

// ═══════════════════════════════════════════════
// Pass 2c: 事务体内 db → txDb 替换
// ═══════════════════════════════════════════════

let dbToTxDbCount = 0;

traverse(ast, {
  CallExpression(path) {
    const { node } = path;
    // 找 withTransaction(db, async (txDb) => { ... }) 调用
    if (!t.isIdentifier(node.callee, { name: "withTransaction" })) return;
    if (node.arguments.length < 2) return;

    const callback = node.arguments[1];
    if (!t.isFunctionExpression(callback) && !t.isArrowFunctionExpression(callback)) return;
    if (!callback.params[0] || !t.isIdentifier(callback.params[0], { name: "txDb" })) return;

    // 获取外层 db 引用名
    const dbArg = node.arguments[0];
    let dbName;
    if (t.isIdentifier(dbArg)) {
      dbName = dbArg.name;
    } else if (t.isMemberExpression(dbArg)) {
      dbName = generate(dbArg).code;
    } else {
      return;
    }

    // 遍历回调体，把 queryAll(db, ...) → queryAll(txDb, ...) 等
    const helpers = ["queryAll", "queryOne", "execute", "execSql", "tableHasColumn"];

    path.traverse({
      CallExpression(innerPath) {
        const inner = innerPath.node;
        if (!t.isIdentifier(inner.callee)) return;
        if (!helpers.includes(inner.callee.name)) return;
        if (inner.arguments.length < 1) return;

        const firstArg = inner.arguments[0];
        let matches = false;
        if (t.isIdentifier(firstArg) && firstArg.name === dbName) {
          matches = true;
        } else if (t.isMemberExpression(firstArg) && generate(firstArg).code === dbName) {
          matches = true;
        }

        if (matches) {
          inner.arguments[0] = t.identifier("txDb");
          dbToTxDbCount++;
        }
      },
    });
  },
});

// 给需要的函数加 async
for (const fnNode of functionsToAsync) {
  if (!fnNode.async) fnNode.async = true;
}

// 生成输出
const output = generate(ast, { retainLines: true, compact: false }, source);
let result = output.code;

// 确保 import withTransaction
if (txConvertedCount > 0 && /\bwithTransaction\b/.test(result) && !/withTransaction/.test(source.split("\n").slice(0, 10).join("\n"))) {
  // 在已有的 connection.cjs require 行中追加 withTransaction
  result = result.replace(
    /require\("([^"]*connection\.cjs)"\)/,
    (match) => {
      if (/withTransaction/.test(match)) return match;
      return match; // 不在这里改，留给手动
    }
  );
}

if (dryRun) {
  console.log(`=== ${filePath} ===`);
  console.log(`分离 prepare: ${stmtConvertedCount} 处转换, ${prepareRemovedCount} 处声明移除`);
  console.log(`transaction: ${txConvertedCount} 处转换`);
  console.log(`db→txDb: ${dbToTxDbCount} 处替换`);
  if (manualItems.length > 0) {
    console.log(`\n手动处理 (${manualItems.length} 处):`);
    for (const item of manualItems) {
      console.log(`  ${item.loc}: ${item.reason}`);
    }
  }
} else if (doWrite) {
  fs.writeFileSync(filePath, result, "utf-8");
  console.log(`已写入 ${filePath}`);
  console.log(`  prepare: ${stmtConvertedCount}, tx: ${txConvertedCount}, db→txDb: ${dbToTxDbCount}`);
  if (manualItems.length > 0) {
    console.error(`需手动处理 (${manualItems.length} 处):`);
    for (const item of manualItems) {
      console.error(`  ${item.loc}: ${item.reason}`);
    }
  }
} else {
  process.stdout.write(result);
}
