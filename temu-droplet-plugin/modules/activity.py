from __future__ import annotations

from typing import Any, Dict


def run(context: Dict[str, Any]) -> Dict[str, Any]:
    params = context.get("params", {})
    external_spec_id = params.get("external_spec_id")
    run_tag = context.get("run_id")

    rows = [
        {
            "record_type": "activity",
            "external_spec_id": external_spec_id,
            "activity_id": params.get("activity_id", "ACT-001"),
            "activity_name": params.get("activity_name", "example promotion"),
            "status": params.get("status", "active"),
            "run_id": run_tag,
            "source": "stub",
        }
    ]

    return {
        "businessType": "marketing_data",
        "rpaType": "activity",
        "rows": rows,
        "hints": [
            "activity module stub: replace rows with campaign API results.",
            "expose only fields needed by downstream rpaType=activity workflows.",
        ],
    }
