/* 一次性调研:读出聚协云插件元数据与本地库结构(只读) */
const fs = require("fs");
const path = require("path");
const D = require("better-sqlite3");

const root = path.join(process.env.APPDATA, "droplet-client");
const ppRoot = path.join(root, "pluginPackages");

console.log("==== 插件元数据 (plugin.json) ====");
for (const dir of fs.readdirSync(ppRoot)) {
  const inner = path.join(ppRoot, dir, dir);
  const pj = path.join(inner, "plugin.json");
  if (!fs.existsSync(pj)) continue;
  try {
    const j = JSON.parse(fs.readFileSync(pj, "utf8"));
    const pick = (o, ks) => ks.reduce((a, k) => (o[k] !== undefined ? ((a[k] = o[k]), a) : a), {});
    console.log(`\n--- ${dir} ---`);
    console.log(JSON.stringify(pick(j, [
      "id", "plugin_id", "name", "title", "desc", "description",
      "version", "type", "category", "entry", "platform", "url", "tags",
    ]), null, 2));
    const extra = Object.keys(j).filter((k) => !["id","plugin_id","name","title","desc","description","version","type","category","entry","platform","url","tags"].includes(k));
    if (extra.length) console.log("其它字段:", extra.join(", "));
  } catch (e) {
    console.log(dir, "plugin.json 解析失败:", e.message);
  }
}

function dump(label, file) {
  console.log(`\n==== ${label} (${file}) ====`);
  try {
    const db = new D(file, { readonly: true, fileMustExist: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    for (const t of tables) {
      const cnt = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
      const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
      console.log(`  表 ${t} 行数=${cnt} 列=[${cols.join(", ")}]`);
      if (cnt > 0) {
        const sample = db.prepare(`SELECT * FROM "${t}" LIMIT 1`).get();
        console.log(`    样本: ${JSON.stringify(sample).slice(0, 600)}`);
      }
    }
    db.close();
  } catch (e) {
    console.log("  打不开:", e.message);
  }
}

dump("主库 data.db", path.join(root, "data.db"));
dump("plugin.db", path.join(root, "droplet", "plugin.db"));
dump("RPA 调度库", path.join(root, "db", "plugin_db_rpa_schedule.db"));
for (const dir of fs.readdirSync(ppRoot)) {
  const inner = path.join(ppRoot, dir, dir);
  for (const f of ["tasks.db", "cache.db"]) {
    const fp = path.join(inner, f);
    if (fs.existsSync(fp)) dump(`插件 ${dir} / ${f}`, fp);
  }
}
