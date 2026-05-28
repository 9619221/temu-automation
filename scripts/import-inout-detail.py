"""灌聚水潭出入库台账 18.3 万行进生产 jst_inout_detail 表。"""
import csv
import os
import sys
import io as iolib
from datetime import datetime

sys.stdout = iolib.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

SRC = r"C:\Users\Administrator\Desktop\商品文件夹\jushuitan-inoutstock-detail.csv"
OUT = "import-inout-detail.sql"
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
    try:
        return str(int(float(v)))
    except Exception:
        return "NULL"


COLUMN_MAP = {
    "进出仓单号": "io_no",
    "关联单号": "related_no",
    "进出仓日期": "io_date",
    "进出仓类型": "io_type",
    "出入": "direction",
    "创建人": "creator_name",
    "商品编码": "sku_code",
    "款式编码": "style_code",
    "商品标签": "product_tags",
    "颜色规格": "color_spec",
    "分类": "category",
    "虚拟分类": "virtual_category",
    "供应商": "supplier_name",
    "单据供应商": "bill_supplier",
    "供应商款号": "supplier_style_no",
    "供应商商品编码": "supplier_sku",
    "品牌": "brand",
    "成本价来源": "cost_price_source",
    "仓储方": "warehouse_party",
    "仓库": "warehouse",
    "单位": "unit",
    "关联仓库": "related_warehouse",
    "备注": "remark",
    "明细行备注": "line_remark",
    "仓位": "bin",
    "原始线上订单号": "original_online_order_no",
    "店铺名称": "shop_name",
    "售后单号": "aftersale_no",
    "线上订单号": "online_order_no",
    "出仓类型": "outbound_type",
    "单据标签": "bill_tags",
    "快递单号": "tracking_no",
}

NUM_COLS = {"重量": "weight", "体积": "volume", "长": "length", "宽": "width", "高": "height", "成本价": "cost_price"}
INT_COLS = {"数量": "qty"}


print(f"读 {SRC}...")
rows = []
with open(SRC, "r", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    rows = list(reader)
print(f"  共 {len(rows):,} 行")

seq_by_io = {}
count = 0
skip_jinan = 0

with open(OUT, "w", encoding="utf-8") as f:
    f.write(f"-- 聚水潭出入库台账完整流水灌入\n-- 生成: {NOW}\n\n")
    f.write("BEGIN;\n")
    f.write("DELETE FROM jst_inout_detail;\n\n")

    for r in rows:
        # 济南店排除
        if "济南" in str(r.get("店铺名称") or "") or "济南" in str(r.get("品牌") or ""):
            skip_jinan += 1
            continue
        io_no = (r.get("进出仓单号") or "").strip()
        if not io_no:
            continue
        seq = seq_by_io.get(io_no, 0)
        seq_by_io[io_no] = seq + 1

        cols = [
            ("id", esc(f"jst:inout:{io_no}:{seq}")),
            ("company_id", esc("company_default")),
            ("io_no", esc(io_no)),
            ("seq", intesc(seq)),
        ]
        # 字符串列
        for csv_k, db_k in COLUMN_MAP.items():
            if db_k == "io_no":
                continue  # 已加
            cols.append((db_k, esc(r.get(csv_k))))
        # 数值列
        for csv_k, db_k in NUM_COLS.items():
            cols.append((db_k, numesc(r.get(csv_k))))
        # 整数列
        for csv_k, db_k in INT_COLS.items():
            cols.append((db_k, intesc(r.get(csv_k))))
        # 时间戳
        cols.append(("imported_at", esc(NOW)))
        cols.append(("updated_at", esc(NOW)))

        keys = ", ".join(k for k, _ in cols)
        vals = ", ".join(v for _, v in cols)
        f.write(f"INSERT INTO jst_inout_detail ({keys}) VALUES ({vals});\n")
        count += 1

    f.write("\nCOMMIT;\n")

print(f"\n✅ 已生成 {OUT}")
print(f"   灌入 {count:,} 行，跳济南 {skip_jinan:,}")
print(f"   文件大小 {os.path.getsize(OUT)//1024//1024} MB")
