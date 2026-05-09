function $(id) {
  return document.getElementById(id);
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

async function refreshStatus() {
  const status = await sendMessage({ type: "TEMU_PATROL_STATUS" }).catch((error) => ({
    ok: false,
    error: error?.message || String(error),
  }));
  $("templateCount").textContent = status?.ok ? String(status.templateCount || 0) : "读取失败";
  const background = status?.backgroundStatus || {};
  $("running").textContent = background.running ? "采集中" : "待命";
  $("lastUpload").textContent = formatTime(status?.lastUpload?.uploadedAt || status?.lastUpload?.failedAt);
  $("counts").textContent = `${Number(background.successCount || 0)} / ${Number(background.failCount || 0)}`;
}

async function collectNow() {
  $("running").textContent = "启动中";
  await sendMessage({ type: "TEMU_PATROL_START_BACKGROUND_COLLECTION", reason: "popup" });
  await refreshStatus();
}

async function clearTemplates() {
  await sendMessage({ type: "TEMU_PATROL_CLEAR_TEMPLATES" });
  await refreshStatus();
}

function openKeepalive() {
  chrome.tabs.create({ url: chrome.runtime.getURL("keepalive.html"), active: true });
}

$("collectNow").addEventListener("click", collectNow);
$("openKeepalive").addEventListener("click", openKeepalive);
$("refresh").addEventListener("click", refreshStatus);
$("clearTemplates").addEventListener("click", clearTemplates);
refreshStatus();
