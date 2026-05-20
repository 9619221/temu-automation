/* 一次性调研 2:plugin.json 富字段 + executor.py + robot.code 头部(只读) */
const fs = require("fs");
const path = require("path");

const root = path.join(process.env.APPDATA, "droplet-client");
const ppRoot = path.join(root, "pluginPackages");

for (const dir of fs.readdirSync(ppRoot)) {
  const inner = path.join(ppRoot, dir, dir);
  const pj = path.join(inner, "plugin.json");
  if (!fs.existsSync(pj)) continue;
  const j = JSON.parse(fs.readFileSync(pj, "utf8"));
  console.log(`\n================ ${j.name} (${dir}) v${j.version} ================`);
  console.log("type:", j.type, "| browser_type:", j.browser_type, "| main:", j.main, "| language:", j.language);
  console.log("dependencies:", JSON.stringify(j.dependencies));
  console.log("account_exec_timeout:", j.account_exec_timeout, "| platform_type:", j.platform_type);
  console.log("--- kargs_list (运行入参) ---");
  console.log(JSON.stringify(j.kargs_list, null, 2));
  console.log("--- header ---");
  console.log(JSON.stringify(j.header, null, 2));
  console.log("--- framework_template ---");
  console.log(typeof j.framework_template === "string" ? j.framework_template.slice(0, 800) : JSON.stringify(j.framework_template).slice(0, 800));
  console.log("--- plugin_result_readme (产出说明) ---");
  console.log(String(j.plugin_result_readme || "").slice(0, 1500));
  console.log("--- plugin_readme ---");
  console.log(String(j.plugin_readme || j.readmeContent || "").slice(0, 1200));
  const ex = path.join(inner, "executor.py");
  if (fs.existsSync(ex)) {
    console.log("--- executor.py ---");
    console.log(fs.readFileSync(ex, "utf8"));
  }
  const rc = path.join(inner, "robot.code");
  if (fs.existsSync(rc)) {
    const buf = fs.readFileSync(rc);
    const head = buf.slice(0, 64);
    console.log(`--- robot.code 头部 (${buf.length}B) hex: ${head.toString("hex").slice(0, 96)}`);
    console.log("    ascii:", JSON.stringify(head.toString("latin1").replace(/[^\x20-\x7e]/g, ".")));
  }
}
