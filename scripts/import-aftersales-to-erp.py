"""
把聚水潭采购退货 + 送仓售后 4 个 json 导入到生产 ERP 的对应表。
输出 SQL 到 /tmp 文件，scp 上去 sqlite3 执行。
含济南排除。
"""
import json
import os
import sys
import io
from datetime import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

SRC = r"C:\Users\Administrator\Desktop\商品文件夹"
OUT = "import-aftersales.sql"
NOW = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")


def esc(v):
    """SQL 字符串转义"""
    if v is None:
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
    try:
        return str(int(float(v)))
    except Exception:
        return "NULL"


def load(name):
    with open(os.path.join(SRC, name), "r", encoding="utf-8") as f:
        return json.load(f)


def is_jinan(name):
    return "济南" in str(name or "")


print("读 4 个聚水潭 json...")
purchase_out = load("jushuitan-purchaseout-1062.json")
purchase_out_items = load("jushuitan-purchaseout-detail-1264.json")
aftersale = load("jushuitan-aftersale-consign-5483.json")
aftersale_items = load("jushuitan-aftersale-detail-10325.json")
print(f"  purchase_out: {len(purchase_out)} 单 + {len(purchase_out_items)} 明细")
print(f"  aftersale:    {len(aftersale)} 单 + {len(aftersale_items)} 明细")


