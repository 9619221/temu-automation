import { useEffect } from "react";

/**
 * 顶部非阻塞细进度条。用于 warm 态后台刷新时的「正在更新」提示——
 * 替代全屏 <Spin>,不遮挡、不清屏(见 docs/frontend-response-cache-spec.md §4)。
 */

const KEYFRAMES_ID = "temu-top-progress-keyframes";

function ensureKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement("style");
  style.id = KEYFRAMES_ID;
  style.textContent = `@keyframes temu-top-progress {
    0% { left: -35%; width: 35%; }
    50% { left: 30%; width: 45%; }
    100% { left: 100%; width: 35%; }
  }`;
  document.head.appendChild(style);
}

export interface TopProgressBarProps {
  /** 是否显示。通常绑定 useCachedResource 的 isFetching。 */
  visible?: boolean;
  /** 进度条颜色,默认 antd 主蓝。 */
  color?: string;
  /** 进度条高度(px),默认 2。 */
  height?: number;
}

export function TopProgressBar({ visible = true, color = "#1677ff", height = 2 }: TopProgressBarProps) {
  useEffect(() => {
    ensureKeyframes();
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        height,
        width: "100%",
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          height,
          borderRadius: height,
          background: color,
          animation: "temu-top-progress 1.1s ease-in-out infinite",
        }}
      />
    </div>
  );
}

export default TopProgressBar;
