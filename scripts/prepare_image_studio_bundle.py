from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "build" / "auto-image-gen-runtime"
BOOTSTRAP_CONTENT = """const fs = require('fs');
const path = require('path');
const Module = require('module');

const packagedNodeModules = path.join(__dirname, 'node_modules');
const legacyRuntimeNodeModules = path.join(__dirname, 'runtime_node_modules');

// Older bundles renamed node_modules to runtime_node_modules, which breaks ESM package resolution.
// Recreate a standard node_modules path when possible so dynamic imports inside Next routes keep working.
if (!fs.existsSync(packagedNodeModules) && fs.existsSync(legacyRuntimeNodeModules)) {
  try {
    fs.symlinkSync(legacyRuntimeNodeModules, packagedNodeModules, 'junction');
  } catch {}
}

const moduleRoots = [packagedNodeModules, legacyRuntimeNodeModules].filter((item) => fs.existsSync(item));
const existingNodePath = process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : [];
const mergedNodePath = [...moduleRoots, ...existingNodePath.filter(Boolean)].filter((item, index, list) => list.indexOf(item) === index);
if (mergedNodePath.length > 0) {
  process.env.NODE_PATH = mergedNodePath.join(path.delimiter);
  Module._initPaths();
}

require('./server.js');
"""


def get_source_candidates() -> list[Path]:
    env_candidate = os.environ.get("AUTO_IMAGE_GEN_DIR", "").strip()
    raw_candidates = [
        Path(env_candidate) if env_candidate else None,
        ROOT / "auto-image-gen-dev",
        ROOT.parent / "auto-image-gen-dev",
        Path.cwd() / "auto-image-gen-dev",
        Path.cwd().parent / "auto-image-gen-dev",
    ]
    candidates: list[Path] = []
    seen: set[str] = set()
    for candidate in raw_candidates:
        if candidate is None:
            continue
        normalized = candidate.expanduser().resolve()
        key = str(normalized)
        if key in seen:
            continue
        seen.add(key)
        candidates.append(normalized)
    return candidates


def resolve_source_dir() -> Path:
    candidates = get_source_candidates()
    for candidate in candidates:
        if (candidate / "package.json").exists():
            return candidate
    searched = "\n".join(f" - {candidate}" for candidate in candidates)
    raise SystemExit(
        "未找到 AI 出图项目目录。请设置 AUTO_IMAGE_GEN_DIR，或确认以下目录之一存在完整项目：\n"
        f"{searched}"
    )


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def copy_tree(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def copy_file(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    ensure_dir(dst.parent)
    shutil.copy2(src, dst)


def reset_output_dir(path: Path) -> set[str]:
    if not path.exists():
        return set()

    try:
        shutil.rmtree(path)
        return set()
    except PermissionError:
        preserved_names: set[str] = set()
        runtime_node_modules = path / "runtime_node_modules"
        if runtime_node_modules.exists():
            preserved_names.add("runtime_node_modules")
        node_modules_link = path / "node_modules"
        if node_modules_link.exists():
            preserved_names.add("node_modules")

        for child in list(path.iterdir()):
            if child.name in preserved_names:
                continue
            if child.is_symlink():
                child.unlink()
            elif child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()

        return preserved_names


def main() -> None:
    source = resolve_source_dir()

    subprocess.run(["cmd", "/c", "npm", "run", "build"], cwd=source, check=True)

    standalone_root = source / ".next" / "standalone"
    standalone_server = standalone_root / "server.js"
    static_root = source / ".next" / "static"
    public_root = source / "public"

    if not standalone_server.exists():
        raise SystemExit(f"未生成 Next standalone 产物: {standalone_server}")

    preserved_names = reset_output_dir(OUTPUT)
    ensure_dir(OUTPUT)

    # standalone 根目录本身就是一个可启动运行时，直接复制其内容。
    for child in standalone_root.iterdir():
      target_name = "runtime_node_modules" if child.name == "node_modules" else child.name
      target = OUTPUT / target_name
      if target_name in preserved_names and target.exists():
        print(f"Reusing locked runtime directory: {target}")
        continue
      if child.is_dir():
        shutil.copytree(child, target)
      else:
        ensure_dir(target.parent)
        shutil.copy2(child, target)

    copy_tree(static_root, OUTPUT / ".next" / "static")
    copy_tree(public_root, OUTPUT / "public")
    copy_file(source / ".env.local", OUTPUT / ".env.local")
    copy_tree(source / "data", OUTPUT / "data")
    (OUTPUT / "bootstrap.cjs").write_text(BOOTSTRAP_CONTENT, encoding="utf-8")

    print(f"Prepared AI image runtime at: {OUTPUT} (source: {source})")


if __name__ == "__main__":
    main()
