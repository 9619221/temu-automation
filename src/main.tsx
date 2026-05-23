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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#007aff",
          colorSuccess: "#34c759",
          colorWarning: "#ff9f0a",
          colorError: "#ff3b30",
          colorInfo: "#007aff",
          borderRadius: 8,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
          fontSize: 16,
          colorBgContainer: "#ffffff",
          colorBgLayout: "#f5f5f7",
          colorText: "#1d1d1f",
          colorTextSecondary: "#6e6e73",
          colorTextTertiary: "#86868b",
          colorBorder: "rgba(60, 60, 67, 0.12)",
          colorBorderSecondary: "rgba(60, 60, 67, 0.10)",
          controlHeight: 38,
          controlOutline: "rgba(0, 122, 255, 0.18)",
          wireframe: false,
        },
        components: {
          Card: {
            paddingLG: 18,
            borderRadiusLG: 8,
          },
          Table: {
            borderRadiusLG: 8,
            headerBg: "#f5f5f7",
            headerColor: "#6e6e73",
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
  </React.StrictMode>
);
