# -*- coding: utf-8 -*-
"""
聚水潭「商品资料」xlsx(资料视角 103 列,inline-string 流式写法)→ 规范化 JSON。
只取业务有用的列,丢弃 58 个「前 N 天 销量/退货/实发/实退/仅退款」时间序列统计列。
用法: python jushuitan-sku-profile-convert.py <输入.xlsx> <输出.json>
"""
import re
import sys
import json
import zipfile
import xml.etree.ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# 中文列名 -> (输出键名, 类型) ; 类型 num 转 float,其余原样字符串
COLUMN_MAP = {
    "商品编码": ("internal_sku_code", "str"),
    "商品名称": ("product_name", "str"),
    "颜色及规格": ("color_spec", "str"),
    "图片": ("image_url", "str"),
    "分类": ("category", "str"),
    "商品状态": ("product_status", "str"),
    "款式编码": ("jst_style_code", "str"),
    "商品简称": ("jst_short_name", "str"),
    "颜色": ("jst_color", "str"),
    "规格": ("jst_spec", "str"),
    "品牌": ("jst_brand", "str"),
    "虚拟分类": ("jst_virtual_category", "str"),
    "商品标签": ("jst_product_tags", "str"),
    "国标码": ("jst_barcode", "str"),
    "主仓位": ("jst_main_bin", "str"),
    "成本价": ("jst_cost_price", "num"),
    "采购价": ("jst_purchase_price", "num"),
    "基本售价": ("jst_base_sale_price", "num"),
    "市场|吊牌价": ("jst_market_price", "num"),
    "实际库存数": ("jst_actual_stock_qty", "num"),
    "订单占有数": ("jst_order_occupied_qty", "num"),
    "采购在途数": ("jst_purchase_in_transit_qty", "num"),
    "调拨在途数": ("jst_transfer_in_transit_qty", "num"),
    "待审核采购数": ("jst_pending_purchase_qty", "num"),
    "30天销量": ("jst_sales_qty_30d", "num"),
    "15天销量": ("jst_sales_qty_15d", "num"),
    "采购模型": ("jst_purchase_model", "str"),
    "建议采购数": ("jst_suggested_purchase_qty", "num"),
    "库容下限": ("jst_stock_floor", "num"),
    "库容上限": ("jst_stock_ceiling", "num"),
    "供应商名称": ("jst_supplier_name", "str"),
    "采购链接": ("jst_purchase_url", "str"),
    "采购特征": ("jst_purchase_feature", "str"),
    "库存同步": ("jst_stock_sync", "str"),
    "重量": ("jst_weight", "num"),
    "长": ("jst_length", "num"),
    "宽": ("jst_width", "num"),
    "高": ("jst_height", "num"),
    "体积": ("jst_volume", "num"),
    "单位": ("jst_unit", "str"),
    "标准装箱数量": ("jst_carton_qty", "num"),
    "标准装箱体积": ("jst_carton_volume", "num"),
    "备注": ("jst_remark", "str"),
    "创建时间": ("jst_created_at", "str"),
    "修改时间": ("jst_modified_at", "str"),
    "创建人": ("jst_creator", "str"),
}


_X_ESC = re.compile(r"_x([0-9A-Fa-f]{4})_")


def unescape_x(value):
    # Excel inline-string 把特殊字符写成 _xHHHH_(如 + = _x002B_),还原回真字符
    if not value:
        return value
    return _X_ESC.sub(lambda m: chr(int(m.group(1), 16)), value)


def to_num(text):
    s = str(text).replace(",", "").strip()
    if s == "":
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return int(f) if f.is_integer() else f


def main():
    if len(sys.argv) != 3:
        print("用法: python jushuitan-sku-profile-convert.py <输入.xlsx> <输出.json>")
        sys.exit(2)
    src, dst = sys.argv[1], sys.argv[2]
    zf = zipfile.ZipFile(src)
    sheet = [n for n in zf.namelist() if n.startswith("xl/worksheets/sheet")][0]
    header = None
    idx = {}
    out = []
    empty_code = 0
    with zf.open(sheet) as fh:
        for _, el in ET.iterparse(fh):
            if el.tag != NS + "row":
                continue
            cells = []
            for c in el.findall(NS + "c"):
                t = c.find(NS + "is/" + NS + "t")
                v = c.find(NS + "v")
                cells.append(unescape_x(t.text) if t is not None else (v.text if v is not None else ""))
            if header is None:
                header = cells
                idx = {name: i for i, name in enumerate(header)}
            else:
                rec = {}
                for zh, (key, kind) in COLUMN_MAP.items():
                    i = idx.get(zh)
                    raw = cells[i] if (i is not None and i < len(cells)) else ""
                    if kind == "num":
                        rec[key] = to_num(raw)
                    else:
                        s = str(raw).strip()
                        rec[key] = s if s != "" else None
                code = rec.get("internal_sku_code")
                if not code:
                    empty_code += 1
                    el.clear()
                    continue
                out.append(rec)
            el.clear()
    with open(dst, "w", encoding="utf-8") as w:
        json.dump(out, w, ensure_ascii=False)
    print("输出记录数:", len(out), " 跳过空商品编码:", empty_code, " 列数/条:", len(COLUMN_MAP))


if __name__ == "__main__":
    main()
