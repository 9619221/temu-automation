"""
导入聚水潭"送仓托管出库" + "其他出入库"到生产 ERP。
含济南排除。
"""
import json
import os
import sys
import io
from datetime import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

SRC = r"C:\Users\Administrator\Desktop\商品文件夹"
OUT = "import-deliveries-otherout.sql"
NOW = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")


def esc(v):
    if v is None or v == "":
        return "NULL"
    s = str(v).replace("'", "''")
    return f"'{s}'"


def numesc(v):
    if v is None or v == "":
        return "NULL"
    try:
        return str(float(v))
    except Exception:
        return "NULL"


def intesc(v):
    if v is None or v == "":
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    try:
        return str(int(float(v)))
    except Exception:
        return "NULL"


def load(name):
    with open(os.path.join(SRC, name), "r", encoding="utf-8") as f:
        return json.load(f)


def is_jinan(shop_name):
    return "济南" in str(shop_name or "")


print("读 4 个聚水潭 json...")
deliv_head = load("jushuitan-temu-consign-deliver-head.json")
deliv_items = load("jushuitan-temu-consign-deliver-items.json")
other_head = load("jushuitan-otherout-968.json")
other_items = load("jushuitan-otherout-detail-1076.json")
print(f"  consign-deliver: {len(deliv_head)} 单 + {len(deliv_items)} 明细")
print(f"  otherout:        {len(other_head)} 单 + {len(other_items)} 明细")


