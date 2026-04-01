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
          colorPrimary: "#e55b00",
          colorSuccess: "#00b96b",
          colorWarning: "#faad14",
          colorError: "#ff4d4f",
          colorInfo: "#1677ff",
          borderRadius: 12,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
          fontSize: 14,
          colorBgContainer: "#ffffff",
          colorBgLayout: "#f7f8fa",
          colorText: "#1a1a2e",
          colorTextSecondary: "#8c8c8c",
          controlHeight: 40,
        },
        components: {
          Card: {
            paddingLG: 20,
            borderRadiusLG: 16,
          },
          Table: {
            borderRadiusLG: 10,
            headerBg: "#fafafa",
            headerColor: "#595959",
            fontSize: 13,
          },
          Tag: {
            borderRadiusSM: 4,
          },
          Button: {
            borderRadius: 10,
            controlHeight: 40,
            controlHeightLG: 44,
          },
          Menu: {
            itemBorderRadius: 10,
            itemMarginInline: 8,
            itemHeight: 44,
          },
          Statistic: {
            titleFontSize: 13,
            contentFontSize: 28,
          },
          Tabs: {
            cardGutter: 4,
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
