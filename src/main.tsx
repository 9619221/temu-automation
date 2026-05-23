import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import { initFrontendLogger } from "./utils/frontendLogger";
import "./styles/tokens.css";
import "./styles/global.css";

initFrontendLogger().catch(() => {});

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char] || char));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message || error.name;
  return String(error || "未知启动错误");
}

function isRootVisiblyBlank(rootElement: HTMLElement) {
  const stableShell = rootElement.querySelector(
    ".app-layout-root, .erp-login-shell, .app-route-loading, .app-route-error, .app-access-denied",
  );
  if (stableShell) return false;
  return rootElement.children.length === 0 || rootElement.innerText.trim().length === 0;
}

function renderBootFailure(error: unknown, rootElement = document.getElementById("root")) {
  const target = rootElement || document.body;
  const detail = escapeHtml(getErrorMessage(error));
  target.innerHTML = `
    <div class="app-route-error" role="alert">
      <div class="app-route-error__panel">
        <span class="brand-mark-system app-route-loading__mark" aria-hidden="true" style="width:42px;height:42px;">
          <svg viewBox="0 0 64 64" width="42" height="42" role="presentation">
            <rect width="64" height="64" rx="14" fill="#111114"></rect>
            <path d="M18 19h28v7H35v23h-7V26H18z" fill="#fff"></path>
            <circle cx="46" cy="45" r="5" fill="#1a73e8"></circle>
          </svg>
        </span>
        <div class="app-route-error__title">桌面端没有完成渲染</div>
        <div class="app-route-error__desc">启动资源或页面模块加载失败。请先重新加载；如果仍然失败，关闭所有 Temu Ops 窗口后再启动。</div>
        <pre class="app-route-error__detail">${detail}</pre>
        <button type="button" class="app-route-error__button" onclick="window.location.reload()">重新加载</button>
      </div>
    </div>
  `;
}

function installBootGuards(rootElement: HTMLElement) {
  const recoverIfBlank = (error: unknown) => {
    window.setTimeout(() => {
      if (isRootVisiblyBlank(rootElement)) {
        renderBootFailure(error, rootElement);
      }
    }, 0);
  };

  window.addEventListener("error", (event) => recoverIfBlank(event.error || event.message));
  window.addEventListener("unhandledrejection", (event) => recoverIfBlank(event.reason));

  window.setTimeout(() => {
    if (isRootVisiblyBlank(rootElement)) {
      renderBootFailure(new Error("React 根节点启动后仍为空白"), rootElement);
    }
  }, 6000);
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  renderBootFailure(new Error("缺少 #root 挂载节点"));
  throw new Error("Missing #root element");
}

installBootGuards(rootElement);

try {
  rootElement.dataset.temuReactBoot = "starting";
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ConfigProvider
        locale={zhCN}
        theme={{
          token: {
            colorPrimary: "#1a73e8",
            colorSuccess: "#34a853",
            colorWarning: "#fbbc04",
            colorError: "#ea4335",
            colorInfo: "#1a73e8",
            borderRadius: 8,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
            fontSize: 16,
            colorBgContainer: "#ffffff",
            colorBgLayout: "#ffffff",
            colorText: "#202124",
            colorTextSecondary: "#5f6368",
            colorTextTertiary: "#80868b",
            colorBorder: "#dadce0",
            colorBorderSecondary: "#e8eaed",
            controlHeight: 38,
            controlOutline: "rgba(26, 115, 232, 0.18)",
            wireframe: false,
          },
          components: {
            Card: {
              paddingLG: 18,
              borderRadiusLG: 8,
            },
            Table: {
              borderRadiusLG: 8,
              headerBg: "#f8fbff",
              headerColor: "#5f6368",
              fontSize: 14,
              cellPaddingBlock: 12,
              cellPaddingInline: 12,
              rowHoverBg: "#fbfbfd",
            },
            Tag: {
              borderRadiusSM: 4,
            },
            Button: {
              borderRadius: 8,
              controlHeight: 38,
              controlHeightLG: 42,
            },
            Menu: {
              itemBorderRadius: 8,
              itemMarginInline: 8,
              itemHeight: 40,
              groupTitleFontSize: 12,
            },
            Statistic: {
              titleFontSize: 14,
              contentFontSize: 28,
            },
            Tabs: {
              cardGutter: 4,
              horizontalItemPadding: "10px 0",
            },
          },
        }}
      >
        <HashRouter>
          <App />
        </HashRouter>
      </ConfigProvider>
    </React.StrictMode>,
  );
  rootElement.dataset.temuReactBoot = "mounted";
} catch (error) {
  renderBootFailure(error, rootElement);
  console.error("[bootstrap] React render failed", error);
}