with open(OUT, "w", encoding="utf-8") as f:
    f.write("-- 送仓托管出库 + 其他出入库 数据导入\n")
    f.write(f"-- 生成时间: {NOW}\n")
    f.write("-- 济南排除\n\n")
    f.write("BEGIN;\n\n")
    f.write("-- 防重复\n")
    f.write("DELETE FROM jst_consign_deliver_items;\n")
    f.write("DELETE FROM jst_consign_deliveries;\n")
    f.write("DELETE FROM jst_other_inout_items;\n")
    f.write("DELETE FROM jst_other_inout;\n\n")

    # ============ 1. jst_consign_deliveries ============
    skip_jinan_head = 0
    f.write(f"-- 1. jst_consign_deliveries\n")
    count = 0
    for r in deliv_head:
        if is_jinan(r.get("shop_name")):
            skip_jinan_head += 1
            continue
        o_id = r.get("o_id")
        if o_id is None:
            continue
        raw = json.dumps({k: v for k, v in r.items() if k != "items"}, ensure_ascii=False, separators=(",", ":"))
        # 聚水潭把「待接单/等待确认」等待处理问题单(src_status=Question)导出为 status=异常，
        # 业务口径归到「已付款待审核」阶段，这里规整，避免界面显示「异常」误导。原始值仍在 raw_json 和 src_status。
        _status = r.get("status")
        if _status == "异常":
            _status = "已付款待审核"
        cols = [
            ("id", esc(f"jst:consign-deliver:{o_id}")),
            ("company_id", esc("company_default")),
            ("o_id", intesc(o_id)),
            ("so_id", esc(r.get("so_id"))),
            ("pre_so_id", esc(r.get("pre_so_id"))),
            ("drp_so_id", esc(r.get("drp_so_id"))),
            ("o_id_en", esc(r.get("o_id_en"))),
            ("outer_pay_id", esc(r.get("outer_pay_id"))),
            ("outer_deliver_no", esc(r.get("outer_deliver_no"))),
            ("order_date", esc(r.get("order_date"))),
            ("pay_date", esc(r.get("pay_date"))),
            ("plan_delivery_date", esc(r.get("plan_delivery_date"))),
            ("send_date", esc(r.get("send_date"))),
            ("sign_time", esc(r.get("sign_time"))),
            ("shop_id", intesc(r.get("shop_id"))),
            ("shop_name", esc(r.get("shop_name"))),
            ("shop_site", esc(r.get("shop_site"))),
            ("type", esc(r.get("type"))),
            ("status", esc(_status)),
            ("src_status", esc(r.get("src_status"))),
            ("shop_status", esc(r.get("shop_status"))),
            ("shop_status_text", esc(r.get("shop_status_text"))),
            ("shop_delivery_status", esc(r.get("shop_delivery_status"))),
            ("shop_delivery_status_text", esc(r.get("shop_delivery_status_text"))),
            ("delivery_status", esc(r.get("delivery_status"))),
            ("question_type", esc(r.get("question_type"))),
            ("question_desc", esc(r.get("question_desc"))),
            ("is_refund", intesc(r.get("is_refund"))),
            ("is_paid", intesc(r.get("is_paid"))),
            ("is_cod", intesc(r.get("is_cod"))),
            ("is_split", intesc(r.get("is_split"))),
            ("is_merge", intesc(r.get("is_merge"))),
            ("wms_co_id", intesc(r.get("wms_co_id"))),
            ("wms_co_name", esc(r.get("wms_co_name"))),
            ("bin_name", esc(r.get("bin_name"))),
            ("logistics_company", esc(r.get("logistics_company"))),
            ("l_id", esc(r.get("l_id"))),
            ("receiver_name", esc(r.get("receiver_name"))),
            ("receiver_country", esc(r.get("receiver_country"))),
            ("receiver_state", esc(r.get("receiver_state"))),
            ("receiver_city", esc(r.get("receiver_city"))),
            ("receiver_district", esc(r.get("receiver_district"))),
            ("receiver_town", esc(r.get("receiver_town"))),
            ("receiver_address", esc(r.get("receiver_address"))),
            ("receiver_zip", esc(r.get("receiver_zip"))),
            ("supplier_name", esc(r.get("supplier_name"))),
            ("buyer_id", intesc(r.get("buyer_id"))),
            ("item_amount", numesc(r.get("item_amount"))),
            ("items_qty", intesc(r.get("items_qty"))),
            ("shipped_qty", intesc(r.get("shipped_qty"))),
            ("instocked_qty", intesc(r.get("instocked_qty"))),
            ("return_qty", intesc(r.get("return_qty"))),
            ("weight", numesc(r.get("weight"))),
            ("freight", numesc(r.get("freight"))),
            ("free_amount", numesc(r.get("free_amount"))),
            ("currency", esc(r.get("currency"))),
            ("sku_info", esc(r.get("sku_info"))),
            ("skus", esc(r.get("skus"))),
            ("labels", esc(r.get("labels"))),
            ("remark", esc(r.get("remark"))),
            ("created_text", esc(r.get("created"))),
            ("modified_text", esc(r.get("modified"))),
            ("raw_json", esc(raw)),
            ("imported_at", esc(NOW)),
            ("updated_at", esc(NOW)),
        ]
        keys = ", ".join(k for k, _ in cols)
        vals = ", ".join(v for _, v in cols)
        f.write(f"INSERT INTO jst_consign_deliveries ({keys}) VALUES ({vals});\n")
        count += 1
    print(f"  jst_consign_deliveries: 灌 {count}，跳过济南 {skip_jinan_head}")

    # ============ 2. jst_consign_deliver_items ============
    skip_jinan_items = 0
    f.write(f"\n-- 2. jst_consign_deliver_items\n")
    count2 = 0
    for r in deliv_items:
        if is_jinan(r.get("_shop_name")):
            skip_jinan_items += 1
            continue
        oi_id = r.get("oi_id")
        if oi_id is None:
            continue
        raw = json.dumps(r, ensure_ascii=False, separators=(",", ":"))
        cols = [
            ("id", esc(f"jst:consign-deliver-item:{oi_id}")),
            ("company_id", esc("company_default")),
            ("oi_id", intesc(oi_id)),
            ("o_id", intesc(r.get("_o_id") or r.get("o_id"))),
            ("so_id", esc(r.get("_so_id") or r.get("so_id"))),
            ("shop_name", esc(r.get("_shop_name"))),
            ("shop_status", esc(r.get("_status"))),
            ("order_date", esc(r.get("_order_date"))),
            ("sku_id", esc(r.get("sku_id"))),
            ("i_id", esc(r.get("i_id"))),
            ("sku_code", esc(r.get("sku_code"))),
            ("name", esc(r.get("name"))),
            ("properties_value", esc(r.get("properties_value"))),
            ("pic_url", esc(r.get("pic"))),
            ("qty", intesc(r.get("qty"))),
            ("base_price", numesc(r.get("base_price"))),
            ("price", numesc(r.get("price"))),
            ("amount", numesc(r.get("amount"))),
            ("cost_price", numesc(r.get("cost_price"))),
            ("cost_amount", numesc(r.get("cost_amount"))),
            ("raw_json", esc(raw)),
            ("imported_at", esc(NOW)),
            ("updated_at", esc(NOW)),
        ]
        keys = ", ".join(k for k, _ in cols)
        vals = ", ".join(v for _, v in cols)
        f.write(f"INSERT INTO jst_consign_deliver_items ({keys}) VALUES ({vals});\n")
        count2 += 1
    print(f"  jst_consign_deliver_items: 灌 {count2}，跳过济南 {skip_jinan_items}")

    # ============ 3. jst_other_inout（其他出入库 single 文件含 items）============
    # otherout-968 文件每条单头自带 items？让我看 其实 detail-1076 是独立的明细文件
    f.write(f"\n-- 3. jst_other_inout\n")
    count3 = 0
    for r in other_head:
        # 检查 creator/warehouse 是否济南（之前确认 0 个济南）
        if is_jinan(r.get("warehouse")) or is_jinan(r.get("creator_name")):
            continue
        io_id = r.get("io_id")
        if io_id is None:
            continue
        raw = json.dumps(r, ensure_ascii=False, separators=(",", ":"))
        cols = [
            ("id", esc(f"jst:other-io:{io_id}")),
            ("company_id", esc("company_default")),
            ("io_id", intesc(io_id)),
            ("io_date", esc(r.get("io_date"))),
            ("type", esc(r.get("type"))),
            ("status", esc(r.get("status"))),
            ("f_status", esc(r.get("f_status"))),
            ("wh_id", intesc(r.get("wh_id"))),
            ("lwh_id", intesc(r.get("lwh_id"))),
            ("lwh_name", esc(r.get("lwh_name"))),
            ("warehouse", esc(r.get("warehouse"))),
            ("wms_co_id", intesc(r.get("wms_co_id"))),
            ("wms_co_name", esc(r.get("wms_co_name"))),
            ("total_qty", intesc(r.get("total_qty"))),
            ("total_amount", numesc(r.get("total_amount"))),
            ("total_cost", numesc(r.get("total_cost"))),
            ("reason", esc(r.get("reason"))),
            ("drp_co_id", intesc(r.get("drp_co_id"))),
            ("node", esc(r.get("node"))),
            ("labels", esc(r.get("labels"))),
            ("remark", esc(r.get("remark"))),
            ("creator_name", esc(r.get("creator_name"))),
            ("archiver_name", esc(r.get("archiver_name"))),
            ("archived_at", esc(r.get("archived_at"))),
            ("modifier_name", esc(r.get("modifier_name"))),
            ("created_text", esc(r.get("created"))),
            ("modified_text", esc(r.get("modified"))),
            ("raw_json", esc(raw)),
            ("imported_at", esc(NOW)),
            ("updated_at", esc(NOW)),
        ]
        keys = ", ".join(k for k, _ in cols)
        vals = ", ".join(v for _, v in cols)
        f.write(f"INSERT INTO jst_other_inout ({keys}) VALUES ({vals});\n")
        count3 += 1
    print(f"  jst_other_inout: 灌 {count3}")

    # ============ 4. jst_other_inout_items（detail-1076）============
    # detail 没自己的 PK，需要 io_id + seq 组合
    f.write(f"\n-- 4. jst_other_inout_items\n")
    count4 = 0
    seq_by_io = {}  # io_id -> next seq
    for r in other_items:
        io_id = r.get("io_id") or r.get("__io_id")
        if io_id is None:
            continue
        # 看是否能从 raw 里反推 io_id；如果 detail 里没 io_id 字段就跳过（要 join 文件）
        seq = seq_by_io.get(io_id, 0)
        seq_by_io[io_id] = seq + 1
        raw = json.dumps(r, ensure_ascii=False, separators=(",", ":"))
        cols = [
            ("id", esc(f"jst:other-io-item:{io_id}:{seq}")),
            ("company_id", esc("company_default")),
            ("io_id", intesc(io_id)),
            ("seq", intesc(seq)),
            ("sku_id", esc(r.get("sku_id"))),
            ("i_id", esc(r.get("i_id"))),
            ("name", esc(r.get("name"))),
            ("properties_value", esc(r.get("properties_value"))),
            ("pic_url", esc(r.get("pic"))),
            ("qty", intesc(r.get("qty"))),
            ("unit", esc(r.get("unit"))),
            ("shelf_life", intesc(r.get("shelf_life"))),
            ("cost_price", numesc(r.get("cost_price"))),
            ("cost_amount", numesc(r.get("cost_amount"))),
            ("supplier_id", esc(r.get("supplier_id"))),
            ("supplier_i_id", esc(r.get("supplier_i_id"))),
            ("supplier_sku_id", esc(r.get("supplier_sku_id"))),
            ("labels", esc(r.get("labels"))),
            ("remark", esc(r.get("remark"))),
            ("raw_json", esc(raw)),
            ("imported_at", esc(NOW)),
            ("updated_at", esc(NOW)),
        ]
        keys = ", ".join(k for k, _ in cols)
        vals = ", ".join(v for _, v in cols)
        f.write(f"INSERT INTO jst_other_inout_items ({keys}) VALUES ({vals});\n")
        count4 += 1
    print(f"  jst_other_inout_items: 灌 {count4}")

    f.write("\nCOMMIT;\n")

print(f"\n✅ 已生成 {OUT}, {os.path.getsize(OUT)//1024} KB")
