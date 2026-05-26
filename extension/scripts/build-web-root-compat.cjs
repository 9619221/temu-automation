#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const EXT_ROOT = path.resolve(__dirname, "..");
const WEB_ROOT = path.join(EXT_ROOT, "web");
const MANIFEST_PATH = path.join(EXT_ROOT, "manifest.json");
const RULES_PATH = path.join(EXT_ROOT, "rules.json");

function stripWebPrefix(value) {
  return typeof value === "string" ? value.replace(/^web\//, "") : value;
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const webManifest = {
    ...manifest,
    background: {
      ...(manifest.background || {}),
      service_worker: stripWebPrefix(manifest.background?.service_worker),
    },
    content_scripts: (manifest.content_scripts || []).map((script) => ({
      ...script,
      js: (script.js || []).map(stripWebPrefix),
    })),
    action: {
      ...(manifest.action || {}),
      default_popup: stripWebPrefix(manifest.action?.default_popup),
      default_icon: Object.fromEntries(
        Object.entries(manifest.action?.default_icon || {}).map(([size, iconPath]) => [size, stripWebPrefix(iconPath)]),
      ),
    },
    options_page: stripWebPrefix(manifest.options_page),
    web_accessible_resources: (manifest.web_accessible_resources || []).map((resource) => ({
      ...resource,
      resources: (resource.resources || []).map(stripWebPrefix),
    })),
  };

  fs.mkdirSync(WEB_ROOT, { recursive: true });
  fs.writeFileSync(path.join(WEB_ROOT, "manifest.json"), `${JSON.stringify(webManifest, null, 2)}\n`, "utf8");
  fs.copyFileSync(RULES_PATH, path.join(WEB_ROOT, "rules.json"));
  console.log("[extension] wrote web-root compatibility manifest");
}

main();
