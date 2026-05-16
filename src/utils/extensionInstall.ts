const APP_SETTINGS_KEY = "temu_app_settings";
const DEFAULT_EXTENSION_PACKAGE_URL =
  "https://github.com/9619221/temu-automation/releases/download/v0.3.7/temu-collection-extension-v0.3.7.zip";

function getDefaultInstallUrl() {
  const env = (import.meta as any)?.env;
  return typeof env?.VITE_TEMU_EXTENSION_INSTALL_URL === "string"
    ? env.VITE_TEMU_EXTENSION_INSTALL_URL
    : "";
}

function getDefaultPackageUrl() {
  const env = (import.meta as any)?.env;
  return typeof env?.VITE_TEMU_EXTENSION_PACKAGE_URL === "string"
    ? env.VITE_TEMU_EXTENSION_PACKAGE_URL
    : DEFAULT_EXTENSION_PACKAGE_URL;
}

export function normalizeExtensionInstallUrl(raw: unknown) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export interface ExtensionInstallConfig {
  storeUrl: string;
  packageUrl: string;
}

export async function loadExtensionInstallUrl() {
  const cfg = await loadExtensionInstallConfig();
  return cfg.storeUrl;
}

export async function loadExtensionInstallConfig(): Promise<ExtensionInstallConfig> {
  try {
    const settings = await window.electronAPI?.store?.get(APP_SETTINGS_KEY);
    return {
      storeUrl: normalizeExtensionInstallUrl(settings?.extensionInstallUrl) || normalizeExtensionInstallUrl(getDefaultInstallUrl()),
      packageUrl: normalizeExtensionInstallUrl(settings?.extensionPackageUrl) || normalizeExtensionInstallUrl(getDefaultPackageUrl()),
    };
  } catch {
    return {
      storeUrl: normalizeExtensionInstallUrl(getDefaultInstallUrl()),
      packageUrl: normalizeExtensionInstallUrl(getDefaultPackageUrl()),
    };
  }
}

export async function openExternalUrl(url: string) {
  const normalized = normalizeExtensionInstallUrl(url);
  if (!normalized) throw new Error("链接无效");
  if (window.electronAPI?.app?.openExternal) {
    await window.electronAPI.app.openExternal(normalized);
    return;
  }
  window.open(normalized, "_blank", "noopener,noreferrer");
}
