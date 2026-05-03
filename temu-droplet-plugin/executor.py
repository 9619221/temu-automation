#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Minimal droplet plugin skeleton.

Features:
1) Python entrypoint with CLI parameters.
2) Module dispatch for sales / activity / settlement / managed_compensation.
3) Unified artifact shape and single upload template.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from modules import (
    activity as activity_module,
    managed_compensation as managed_compensation_module,
    sales as sales_module,
    settlement as settlement_module,
)
from utils import uploader


LOGGER = logging.getLogger("temu-droplet-plugin")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _read_json_from_arg(raw: str) -> Dict[str, Any]:
    try:
        return json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"payload must be valid JSON: {exc}") from exc


def _read_payload_file(file_path: Optional[str]) -> Dict[str, Any]:
    if not file_path:
        return {}
    payload_path = Path(file_path)
    if not payload_path.exists():
        raise FileNotFoundError(f"payload file does not exist: {payload_path}")
    with payload_path.open("r", encoding="utf-8") as fp:
        text = fp.read().strip()
    if not text:
        return {}
    return _read_json_from_arg(text)


def _parse_modules(raw: str) -> List[str]:
    if not raw:
        return []
    names: List[str] = []
    for item in raw.split(","):
        item = item.strip().lower()
        if item and item not in names:
            names.append(item)
    return names


def _ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_json(path: Path, data: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fp:
        json.dump(data, fp, ensure_ascii=False, indent=2)


def _build_artifact_path(output_dir: Path, module_name: str, run_id: str, ext: str = "json") -> Path:
    return output_dir / f"{module_name}_{run_id}.{ext}"


def _build_artifact(module_name: str, run_id: str, result: Mapping[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = list(result.get("rows", []))
    business_type = str(result.get("businessType", "unknown"))
    rpa_type = str(result.get("rpaType", module_name))

    hints = list(result.get("hints", []))
    external_spec_id = context["params"].get("external_spec_id")
    if external_spec_id and external_spec_id not in hints:
        hints.append(f"external_spec_id={external_spec_id}")

    return {
        "run_id": run_id,
        "module": module_name,
        "businessType": business_type,
        "rpaType": rpa_type,
        "generatedAt": _now_iso(),
        "payload": context["params"],
        "meta": {
            "source": "temu-droplet-plugin",
            "count": len(rows),
            "external_spec_id": external_spec_id,
            "module_input": context.get("module_raw"),
        },
        "hints": hints,
        "data": rows,
    }


def _run_single_module(
    module_name: str,
    handler: Callable[[Dict[str, Any]], Dict[str, Any]],
    context: Dict[str, Any],
    output_dir: Path,
) -> Dict[str, Any]:
    LOGGER.info("Start module: %s", module_name)
    raw_result = handler(context)
    artifact = _build_artifact(module_name, context["run_id"], raw_result, context)
    artifact_path = _build_artifact_path(output_dir, module_name, context["run_id"], "json")
    _write_json(artifact_path, artifact)

    upload_result = uploader.upload_with_template(
        artifact_path=artifact_path,
        business_type=artifact["businessType"],
        rpa_type=artifact["rpaType"],
        run_id=context["run_id"],
        module_name=module_name,
        records_count=len(artifact["data"]),
    )

    return {
        "module": module_name,
        "artifact_path": str(artifact_path),
        "artifact": artifact,
        "upload": upload_result,
    }


def run_modules(module_names: List[str], context: Dict[str, Any]) -> Dict[str, Any]:
    output_dir = _ensure_dir(context["output_dir"])
    module_map: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {
        "sales": sales_module.run,
        "activity": activity_module.run,
        "settlement": settlement_module.run,
        "managed_compensation": managed_compensation_module.run,
    }

    if not module_names:
        raise ValueError("No module selected. Use one of: sales, activity, settlement, managed_compensation")

    results: List[Dict[str, Any]] = []
    for module_name in module_names:
        handler = module_map.get(module_name)
        if not handler:
            allowed = ", ".join(sorted(module_map.keys()))
            raise ValueError(f"Unknown module: {module_name}. Available: {allowed}")
        results.append(_run_single_module(module_name, handler, context, output_dir))

    return {
        "ok": True,
        "run_id": context["run_id"],
        "start_at": context["start_at"],
        "end_at": _now_iso(),
        "results": results,
    }


def parse_args(argv: Optional[Iterable[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Temu droplet plugin executor")
    parser.add_argument("--module", required=True, help="module name, support comma-separated list")
    parser.add_argument("--external-spec-id", dest="external_spec_id", help="external spec id, like upstream supplier specId")
    parser.add_argument("--payload", default="{}", help="job payload in JSON string")
    parser.add_argument("--payload-file", dest="payload_file", help="job payload JSON file")
    parser.add_argument("--out-dir", default="output", help="artifact output directory")
    parser.add_argument("--run-id", default=None, help="optional run_id, auto-generated by default")
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"], help="log level")
    return parser.parse_args(list(argv) if argv is not None else None)


def build_context(args: argparse.Namespace) -> Dict[str, Any]:
    payload_from_args = _read_json_from_arg(args.payload)
    payload_from_file = _read_payload_file(args.payload_file)
    merged_params = {**payload_from_file, **payload_from_args}

    if args.external_spec_id:
        merged_params.setdefault("external_spec_id", args.external_spec_id)

    run_id = args.run_id or uuid.uuid4().hex[:12]
    return {
        "run_id": run_id,
        "module_raw": args.module,
        "modules": _parse_modules(args.module),
        "params": merged_params,
        "output_dir": Path(args.out_dir).resolve(),
        "start_at": _now_iso(),
    }


def main(argv: Optional[Iterable[str]] = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(level=getattr(logging, args.log_level))
    LOGGER.setLevel(getattr(logging, args.log_level))
    context: Dict[str, Any] = {}
    try:
        context = build_context(args)
        LOGGER.info("run args: run_id=%s modules=%s", context["run_id"], context["modules"])
        result = run_modules(context["modules"], context)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        LOGGER.error("execute failed: %s", exc)
        payload = {
            "ok": False,
            "run_id": context.get("run_id"),
            "error": str(exc),
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