with open(OUT, "w", encoding="utf-8") as f:
    f.write("-- 聚水潭采购退货 + 送仓售后 数据导入\n")
    f.write("-- 生成时间: " + NOW + "\n\n")
    f.write("BEGIN;\n\n")
    f.write("-- 防重复：先清空可能的部分导入数据\n")
    f.write("DELETE FROM purchase_return_items;\n")
    f.write("DELETE FROM purchase_returns;\n")
    f.write("DELETE FROM consign_after_sale_items;\n")
    f.write("DELETE FROM consign_after_sales;\n\n")

    # ---- purchase_returns 单头 ----
    f.write(f"-- 1. purchase_returns ({len(purchase_out)} 单)\n")
    for r in purchase_out:
        io_id = r.get("io_id")
        if io_id is None:
            continue
        cols = {
            "id": f"jst:po-out:{io_id}",
            "company_id": "company_default",
            "io_id": io_id,
            "io_date": r.get("io_date"),
            "status": r.get("status"),
            "f_status": r.get("f_status"),
            "total_qty": intesc(r.get("total_qty")),
            "total_sku_count": intesc(r.get("total_sku_count") or r.get("total_sku_ids")),
            "total_amount": numesc(r.get("total_amount")),
            "wms_co_name": r.get("wms_co_name"),
            "warehouse": r.get("warehouse"),
            "supplier_name": r.get("receiver_name") or r.get("supplier_name"),
            "creator_name": r.get("creator_name"),
            "archiver_name": r.get("archiver_name"),
            "archived_at": r.get("archived_at"),
            "labels": r.get("labels"),
            "remark": r.get("remark"),
            "created_text": r.get("created"),
            "modified_text": r.get("modified"),
        }
        raw = json.dumps(r, ensure_ascii=False, separators=(",", ":"))
        # 构造 INSERT
        keys = list(cols.keys()) + ["raw_json", "imported_at", "updated_at"]
        vals = []
        for k, v in cols.items():
            if v in ("NULL",) or isinstance(v, str) and v.startswith(("NULL", "'")):
                vals.append(v)
            elif isinstance(v, int):
                vals.append(str(v))
            else:
                vals.append(esc(v))
        vals.append(esc(raw))
        vals.append(esc(NOW))
        vals.append(esc(NOW))
        f.write(f"INSERT INTO purchase_returns ({', '.join(keys)}) VALUES ({', '.join(vals)});\n")

    # ---- purchase_return_items 明细 ----
    f.write(f"\n-- 2. purchase_return_items ({len(purchase_out_items)} 行)\n")
    # 明细要关联到单头：明细文件本身就带 io_id（应该带），看下样本
    sample = purchase_out_items[0] if purchase_out_items else {}
    has_io_id = "io_id" in sample
    has_ioi_id = "ioi_id" in sample
    if not (has_io_id and has_ioi_id):
        f.write(f"-- WARNING: 明细缺 io_id 或 ioi_id（has_io_id={has_io_id}, has_ioi_id={has_ioi_id}），先看其它字段补\n")
    for r in purchase_out_items:
        ioi_id = r.get("ioi_id") or r.get("__ioi_id")
        io_id = r.get("io_id") or r.get("__io_id")
        if ioi_id is None or io_id is None:
            continue
        cols = {
            "id": f"jst:po-out-item:{ioi_id}",
            "company_id": "company_default",
            "io_id": io_id,
            "ioi_id": ioi_id,
            "sku_id": r.get("sku_id"),
            "product_name": r.get("name"),
            "properties_value": r.get("properties_value"),
            "pic_url": r.get("pic"),
            "qty": intesc(r.get("qty")),
            "cost_price": numesc(r.get("cost_price")),
            "cost_amount": numesc(r.get("cost_amount")),
            "i_id": r.get("i_id"),
            "supplier_i_id": r.get("supplier_i_id"),
            "supplier_sku_id": r.get("supplier_sku_id"),
            "labels": r.get("labels"),
            "remark": r.get("remark"),
        }
        raw = json.dumps(r, ensure_ascii=False, separators=(",", ":"))
        keys = list(cols.keys()) + ["raw_json", "imported_at", "updated_at"]
        vals = []
        for k, v in cols.items():
            if v in ("NULL",) or isinstance(v, str) and v.startswith(("NULL", "'")):
                vals.append(v)
            elif isinstance(v, int):
                vals.append(str(v))
            else:
                vals.append(esc(v))
        vals.append(esc(raw))
        vals.append(esc(NOW))
        vals.append(esc(NOW))
        f.write(f"INSERT INTO purchase_return_items ({', '.join(keys)}) VALUES ({', '.join(vals)});\n")

    # ---- consign_after_sales 单头 ----
    skip_jinan_head = 0
    jinan_as_ids = set()
    f.write(f"\n-- 3. consign_after_sales (含济南排除)\n")
    for r in aftersale:
        as_id = r.get("as_id")
        if as_id is None:
            continue
        if is_jinan(r.get("shop_name")):
            jinan_as_ids.add(as_id)
            skip_jinan_head += 1
            continue
        cols = {
            "id": f"jst:as-consign:{as_id}",
            "company_id": "company_default",
            "as_id": as_id,
            "outer_as_id": r.get("outer_as_id"),
            "as_date": r.get("as_date"),
            "shop_type": r.get("shop_type"),
            "type": r.get("type"),
            "status": r.get("status"),
            "shop_status": r.get("shop_status"),
            "good_status": r.get("good_status"),
            "shop_name": r.get("shop_name"),
            "shop_id": intesc(r.get("shop_id")),
            "shop_site": r.get("shop_site"),
            "warehouse": r.get("warehouse"),
            "wh_id": intesc(r.get("wh_id")),
            "wh_code": r.get("wh_code"),
            "receiver_name": r.get("receiver_name_en") or r.get("receiver_name"),
            "receiver_mobile": r.get("receiver_mobile_en") or r.get("receiver_mobile"),
            "receiver_phone": r.get("receiver_phone_en") or r.get("receiver_phone"),
            "refund_qty": intesc(r.get("refund_Qty") or r.get("refund_qty")),
            "r_qty": intesc(r.get("r_qty")),
            "box_id_count": intesc(r.get("box_id_count")),
            "payment": numesc(r.get("payment")),
            "total_amount": numesc(r.get("total_amount")),
            "refund_total_amount": numesc(r.get("refund_total_amount")),
            "buyer_apply_refund": r.get("buyer_apply_refund"),
            "refund": numesc(r.get("refund")),
            "logistics_company": r.get("logistics_company"),
            "l_id": r.get("l_id"),
            "o_id": r.get("o_id"),
            "so_id": r.get("so_id"),
            "labels": r.get("labels"),
            "remark": r.get("remark"),
            "modifier_name": r.get("modifier_name"),
            "creator_name": r.get("creator_name"),
            "confirm_date": r.get("confirm_date"),
            "created_text": r.get("created"),
            "modified_text": r.get("modified"),
        }
        raw = json.dumps(r, ensure_ascii=False, separators=(",", ":"))
        keys = list(cols.keys()) + ["raw_json", "imported_at", "updated_at"]
        vals = []
        for k, v in cols.items():
            if v in ("NULL",) or isinstance(v, str) and v.startswith(("NULL", "'")):
                vals.append(v)
            elif isinstance(v, int):
                vals.append(str(v))
            else:
                vals.append(esc(v))
        vals.append(esc(raw))
        vals.append(esc(NOW))
        vals.append(esc(NOW))
        f.write(f"INSERT INTO consign_after_sales ({', '.join(keys)}) VALUES ({', '.join(vals)});\n")

    # ---- consign_after_sale_items 明细 ----
    skip_jinan_items = 0
    f.write(f"\n-- 4. consign_after_sale_items (含济南排除)\n")
    for r in aftersale_items:
        asi_id = r.get("asi_id") or r.get("__asi_id")
        as_id = r.get("as_id") or r.get("__as_id")
        if asi_id is None or as_id is None:
            continue
        if as_id in jinan_as_ids or is_jinan(r.get("__shop_name")) or is_jinan(r.get("shop_name")):
            skip_jinan_items += 1
            continue
        cols = {
            "id": f"jst:as-consign-item:{asi_id}",
            "company_id": "company_default",
            "asi_id": asi_id,
            "as_id": as_id,
            "outer_as_id": r.get("outer_as_id") or r.get("__outer_as_id"),
            "shop_name": r.get("shop_name") or r.get("__shop_name"),
            "sku_id": r.get("sku_id"),
            "i_id": r.get("i_id"),
            "sku_code": r.get("sku_code"),
            "product_name": r.get("name"),
            "properties_value": r.get("properties_value"),
            "pic_url": r.get("pic"),
            "qty": intesc(r.get("qty")),
            "r_qty": intesc(r.get("r_qty")),
            "defective_qty": intesc(r.get("defective_qty")),
            "price": numesc(r.get("price")),
            "amount": numesc(r.get("amount")),
            "refund_amount": numesc(r.get("refund_amount")),
            "shop_amount": r.get("shop_amount"),
            "supplier_name": r.get("supplier_name"),
            "type": r.get("type"),
            "des": r.get("des"),
            "outer_oi_id": r.get("outer_oi_id"),
            "o_id": r.get("o_id"),
            "o_id_en": r.get("o_id_en"),
            "box_id": r.get("box_id"),
            "item_sign": r.get("item_sign"),
            "temu_so_id": r.get("temu_so_id"),
            "item_labels": r.get("item_labels"),
        }
        raw = json.dumps(r, ensure_ascii=False, separators=(",", ":"))
        keys = list(cols.keys()) + ["raw_json", "imported_at", "updated_at"]
        vals = []
        for k, v in cols.items():
            if v in ("NULL",) or isinstance(v, str) and v.startswith(("NULL", "'")):
                vals.append(v)
            elif isinstance(v, int):
                vals.append(str(v))
            else:
                vals.append(esc(v))
        vals.append(esc(raw))
        vals.append(esc(NOW))
        vals.append(esc(NOW))
        f.write(f"INSERT INTO consign_after_sale_items ({', '.join(keys)}) VALUES ({', '.join(vals)});\n")

    f.write("\nCOMMIT;\n")

print(f"\n✅ 已生成: {OUT}, 大小 {os.path.getsize(OUT)//1024} KB")
print(f"   送仓售后跳济南单头 {skip_jinan_head}，明细 {skip_jinan_items}")
