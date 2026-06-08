import { useEffect, useState } from "react";

/**
 * 防抖值：value 变化后等待 delayMs 才更新返回值。
 *
 * 用于「打字即过滤」的搜索框：把高频变化的输入框 state 与昂贵的 filter/重渲染解耦，
 * 大列表下避免逐字符触发整表重算。输入框仍绑原始 state（保持跟手），filter 用防抖值。
 *
 * 用法：
 *   const [keyword, setKeyword] = useState("");
 *   const debouncedKeyword = useDebouncedValue(keyword, 250);
 *   const filtered = useMemo(() => rows.filter(r => match(r, debouncedKeyword)), [rows, debouncedKeyword]);
 *   <Input value={keyword} onChange={e => setKeyword(e.target.value)} />
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
