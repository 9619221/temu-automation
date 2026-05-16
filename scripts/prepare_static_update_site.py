from __future__ import annotations

import shutil
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parents[1]
RELEASE_DIR = ROOT / "release"
SITE_DIR = ROOT / "deploy" / "static-update-site"
SITE_RELEASES_DIR = SITE_DIR / "releases"
INDEX_FILE = SITE_DIR / "index.html"


def installer_name_from_update_path(value: str) -> str:
    raw = value.strip().strip("\"'")
    parsed = urlparse(raw)
    if parsed.scheme in {"http", "https"}:
        return Path(unquote(parsed.path)).name
    return Path(raw.replace("\\", "/")).name


def find_latest_installer() -> Path:
    latest_yml = RELEASE_DIR / "latest.yml"
    if latest_yml.exists():
        for line in latest_yml.read_text(encoding="utf-8").splitlines():
            if line.startswith("path: "):
                installer_name = installer_name_from_update_path(line.split("path: ", 1)[1])
                installer = RELEASE_DIR / installer_name
                if installer.exists():
                    return installer

    installers = sorted(
        [p for p in RELEASE_DIR.glob("*.exe") if not p.name.endswith(".blockmap")],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not installers:
        raise FileNotFoundError("未找到安装包，请先执行 npm run dist:win")
    return installers[0]


def copy_required_files(installer: Path) -> tuple[Path, Path, Path]:
    latest_yml = RELEASE_DIR / "latest.yml"
    blockmap = RELEASE_DIR / f"{installer.name}.blockmap"

    if not latest_yml.exists():
        raise FileNotFoundError("未找到 latest.yml，请先执行 npm run dist:win")
    if not blockmap.exists():
        raise FileNotFoundError(f"未找到 {blockmap.name}，请先执行 npm run dist:win")

    SITE_RELEASES_DIR.mkdir(parents=True, exist_ok=True)

    latest_target = SITE_RELEASES_DIR / latest_yml.name
    installer_target = SITE_RELEASES_DIR / installer.name
    blockmap_target = SITE_RELEASES_DIR / blockmap.name

    latest_content = latest_yml.read_text(encoding="utf-8")
    latest_content = latest_content.replace(
        next((line for line in latest_content.splitlines() if line.strip().startswith("- url:")), f"  - url: {installer.name}"),
        f"  - url: {installer.name}",
        1,
    )
    latest_content = latest_content.replace(
        next((line for line in latest_content.splitlines() if line.startswith("path: ")), f"path: {installer.name}"),
        f"path: {installer.name}",
        1,
    )
    latest_target.write_text(latest_content if latest_content.endswith("\n") else f"{latest_content}\n", encoding="utf-8")
    shutil.copy2(installer, installer_target)
    shutil.copy2(blockmap, blockmap_target)

    return latest_target, installer_target, blockmap_target


def extract_version(installer_name: str) -> str:
    prefix = "temu-automation-setup-"
    suffix = ".exe"
    if installer_name.startswith(prefix) and installer_name.endswith(suffix):
        return installer_name[len(prefix):-len(suffix)]
    return "unknown"


def write_index(installer_name: str, version: str) -> None:
    html = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Temu 自动化运营工具更新源</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #fff7f0;
      --panel: #ffffff;
      --line: #ffd9bf;
      --brand: #ff6a00;
      --brand-deep: #d95500;
      --text: #1f2329;
      --muted: #6b7280;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      background: linear-gradient(180deg, #fff7f0 0%, #fff 100%);
      color: var(--text);
    }}
    .wrap {{
      max-width: 880px;
      margin: 48px auto;
      padding: 0 24px;
    }}
    .hero {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 28px 32px;
      box-shadow: 0 18px 48px rgba(255, 106, 0, 0.08);
    }}
    .badge {{
      display: inline-block;
      padding: 6px 12px;
      border-radius: 999px;
      background: rgba(255, 106, 0, 0.12);
      color: var(--brand-deep);
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 14px;
    }}
    h1 {{
      margin: 0 0 10px;
      font-size: 34px;
      line-height: 1.2;
    }}
    p {{
      margin: 0;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.7;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-top: 24px;
    }}
    .card {{
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 18px;
    }}
    .label {{
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 8px;
    }}
    .value {{
      font-size: 24px;
      font-weight: 700;
      color: var(--text);
    }}
    .actions {{
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 24px;
    }}
    .btn {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 180px;
      padding: 12px 18px;
      border-radius: 12px;
      text-decoration: none;
      font-weight: 700;
    }}
    .btn-primary {{
      background: var(--brand);
      color: #fff;
    }}
    .btn-secondary {{
      background: #fff;
      color: var(--brand-deep);
      border: 1px solid var(--line);
    }}
    .hint {{
      margin-top: 18px;
      font-size: 13px;
      color: var(--muted);
    }}
    code {{
      background: #fff4eb;
      border-radius: 8px;
      padding: 2px 6px;
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <div class="badge">Temu Desktop Updates</div>
      <h1>Temu 自动化运营工具更新源</h1>
      <p>这是给桌面客户端使用的静态更新站点模板。客户端中的更新源地址应填写为 <code>https://your-domain.com/releases/</code> 这种目录地址。</p>

      <div class="grid">
        <div class="card">
          <div class="label">当前版本</div>
          <div class="value">{version}</div>
        </div>
        <div class="card">
          <div class="label">安装包文件</div>
          <div class="value" style="font-size:16px; word-break: break-all;">{installer_name}</div>
        </div>
      </div>

      <div class="actions">
        <a class="btn btn-primary" href="./releases/{installer_name}">下载安装包</a>
        <a class="btn btn-secondary" href="./releases/latest.yml">查看 latest.yml</a>
      </div>

      <div class="hint">
        如果你要给客户端配置自动更新，设置中的更新源地址应指向 <code>/releases/</code> 目录，而不是当前这个首页。
      </div>
    </section>
  </div>
</body>
</html>
"""
    INDEX_FILE.parent.mkdir(parents=True, exist_ok=True)
    INDEX_FILE.write_text(html, encoding="utf-8")


def write_readme(version: str, installer_name: str) -> None:
    readme = SITE_DIR / "README.md"
    content = f"""# Static Update Site

这是静态更新站点模板目录。

## 当前打包版本

- 版本：`{version}`
- 安装包：`releases/{installer_name}`

## 目录说明

- `index.html`
  用于人工访问和下载的首页
- `releases/latest.yml`
  给桌面客户端自动更新读取
- `releases/*.exe`
  Windows 安装包
- `releases/*.blockmap`
  差量更新元数据

## 客户端填写地址

不要填首页地址，客户端应填写：

```text
https://your-domain.com/releases/
```

## 部署方法

把整个 `static-update-site` 目录上传到静态站点根目录即可。
"""
    readme.write_text(content, encoding="utf-8")


def main() -> None:
    installer = find_latest_installer()
    version = extract_version(installer.name)
    copy_required_files(installer)
    write_index(installer.name, version)
    write_readme(version, installer.name)
    print(f"Prepared static update site at {SITE_DIR}")


if __name__ == "__main__":
    main()
