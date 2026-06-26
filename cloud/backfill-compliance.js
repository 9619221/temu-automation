const Database = require("better-sqlite3");
const crypto = require("crypto");
const db = new Database("/opt/temu-cloud/data/temu-cloud.sqlite");

const rows = db.prepare(`
  SELECT * FROM capture_events
  WHERE url_path = '/ms/bg-flux-ms/compliance_property/query_detail'
    AND body_size > 1000
  ORDER BY received_at DESC
`).all();
console.log("Found", rows.length, "successful query_detail events");

const upsert = db.prepare(`
  INSERT INTO temu_compliance_property (
    id, tenant_id, mall_id, site, product_skc_id,
    manufacturer_name, manufacturer_address, manufacturer_email,
    ec_rep_name, ec_rep_address, ec_rep_email,
    tur_rep_name, tur_rep_address,
    raw_json, source_event_id
  ) VALUES (
    @id, @tenant_id, @mall_id, @site, @product_skc_id,
    @manufacturer_name, @manufacturer_address, @manufacturer_email,
    @ec_rep_name, @ec_rep_address, @ec_rep_email,
    @tur_rep_name, @tur_rep_address,
    @raw_json, @source_event_id
  )
  ON CONFLICT(tenant_id, mall_id, product_skc_id) DO UPDATE SET
    manufacturer_name    = COALESCE(excluded.manufacturer_name, manufacturer_name),
    manufacturer_address = COALESCE(excluded.manufacturer_address, manufacturer_address),
    manufacturer_email   = COALESCE(excluded.manufacturer_email, manufacturer_email),
    ec_rep_name          = COALESCE(excluded.ec_rep_name, ec_rep_name),
    ec_rep_address       = COALESCE(excluded.ec_rep_address, ec_rep_address),
    ec_rep_email         = COALESCE(excluded.ec_rep_email, ec_rep_email),
    tur_rep_name         = COALESCE(excluded.tur_rep_name, tur_rep_name),
    tur_rep_address      = COALESCE(excluded.tur_rep_address, tur_rep_address),
    raw_json             = excluded.raw_json,
    source_event_id      = excluded.source_event_id,
    last_updated_at      = datetime('now')
`);

let ok = 0;
const tx = db.transaction(() => {
  for (const row of rows) {
    try {
      const body = JSON.parse(row.body_json);
      if (!body?.result?.template_list) continue;
      const r = body.result;
      const skc = String(r.spu_id || r.goods_id || "").trim();
      if (!skc) continue;
      const props = {
        manufacturer_name: null, manufacturer_address: null, manufacturer_email: null,
        ec_rep_name: null, ec_rep_address: null, ec_rep_email: null,
        tur_rep_name: null, tur_rep_address: null,
      };
      for (const tmpl of r.template_list) {
        const reps = Array.isArray(tmpl.rep_detail_list) ? tmpl.rep_detail_list : [];
        if (!reps.length) continue;
        const first = reps[0] || {};
        const name = (first.rep_name || "").trim();
        if (!name) continue;
        const ai = first.rep_address_info || {};
        const addr = [ai.address_line_one, ai.city, ai.state_name, ai.region_name, ai.post_code].filter(Boolean).join(", ");
        const email = first.rep_mail || null;
        const tt = Number(tmpl.task_type);
        if (tt === 25) {
          props.ec_rep_name = name;
          if (addr) props.ec_rep_address = addr;
          if (email) props.ec_rep_email = email;
        } else if (tt === 60) {
          props.manufacturer_name = name;
          if (addr) props.manufacturer_address = addr;
          if (email) props.manufacturer_email = email;
        } else if (tt === 84) {
          props.tur_rep_name = name;
          if (addr) props.tur_rep_address = addr;
        }
      }
      if (!props.ec_rep_name && !props.manufacturer_name && !props.tur_rep_name) continue;
      upsert.run({
        id: crypto.randomUUID(),
        tenant_id: row.tenant_id,
        mall_id: row.mall_id || "",
        site: row.site || null,
        product_skc_id: skc,
        ...props,
        raw_json: JSON.stringify(r).slice(0, 20000),
        source_event_id: row.id,
      });
      ok++;
    } catch (e) {
      console.log("err:", row.id, e.message);
    }
  }
});
tx();
console.log("Upserted", ok, "records");

const sample = db.prepare(`
  SELECT product_skc_id, manufacturer_name, ec_rep_name, tur_rep_name
  FROM temu_compliance_property
  WHERE manufacturer_name IS NOT NULL OR ec_rep_name IS NOT NULL OR tur_rep_name IS NOT NULL
  LIMIT 5
`).all();
console.log(JSON.stringify(sample, null, 2));
