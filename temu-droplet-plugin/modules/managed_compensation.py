from __future__ import annotations

from typing import Any, Dict


def run(context: Dict[str, Any]) -> Dict[str, Any]:
    params = context.get("params", {})
    external_spec_id = params.get("external_spec_id")
    run_tag = context.get("run_id")

    rows = [
        {
            "record_type": "managed_compensation",
            "external_spec_id": external_spec_id,
            "claim_id": params.get("claim_id", "COMP-001"),
            "sku": params.get("sku", "sku-demo-001"),
            "status": params.get("comp_status", "pending"),
            "amount": params.get("amount", 12.34),
            "run_id": run_tag,
            "source": "stub",
        }
    ]

    return {
        "businessType": "compensation_data",
        "rpaType": "managed_compensation",
        "rows": rows,
        "hints": [
            "managed compensation stub: replace rows with API data for after-sale claim compensation.",
            "integrates cleanly with rpaType=managed_compensation downstream.",
        ],
    }
