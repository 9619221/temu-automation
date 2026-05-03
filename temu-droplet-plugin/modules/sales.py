from __future__ import annotations

from typing import Any, Dict


def run(context: Dict[str, Any]) -> Dict[str, Any]:
    params = context.get("params", {})
    external_spec_id = params.get("external_spec_id")
    run_tag = context.get("run_id")

    rows = [
        {
            "record_type": "sales",
            "external_spec_id": external_spec_id,
            "sku": params.get("sku", "sku-demo-001"),
            "order_no": params.get("order_no", "SO-0001"),
            "sales_qty": params.get("sales_qty", 18),
            "sales_amt": params.get("sales_amt", 2599.00),
            "run_id": run_tag,
            "source": "stub",
        }
    ]

    return {
        "businessType": "sales_data",
        "rpaType": "sales",
        "rows": rows,
        "hints": [
            "sales module stub: replace rows with your real API call for order sales data.",
            "works as placeholder data for local smoke test.",
        ],
    }
