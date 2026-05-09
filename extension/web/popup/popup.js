function fmt(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function refresh() {
  chrome.runtime.sendMessage({ type: "QUERY_STATUS" }, (resp) => {
    if (chrome.runtime.lastError || !resp) return;
    const cfgEl = document.getElementById("cfg");
    cfgEl.textContent = resp.configured ? "已配置" : "未配置";
    cfgEl.className = "value " + (resp.configured ? "ok" : "err");

    const stats = resp.stats || {};
    document.getElementById("captured").textContent = stats.captured_count || 0;
    document.getElementById("sent").textContent = stats.total_sent || 0;
    document.getElementById("queue").textContent = resp.queueDepth >= 0 ? resp.queueDepth : "?";
    document.getElementById("lastFlush").textContent = fmt(stats.last_flush_at);

    const r = stats.last_flush_result;
    const el = document.getElementById("lastResult");
    if (!r) { el.textContent = "—"; el.className = "value"; }
    else if (r.ok) { el.textContent = `✓ ${r.sent || 0} 条`; el.className = "value ok"; }
    else { el.textContent = r.reason || "失败"; el.className = "value err"; }

    const malls = (resp.malls || []).filter((m) => m && m.mallId);
    document.getElementById("mallCount").textContent = malls.length;
    const listEl = document.getElementById("mallList");
    if (!malls.length) {
      listEl.innerHTML = '<div class="empty">尚未识别到店铺，打开 Temu 后台让 userInfo 接口被拦截</div>';
    } else {
      listEl.innerHTML = malls
        .map(
          (m) =>
            `<div class="mall-item"><b>${escapeHtml(m.mallName || m.mallId)}</b> · ${escapeHtml(m.site || "")} · <code>${escapeHtml(m.mallId)}</code></div>`
        )
        .join("");
    }
  });
}

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

document.getElementById("reload").addEventListener("click", (e) => {
  e.preventDefault();
  refresh();
});

refresh();
setInterval(refresh, 2000);
