import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

export interface SessionStateOptions<T> {
  /** 写入前把值转成可 JSON 序列化的形式（如 dayjs → ISO 字符串）。 */
  serialize?: (value: T) => unknown;
  /** 读取后把 JSON 解析结果还原为运行时值（如 ISO 字符串 → dayjs）。 */
  deserialize?: (raw: unknown) => T;
}

/**
 * 会话级持久化 state：用法与 useState 完全一致，但额外把值写进 sessionStorage，
 * 让用户在「切到别的页面再切回同一个页面」时保留筛选 / 状态标签 / 分页等视图状态。
 *
 * 生命周期：与浏览器 / Electron 窗口会话绑定 —— 页内来回切换、甚至重新加载页面都保持，
 * 「关闭并重启软件」后自动清空，回到 initialValue（满足「重启后回到默认」的诉求）。
 *
 * 对 dayjs / Map 等不可直接 JSON 序列化的值，传入 options.serialize / deserialize 做转换；
 * 纯字符串 / 数字 / 布尔 / 普通对象数组无需 options。
 *
 * key 命名约定：`temu.<page>.<area?>.<field>`，务必全局唯一，避免不同页面互相覆盖。
 */
export function useSessionState<T>(
  key: string,
  initialValue: T | (() => T),
  options?: SessionStateOptions<T>,
): [T, Dispatch<SetStateAction<T>>] {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [state, setState] = useState<T>(() => {
    const fallback =
      typeof initialValue === "function" ? (initialValue as () => T)() : initialValue;
    return readSessionState<T>(key, fallback, options);
  });

  // 用 ref 持有最新 key，写回时以最新 key 为准（本项目 key 多为常量，稳妥起见）。
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    writeSessionState(keyRef.current, state, optionsRef.current);
  }, [state]);

  return [state, setState];
}

export function readSessionState<T>(
  key: string,
  fallback: T,
  options?: SessionStateOptions<T>,
): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return options?.deserialize ? options.deserialize(parsed) : (parsed as T);
  } catch {
    return fallback;
  }
}

export function writeSessionState<T>(
  key: string,
  value: T,
  options?: SessionStateOptions<T>,
): void {
  if (typeof window === "undefined") return;
  try {
    const toStore = options?.serialize ? options.serialize(value) : value;
    window.sessionStorage.setItem(key, JSON.stringify(toStore));
  } catch {
    // 会话级视图记忆仅为便利能力，写失败（隐私模式 / 配额）直接忽略，不影响页面功能。
  }
}
