#!/usr/bin/env node
"use strict";

/**
 * SQLite → PG 调用点自动转换脚本
 * 用法: node scripts/pg-convert.cjs <file.cjs> [--dry-run] [--write]
 *
 * 处理的模式:
 *   db.prepare(SQL).all(PARAMS)  →  await queryAll(db, SQL, PARAMS_ARRAY_OR_OBJ)
 *   db.prepare(SQL).get(PARAMS)  →  await queryOne(db, SQL, ...)
 *   db.prepare(SQL).run(PARAMS)  →  await execute(db, SQL, ...)
 *   db.exec(SQL)                 →  await execSql(db, SQL)
 *
 * 不自动处理（输出到 stderr 供手动处理）:
 *   - db.transaction(fn)()
 *   - const stmt = db.prepare(SQL); stmt.xxx() (separated prepare)
 *   - stmt.iterate()
 *   - PRAGMA 语句
 *   - INSERT OR REPLACE
 *   - sqlite_master
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
  console.error("用法: node scripts/pg-convert.cjs <file.cjs> [--dry-run] [--write]");
  process.exit(1);
}

const source = fs.readFileSync(filePath, "utf-8");

// 收集需要手动处理的位置
const manualItems = [];
function flagManual(node, reason) {
  const loc = node.loc ? `${node.loc.start.line}:${node.loc.start.column}` : "?";
  manualItems.push({ loc, reason });
}

// 解析 AST
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

// 判断参数是否是对象字面量（命名参数）
function isObjectParam(args) {
  return args.length === 1 && t.isObjectExpression(args[0]);
}

// 构建参数节点: 对象传对象，多个参数传数组
function buildParamsArg(args) {
  if (args.length === 0) return null;
  if (isObjectParam(args)) return args[0]; // 命名参数，直接传对象
  if (args.length === 1 && t.isSpreadElement(args[0])) {
    return t.arrayExpression(args);
  }
  return t.arrayExpression(args);
}

// 收集需要变 async 的函数节点
const functionsToAsync = new Set();

// 标记一个节点的最近 function 父级为 async
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

// 统计
let convertedCount = 0;
let execConvertedCount = 0;

// 遍历 AST
traverse(ast, {
  CallExpression(path) {
    const { node } = path;

    // 模式: db.exec(SQL) / this.db.exec(SQL)
    if (t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.property, { name: "exec" }) &&
        node.arguments.length >= 1) {
      const obj = node.callee.object;
      let dbRef = null;
      if (t.isIdentifier(obj) && (obj.name === "db" || obj.name === "txDb")) {
        dbRef = t.identifier(obj.name);
      } else if (t.isMemberExpression(obj) && t.isIdentifier(obj.property, { name: "db" })) {
        dbRef = t.memberExpression(obj.object, t.identifier("db"));
      }
      if (dbRef) {
        const sqlArg = node.arguments[0];
        path.replaceWith(
          t.awaitExpression(
            t.callExpression(t.identifier("execSql"), [dbRef, sqlArg])
          )
        );
        markParentAsync(path);
        execConvertedCount++;
        return;
      }
    }

    // 模式: db.prepare(SQL).all/get/run(PARAMS)
    // AST 结构: CallExpression { callee: MemberExpression { object: CallExpression { callee: MemberExpression { object: db, property: prepare } }, property: all/get/run } }
    if (!t.isMemberExpression(node.callee)) return;
    const method = node.callee.property;
    if (!t.isIdentifier(method)) return;
    const methodName = method.name;
    if (methodName !== "all" && methodName !== "get" && methodName !== "run") return;

    const prepareCall = node.callee.object;
    if (!t.isCallExpression(prepareCall)) return;
    if (!t.isMemberExpression(prepareCall.callee)) return;

    const prepareMethod = prepareCall.callee.property;
    if (!t.isIdentifier(prepareMethod, { name: "prepare" })) return;

    const dbNode = prepareCall.callee.object;

    // 支持 db.prepare / txDb.prepare / this.db.prepare / self.db.prepare
    let dbRef;
    if (t.isIdentifier(dbNode)) {
      dbRef = t.identifier(dbNode.name);
    } else if (t.isMemberExpression(dbNode) && t.isIdentifier(dbNode.property, { name: "db" })) {
      dbRef = t.memberExpression(dbNode.object, t.identifier("db"));
    } else {
      return; // 不认识的对象，跳过
    }

    // 检查 SQL 中的特殊模式
    const sqlArg = prepareCall.arguments[0];
    let sqlText = "";
    if (t.isStringLiteral(sqlArg)) {
      sqlText = sqlArg.value;
    } else if (t.isTemplateLiteral(sqlArg)) {
      sqlText = sqlArg.quasis.map((q) => q.value.raw).join("???");
    }

    // 标记需要手动处理的
    if (/PRAGMA\s/i.test(sqlText)) {
      flagManual(node, `PRAGMA 语句 → 需改用 tableHasColumn() 或 PG information_schema`);
    }
    if (/INSERT\s+OR\s+REPLACE/i.test(sqlText)) {
      flagManual(node, `INSERT OR REPLACE → 需手动改为 ON CONFLICT DO UPDATE`);
    }
    if (/INSERT\s+OR\s+IGNORE/i.test(sqlText)) {
      flagManual(node, `INSERT OR IGNORE → 需在末尾加 ON CONFLICT DO NOTHING`);
    }
    if (/sqlite_master/i.test(sqlText)) {
      flagManual(node, `sqlite_master → 需改用 PG 的 information_schema.tables`);
    }

    // 确定目标函数名
    const helperMap = { all: "queryAll", get: "queryOne", run: "execute" };
    const helperName = helperMap[methodName];

    // 构建参数
    const params = node.arguments;
    const paramsArg = buildParamsArg(params);

    // 构建: await helperName(db, SQL, params?)
    const callArgs = [dbRef, sqlArg];
    if (paramsArg) callArgs.push(paramsArg);

    const newCall = t.awaitExpression(
      t.callExpression(t.identifier(helperName), callArgs)
    );

    path.replaceWith(newCall);
    markParentAsync(path);
    convertedCount++;
  },
});

// 标记 transaction 和 iterate 需要手动处理
traverse(ast, {
  CallExpression(path) {
    const { node } = path;
    // db.transaction(fn) 或 db.transaction(fn)()
    if (t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.property, { name: "transaction" })) {
      flagManual(node, `db.transaction() → 需手动改为 await withTransaction(db, async (txDb) => {...})`);
    }
    // stmt.iterate()
    if (t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.property, { name: "iterate" })) {
      flagManual(node, `stmt.iterate() → 需改为 queryAll() 后遍历数组`);
    }
  },
});

// 给需要的函数加 async
for (const fnNode of functionsToAsync) {
  if (!fnNode.async) {
    fnNode.async = true;
  }
}

// 生成代码
const output = generate(ast, {
  retainLines: true,
  compact: false,
}, source);

// 在文件顶部添加 import（如果有转换）
let result = output.code;
if (convertedCount > 0 || execConvertedCount > 0) {
  // 检查是否已有 import
  const helpers = [];
  if (/\bqueryAll\b/.test(result)) helpers.push("queryAll");
  if (/\bqueryOne\b/.test(result)) helpers.push("queryOne");
  if (/\bexecute\b/.test(result) && !/function execute/.test(result)) helpers.push("execute");
  if (/\bexecSql\b/.test(result)) helpers.push("execSql");
  if (/\bwithTransaction\b/.test(result)) helpers.push("withTransaction");
  if (/\btableHasColumn\b/.test(result)) helpers.push("tableHasColumn");

  if (helpers.length > 0) {
    // 计算相对路径
    const path = require("path");
    const fileDir = path.dirname(path.resolve(filePath));
    const connPath = path.resolve(__dirname, "../electron/db/connection.cjs");
    let relPath = path.relative(fileDir, connPath).replace(/\\/g, "/");
    if (!relPath.startsWith(".")) relPath = "./" + relPath;

    const importLine = `const { ${helpers.join(", ")} } = require("${relPath}");\n`;

    // 检查是否已存在 connection.cjs 的 require
    if (!result.includes("connection.cjs")) {
      // 在第一个 require 之后或文件顶部插入
      const firstRequire = result.indexOf("require(");
      if (firstRequire > 0) {
        // 找到这行的末尾
        const lineEnd = result.indexOf("\n", firstRequire);
        // 找到所有连续 require 行的末尾
        let insertPos = lineEnd + 1;
        result = result.slice(0, insertPos) + importLine + result.slice(insertPos);
      } else {
        result = importLine + result;
      }
    }
  }
}

// 输出结果
if (dryRun) {
  console.log(`=== ${filePath} ===`);
  console.log(`转换: ${convertedCount} 个 prepare 调用, ${execConvertedCount} 个 exec 调用`);
  console.log(`需加 async: ${functionsToAsync.size} 个函数`);
  if (manualItems.length > 0) {
    console.log(`\n手动处理 (${manualItems.length} 处):`);
    for (const item of manualItems) {
      console.log(`  ${item.loc}: ${item.reason}`);
    }
  }
} else if (doWrite) {
  fs.writeFileSync(filePath, result, "utf-8");
  console.log(`已写入 ${filePath}`);
  console.log(`  转换: ${convertedCount} + ${execConvertedCount} 处`);
  console.log(`  async: ${functionsToAsync.size} 个函数`);
  if (manualItems.length > 0) {
    console.error(`\n需手动处理 (${manualItems.length} 处):`);
    for (const item of manualItems) {
      console.error(`  ${item.loc}: ${item.reason}`);
    }
  }
} else {
  process.stdout.write(result);
}
