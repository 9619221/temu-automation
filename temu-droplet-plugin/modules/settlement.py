from __future__ import annotations

from typing import Any, Dict


def run(context: Dict[str, Any]) -> Dict[str, Any]:
    params = context.get("params", {})
    external_spec_id = params.get("external_spec_id")
    run_tag = context.get("run_id")

    rows = [
        {
            "record_type": "settlement",
            "external_spec_id": external_spec_id,
            "statement_id": params.get("statement_id", "ST-001"),
            "period": params.get("period", "2026-05"),
            "payable": params.get("payable", 888.88),
            "currency": params.get("currency", "CNY"),
            "run_id": run_tag,
            "source": "stub",
        }
    ]

    return {
        "businessType": "finance_data",
        "rpaType": "settlement",
        "rows": rows,
        "hints": [
            "settlement module stub: replace rows with settlement API response and accounting mapping.",
            "keeps a stable schema for future settlement imports.",
        ],
    }
