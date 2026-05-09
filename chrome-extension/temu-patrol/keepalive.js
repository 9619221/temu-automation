function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN");
}

async function refreshStatus() {
  const status = await chrome.runtime.sendMessage({ type: "TEMU_PATROL_STATUS" }).catch((error) => ({
    ok: false,
    error: error?.message || String(error),
  }));
  const statusText = document.getElementById("statusText");
  const metaText = document.getElementById("metaText");
  if (!status?.ok) {
    statusText.textContent = "状态读取失败";
    metaText.textContent = status?.error || "请重新加载扩展";
    return;
  }
  const background = status.backgroundStatus || {};
  statusText.textContent = background.running ? "正在后台采集 · 无需操作" : "正在运行 · 每天 09:00 自动采集";
  const lastUploadAt = status.lastUpload?.uploadedAt || status.lastUpload?.failedAt || "";
  metaText.textContent = `已学习 ${status.templateCount || 0} 个接口模板，最近上传：${formatTime(lastUploadAt)}`;
}

refreshStatus();
setInterval(refreshStatus, 5000);
