"""把 orders-archive 8092 单（全是已取消送仓订单）灌进 jst_consign_deliveries 表"""
import json
import os
import sys
import io
from datetime import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

SRC = r"C:\Users\Administrator\Desktop\商品文件夹"
OUT = "import-orders-archive.sql"
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


def is_jinan(s):
    return "济南" in str(s or "")


with open(os.path.join(SRC, "jushuitan-orders-archive-8092.json"), "r", encoding="utf-8") as f:
    arc = json.load(f)

print(f"读 {len(arc)} 条 archive 订单")

count = 0
skip_jinan = 0
skip_no_oid = 0
with open(OUT, "w", encoding="utf-8") as f:
    f.write(f"-- orders-archive 8092 单（已取消）灌进 jst_consign_deliveries\n")
    f.write(f"-- 生成: {NOW}\n\n")
    f.write("BEGIN;\n\n")

    for r in arc:
        if is_jinan(r.get("shop_name")):
            skip_jinan += 1
            continue
        o_id = r.get("o_id")
        if o_id is None:
            skip_no_oid += 1
            continue
        # 因为 archive 跟 deliveries 0 交集，o_id 不会冲突
        # 但保险起见用 INSERT OR IGNORE
        raw = json.dumps(r, ensure_ascii=False, separators=(",", ":"))
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
            ("status", esc(r.get("status"))),  # 取消
            ("src_status", esc(r.get("src_status"))),  # Cancelled
            ("wms_co_id", intesc(r.get("wms_co_id"))),
            ("wms_co_name", esc(r.get("wms_co_name"))),
            ("logistics_company", esc(r.get("logistics_company"))),
            ("l_id", esc(r.get("l_id"))),
            ("receiver_name", esc(r.get("receiver_name"))),
            ("receiver_country", esc(r.get("receiver_country"))),
            ("weight", numesc(r.get("weight"))),
            ("currency", esc(r.get("currency"))),
            ("labels", esc(r.get("labels"))),
            ("remark", esc(r.get("remark"))),
            ("raw_json", esc(raw)),
            ("imported_at", esc(NOW)),
            ("updated_at", esc(NOW)),
        ]
        keys = ", ".join(k for k, _ in cols)
        vals = ", ".join(v for _, v in cols)
        f.write(f"INSERT OR IGNORE INTO jst_consign_deliveries ({keys}) VALUES ({vals});\n")
        count += 1

    f.write("\nCOMMIT;\n")

print(f"✅ 已生成 {OUT}: {count} 条灌入, 跳济南 {skip_jinan}, 跳无 o_id {skip_no_oid}")
print(f"   文件大小 {os.path.getsize(OUT)//1024} KB")
