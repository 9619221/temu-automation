function fmt(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function fmtRemaining(ms) {
  const seconds = Math.ceil(Math.max(0, Number(ms) || 0) / 1000);
  if (seconds <= 0) return "未开启";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `剩余 ${minutes}分${rest}秒` : `剩余 ${rest}秒`;
}

function setText(id, text, className = "value") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = className;
}

function refresh() {
  chrome.runtime.sendMessage({ type: "QUERY_STATUS" }, (resp) => {
    if (chrome.runtime.lastError || !resp) return;
    setText("cfg", resp.configured ? "已配置" : "未配置", `value ${resp.configured ? "ok" : "err"}`);

    const stats = resp.stats || {};
    setText("captured", String(stats.captured_count || 0));
    setText("sent", String(stats.total_sent || 0));
    setText("queue", resp.queueDepth >= 0 ? String(resp.queueDepth) : "?");
    setText("lastFlush", fmt(stats.last_flush_at));

    const result = stats.last_flush_result;
    if (!result) {
      setText("lastResult", "-");
    } else if (result.ok) {
      setText("lastResult", `成功 ${result.sent || 0} 条`, "value ok");
    } else {
      setText("lastResult", result.reason || "失败", "value err");
    }

    const jstOnce = resp.jstOnceCapture || {};
    setText("jstOnce", fmtRemaining(jstOnce.remainingMs), `value ${jstOnce.active ? "ok" : ""}`);
  });
}

document.getElementById("jstOnceBtn").addEventListener("click", () => {
  const btn = document.getElementById("jstOnceBtn");
  btn.disabled = true;
  btn.textContent = "正在开启...";
  chrome.runtime.sendMessage({ type: "START_JST_ONCE_CAPTURE", durationMs: 10 * 60 * 1000 }, () => {
    btn.disabled = false;
    btn.textContent = "开始本次聚水潭采集（10 分钟）";
    refresh();
  });
});

document.getElementById("flushBtn").addEventListener("click", () => {
  const btn = document.getElementById("flushBtn");
  btn.disabled = true;
  btn.textContent = "上报中...";
  chrome.runtime.sendMessage({ type: "FLUSH_NOW" }, () => {
    btn.disabled = false;
    btn.textContent = "立即上报";
    refresh();
  });
});

document.getElementById("optBtn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("reload").addEventListener("click", (event) => {
  event.preventDefault();
  refresh();
});

refresh();
setInterval(refresh, 2000);
