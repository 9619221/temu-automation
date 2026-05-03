from __future__ import annotations

import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

LOGGER = logging.getLogger("temu-droplet-plugin.uploader")

try:
    import requests
except Exception:
    requests = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _read_payload() -> Dict[str, str]:
    """Read uploader env config."""
    return {
        "url": os.getenv("DROPLET_UPLOAD_URL", "").strip(),
        "token": os.getenv("DROPLET_UPLOAD_TOKEN", "").strip(),
        "timeout": os.getenv("DROPLET_UPLOAD_TIMEOUT", "20").strip(),
        "fallback_dir": os.getenv("DROPLET_FALLBACK_DIR", "output/uploaded").strip(),
        "project": os.getenv("DROPLET_PROJECT", "temu-automation"),
    }


def _fallback_local(artifact_path: Path, fallback_dir: str, run_id: str) -> Dict[str, Any]:
    dst_dir = Path(fallback_dir).expanduser().resolve()
    dst_dir.mkdir(parents=True, exist_ok=True)
    target = dst_dir / f"{run_id}_{artifact_path.name}"
    shutil.copy2(artifact_path, target)
    LOGGER.warning("Local fallback save success: %s", target)
    return {
        "ok": True,
        "mode": "local",
        "path": str(target),
        "time": _now_iso(),
    }


def _post_to_cloud(
    artifact_path: Path,
    business_type: str,
    rpa_type: str,
    run_id: str,
    module_name: str,
    records_count: int,
    cfg: Dict[str, str],
) -> Optional[Dict[str, Any]]:
    if requests is None:
        LOGGER.error("requests is not installed, cloud upload skipped")
        return None
    if not cfg["url"] or not cfg["token"]:
        LOGGER.info("Cloud upload env not configured, fallback to local")
        return None

    try:
        timeout = int(cfg["timeout"] or 20)
    except ValueError:
        timeout = 20

    headers = {"Authorization": f"Bearer {cfg['token']}"}
    data = {
        "project": cfg["project"],
        "businessType": business_type,
        "rpaType": rpa_type,
        "module": module_name,
        "runId": run_id,
        "recordsCount": str(records_count),
        "timestamp": _now_iso(),
    }

    try:
        with artifact_path.open("rb") as fp:
            files = {"file": (artifact_path.name, fp, "application/json")}
            resp = requests.post(cfg["url"], headers=headers, data=data, files=files, timeout=timeout)
        try:
            payload = resp.json()
        except Exception:
            payload = {"raw": resp.text[:1000]}

        if 200 <= resp.status_code < 300:
            return {
                "ok": True,
                "mode": "cloud",
                "status_code": resp.status_code,
                "response": payload,
                "time": _now_iso(),
            }

        LOGGER.warning("Cloud returned non-success code: %s %s", resp.status_code, payload)
    except Exception as exc:
        LOGGER.exception("Cloud upload failed: %s", exc)
        return {
            "ok": False,
            "mode": "cloud",
            "error": str(exc),
            "time": _now_iso(),
        }

    return {
        "ok": False,
        "mode": "cloud",
        "status_code": getattr(resp, "status_code", None),
        "response": payload if "payload" in locals() else None,
        "time": _now_iso(),
    }


def upload_with_template(
    artifact_path: Path,
    business_type: str,
    rpa_type: str,
    run_id: str,
    module_name: str,
    records_count: int = 0,
) -> Dict[str, Any]:
    """
    Unified upload template:
    - Try cloud upload first
    - On failure or no config, fallback to local path
    """
    artifact_path = Path(artifact_path).resolve()
    cfg = _read_payload()
    cloud_result = _post_to_cloud(
        artifact_path=artifact_path,
        business_type=business_type,
        rpa_type=rpa_type,
        run_id=run_id,
        module_name=module_name,
        records_count=records_count,
        cfg=cfg,
    )

    if cloud_result and cloud_result.get("ok"):
        return cloud_result

    if cloud_result:
        LOGGER.warning("Cloud upload not successful, fallback local: %s", json.dumps(cloud_result, ensure_ascii=False)[:500])

    return _fallback_local(artifact_path, cfg["fallback_dir"], run_id)

