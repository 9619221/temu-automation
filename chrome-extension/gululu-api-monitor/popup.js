let latestEvents = [];

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function render(events, status) {
  latestEvents = events;
  const meta = document.getElementById("meta");
  const list = document.getElementById("list");
  meta.textContent = `已记录 ${events.length} 个唯一接口，最后更新：${status?.updatedAt || "-"}`;
  if (!events.length) {
    list.innerHTML = '<div class="empty">还没有记录。先让咕噜噜挂机页或 Temu 后台跑起来。</div>';
    return;
  }
  list.innerHTML = events.slice().reverse().slice(0, 80).map((event) => `
    <div class="item">
      <div class="url">${escapeHtml(event.method || "GET")} ${escapeHtml(event.url || "")}</div>
      <div class="line">状态：${escapeHtml(event.statusCode || event.error || "-")} ｜ 次数：${escapeHtml(event.seenCount || 1)} ｜ 类型：${escapeHtml(event.type || "-")}</div>
      <div class="line">发起：${escapeHtml(event.initiator || event.documentUrl || "-")}</div>
      <div class="line">BodyHash：${escapeHtml(event.requestBodyHash || "-")}</div>
    </div>
  `).join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function refresh() {
  const result = await sendMessage({ type: "GULULU_API_MONITOR_GET" });
  if (!result?.ok) throw new Error(result?.error || "读取失败");
  render(result.events || [], result.status || null);
}

function downloadJson() {
  const blob = new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(),
    events: latestEvents,
  }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gululu-api-monitor-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById("refresh").addEventListener("click", () => refresh().catch((error) => {
  document.getElementById("meta").textContent = error?.message || String(error);
}));
document.getElementById("export").addEventListener("click", downloadJson);
document.getElementById("clear").addEventListener("click", async () => {
  await sendMessage({ type: "GULULU_API_MONITOR_CLEAR" });
  await refresh();
});

refresh().catch((error) => {
  document.getElementById("meta").textContent = error?.message || String(error);
});
