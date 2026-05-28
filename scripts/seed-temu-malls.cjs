#!/usr/bin/env node
// 灌入 33 条 TEMU 店铺对照（30 有效 + 1 待确认 + 2 测试）
// 用法：
//   开发机：node scripts/seed-temu-malls.cjs
//   服务器：ELECTRON_RUN_AS_NODE=1 node scripts/seed-temu-malls.cjs --data-dir=/opt/temu-erp-data

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2).reduce((acc, arg) => {
  const m = arg.match(/^--([^=]+)=(.*)$/);
  if (m) acc[m[1]] = m[2];
  return acc;
}, {});

const dataDir = args['data-dir']
  || process.env.ERP_DATA_DIR
  || path.join(process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'), 'temu-automation', 'data');
const dbPath = path.join(dataDir, 'erp.sqlite');

if (!fs.existsSync(dbPath)) {
  console.error(`erp.sqlite 不存在：${dbPath}`);
  console.error('用 --data-dir=<目录> 指定，或确保桌面端跑过一次（migrate.cjs 会自动建库）');
  process.exit(1);
}

const Database = require('better-sqlite3');
const db = new Database(dbPath);

const MALLS = [
  // 30 家有效店（store_code = 内部三位数编号，按事件量序号#1-#31 排序，跳过#25 black good boy）
  { store_code: '028', mall_id: '634418224981125', mall_name: 'Lumen Global' },
  { store_code: '029', mall_id: '634418224983097', mall_name: 'Oasis Originals' },
  { store_code: '030', mall_id: '634418224983548', mall_name: 'Crafted Horizon' },
  { store_code: '031', mall_id: '634418225054807', mall_name: 'Treadmore' },
  { store_code: '032', mall_id: '634418225055378', mall_name: 'Cloud Crumble' },
  { store_code: '035', mall_id: '634418225083598', mall_name: 'Parcel Passport' },
  { store_code: '037', mall_id: '634418225372884', mall_name: 'Crystal Stream' },
  { store_code: '038', mall_id: '634418225373734', mall_name: 'Pure Bloom' },
  { store_code: '040', mall_id: '634418225440775', mall_name: 'ParcelJoy Treasures' },
  { store_code: '042', mall_id: '634418225514990', mall_name: 'Borderless Finds Treasures' },
  { store_code: '044', mall_id: '634418226016579', mall_name: 'Luminance Guiding Global Exchanges' },
  { store_code: '045', mall_id: '634418226017029', mall_name: 'PanGlobal Fine Finds' },
  { store_code: '046', mall_id: '634418226016823', mall_name: 'Radiance Linking' },
  { store_code: '047', mall_id: '634418226025690', mall_name: 'Every Corner of Life' },
  { store_code: '048', mall_id: '634418226026279', mall_name: 'We Bring Them All' },
  { store_code: '049', mall_id: '634418226026528', mall_name: 'Across Oceans Borders' },
  { store_code: '050', mall_id: '634418226026966', mall_name: 'Border Pick Me' },
  { store_code: '051', mall_id: '634418226026828', mall_name: 'Cozy Nook Grocery' },
  { store_code: '052', mall_id: '634418226026300', mall_name: 'Tiny Things Mart' },
  { store_code: '053', mall_id: '634418226025563', mall_name: 'Wild Bloom Mart' },
  { store_code: '054', mall_id: '634418226041962', mall_name: 'Global Dash Mart' },
  { store_code: '062', mall_id: '634418226219194', mall_name: 'Borderless Mart Box' },
  { store_code: '065', mall_id: '634418225172002', mall_name: 'Breeze Cargo' },
  { store_code: '067', mall_id: '634418225262761', mall_name: 'FixMaster Collection' },
  { store_code: '071', mall_id: '634418227770823', mall_name: 'Crafted to Perfection' },
  { store_code: '072', mall_id: '634418227770845', mall_name: 'Whimsical Wonders for Creative Living' },
  { store_code: '074', mall_id: '634418228924499', mall_name: 'OpalStyle' },
  { store_code: '075', mall_id: '634418229097960', mall_name: 'Monvique Novique' },
  { store_code: '076', mall_id: '634418227640222', mall_name: 'Quality Finds From Around the Globe' },
  { store_code: '077', mall_id: '634418230546312', mall_name: 'logo settle' },
  // 测试 / 待确认 —— status='test' 时报表默认过滤
  { store_code: null,  mall_id: '634418229252958', mall_name: 'black good boy',           status: 'test', remark: '用户标定时跳过、待确认' },
  { store_code: null,  mall_id: 'MALL-EXT-E2E',    mall_name: 'Codex Extension E2E Store', status: 'test', remark: '扩展端到端测试店' },
  { store_code: null,  mall_id: 'MALL-DBG',        mall_name: 'Debug Store',                status: 'test', remark: '调试店' },
];

const now = new Date().toISOString();
const upsert = db.prepare(`
  INSERT INTO erp_temu_malls (mall_id, mall_name, store_code, site, status, remark, created_at, updated_at)
  VALUES (@mall_id, @mall_name, @store_code, @site, @status, @remark, @now, @now)
  ON CONFLICT(mall_id) DO UPDATE SET
    mall_name = excluded.mall_name,
    store_code = excluded.store_code,
    status = excluded.status,
    remark = excluded.remark,
    updated_at = excluded.updated_at
`);

const tx = db.transaction(() => {
  for (const m of MALLS) {
    upsert.run({
      mall_id: m.mall_id,
      mall_name: m.mall_name,
      store_code: m.store_code || null,
      site: m.site || 'agentseller',
      status: m.status || 'active',
      remark: m.remark || null,
      now,
    });
  }
});

tx();

const counts = db.prepare(`
  SELECT status, COUNT(*) AS cnt FROM erp_temu_malls GROUP BY status
`).all();

console.log(`erp_temu_malls upsert 完成（${dbPath}）`);
for (const row of counts) console.log(`  status=${row.status}: ${row.cnt} 条`);
db.close();
