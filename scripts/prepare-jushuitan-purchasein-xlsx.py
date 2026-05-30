#!/usr/bin/env python3
"""
Prepare Jushuitan purchase-in Excel exports for the ERP importer.

The importer reads two JSON files:
  - jushuitan-purchasein-<receipt-count>.json
  - jushuitan-purchasein-detail-<line-count>.json

This script converts one or more Jushuitan Excel files to that pair and can
exclude rows containing a keyword such as "Jinan" in any column.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pandas as pd


COLUMNS = {
    "receipt": "\u5165\u4ed3\u5355\u53f7",
    "po": "\u91c7\u8d2d\u5355\u53f7",
    "warehouse_owner": "\u64cd\u4f5c\u4ed3\u50a8\u65b9",
    "warehouse": "\u4ed3\u5e93",
    "supplier": "\u4f9b\u5e94\u5546",
    "supplier_code": "\u4f9b\u5e94\u5546\u7f16\u7801",
    "created": "\u521b\u5efa\u65e5\u671f",
    "inbound": "\u5165\u5e93\u65e5\u671f",
    "status": "\u72b6\u6001",
    "freight": "\u8fd0\u8d39",
    "fee": "\u8d39\u7528",
    "creator": "\u5236\u5355\u4eba",
    "remark": "\u5907\u6ce8",
    "remark2": "\u5907\u6ce82",
    "returned_qty": "\u5df2\u9000\u8d27\u6570",
    "total_return_qty": "\u9000\u8d27\u603b\u6570",
    "logistics": "\u7269\u6d41\u516c\u53f8",
    "tracking": "\u7269\u6d41\u5355\u53f7",
    "archiver": "\u8d22\u5ba1\u4eba",
    "archived": "\u8d22\u5ba1\u65e5\u671f",
    "labels": "\u6807\u8bb0\u591a\u6807\u7b7e",
    "buyer": "\u91c7\u8d2d\u5458",
    "sku": "\u5546\u54c1\u7f16\u7801",
    "qty": "\u6570\u91cf",
    "amount": "\u91d1\u989d",
}


def text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
        return ""
    raw = str(value).strip()
    return raw[:-2] if raw.endswith(".0") else raw


def number(value: Any) -> float:
    raw = text(value).replace(",", "")
    if not raw:
        return 0.0
    try:
        return float(raw)
    except ValueError:
        return 0.0


def row_contains(row: pd.Series, keyword: str) -> bool:
    if not keyword:
        return False
    return any(keyword in text(value) for value in row.values)


def value(row: pd.Series, key: str) -> str:
    column = COLUMNS[key]
    return text(row[column]) if column in row else ""


def frame_to_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for raw in df.to_dict(orient="records"):
        records.append({str(key): text(value) for key, value in raw.items()})
    return records


def build_header(receipt_no: str, group: pd.DataFrame) -> dict[str, Any]:
    first = group.iloc[0]
    qty = round(sum(number(v) for v in group[COLUMNS["qty"]]))
    amount = round(sum(number(v) for v in group[COLUMNS["amount"]]), 4)
    status = value(first, "status")
    header = {str(key): text(val) for key, val in first.to_dict().items() if key != "__source_file"}
    header.update(
        {
            "io_id": receipt_no,
            "receiver_name_en": value(first, "supplier"),
            "o_id": value(first, "po"),
            "created": value(first, "created"),
            "io_date": value(first, "inbound"),
            "status": status,
            "f_status": "\u5df2\u5ba1\u6838" if status == "\u5df2\u5165\u5e93" else "",
            "wms_co_name": value(first, "warehouse_owner"),
            "warehouse": value(first, "warehouse"),
            "labels": value(first, "labels"),
            "remark": value(first, "remark"),
            "extend_remark": value(first, "remark2"),
            "total_qty": int(qty),
            "total_sku_ids": int(group[COLUMNS["sku"]].nunique()),
            "total_amount": amount,
            "returned_qty": value(first, "returned_qty"),
            "total_return_qty": value(first, "total_return_qty"),
            "logistics_company": value(first, "logistics"),
            "l_id": value(first, "tracking"),
            "creator_name": value(first, "creator"),
            "freight": value(first, "freight"),
            "operating_fee": value(first, "fee"),
            "archiver": value(first, "archiver"),
            "archived": value(first, "archived"),
            "supplier_code": value(first, "supplier_code"),
            "purchaser_name": value(first, "buyer"),
            "import_source_files": ",".join(sorted(set(group["__source_file"].astype(str)))),
            "line_count": int(len(group)),
        }
    )
    return header


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="+", help="Jushuitan purchase-in xlsx files")
    parser.add_argument("--exclude-keyword", default="", help="Drop rows containing this keyword in any column")
    parser.add_argument("--output-dir", default=".codex-tmp/jst-purchasein-xlsx-clean")
    args = parser.parse_args()

    frames: list[pd.DataFrame] = []
    source_stats: list[dict[str, Any]] = []
    for file_arg in args.files:
      path = Path(file_arg).expanduser().resolve()
      df = pd.read_excel(path, dtype=str).fillna("")
      missing = [name for name in (COLUMNS["receipt"], COLUMNS["sku"], COLUMNS["qty"], COLUMNS["status"]) if name not in df.columns]
      if missing:
          raise SystemExit(f"{path} is missing required columns: {missing}")
      excluded_mask = df.apply(lambda row: row_contains(row, args.exclude_keyword), axis=1)
      clean = df.loc[~excluded_mask].copy()
      clean["__source_file"] = path.name
      frames.append(clean)
      source_stats.append(
          {
              "file": path.name,
              "rows": int(len(df)),
              "receipts": int(df[COLUMNS["receipt"]].astype(str).str.strip().nunique()),
              "excludedRows": int(excluded_mask.sum()),
              "keptRows": int(len(clean)),
              "keptReceipts": int(clean[COLUMNS["receipt"]].astype(str).str.strip().nunique()),
              "keptStatusCounts": {str(k): int(v) for k, v in clean[COLUMNS["status"]].value_counts().items()},
          }
      )

    detail_df = pd.concat(frames, ignore_index=True)
    for key in ("receipt", "po", "sku", "supplier_code"):
        column = COLUMNS[key]
        if column in detail_df:
            detail_df[column] = detail_df[column].map(text)

    headers = [
        build_header(str(receipt_no), group)
        for receipt_no, group in detail_df.groupby(COLUMNS["receipt"], sort=False)
        if text(receipt_no)
    ]
    details = frame_to_records(detail_df.drop(columns=["__source_file"]))

    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    head_path = output_dir / f"jushuitan-purchasein-{len(headers)}.json"
    detail_path = output_dir / f"jushuitan-purchasein-detail-{len(details)}.json"
    head_path.write_text(json.dumps(headers, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    detail_path.write_text(json.dumps(details, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    summary = {
        "sourceStats": source_stats,
        "keptRows": len(details),
        "keptReceipts": len(headers),
        "statusCounts": {str(k): int(v) for k, v in detail_df[COLUMNS["status"]].value_counts().items()},
        "qty": int(round(sum(number(v) for v in detail_df[COLUMNS["qty"]]))),
        "amount": round(sum(number(v) for v in detail_df[COLUMNS["amount"]]), 2),
        "headFile": str(head_path),
        "detailFile": str(detail_path),
    }
    (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
