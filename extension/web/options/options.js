const $ = (id) => document.getElementById(id);

function showBanner(text, ok) {
  const b = $("banner");
  b.textContent = text;
  b.className = ok ? "ok-banner" : "err-banner";
  setTimeout(() => { b.textContent = ""; b.className = ""; }, 4000);
}

function load() {
  chrome.storage.local.get(["cloud_endpoint", "auth_token", "device_id"], (v) => {
    $("cloud_endpoint").value = v.cloud_endpoint || "";
    $("auth_token").value = v.auth_token || "";
    $("device_id").value = v.device_id || "";
  });
}

$("save").addEventListener("click", () => {
  const cloud_endpoint = $("cloud_endpoint").value.trim().replace(/\/$/, "");
  const auth_token = $("auth_token").value.trim();
  if (!cloud_endpoint || !auth_token) {
    showBanner("请填写 URL 和 Token", false);
    return;
  }
  // 本地开发允许 http://localhost / 127.0.0.1，其他要求 https
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(cloud_endpoint);
  if (!isLocal && !/^https:\/\//.test(cloud_endpoint)) {
    showBanner("生产环境 URL 必须是 https://（本地 localhost / 127.0.0.1 可用 http）", false);
    return;
  }
  chrome.storage.local.set({ cloud_endpoint, auth_token }, () => {
    showBanner("已保存", true);
  });
});

$("test").addEventListener("click", async () => {
  const url = $("cloud_endpoint").value.trim().replace(/\/$/, "");
  const token = $("auth_token").value.trim();
  if (!url || !token) { showBanner("先填 URL 和 Token", false); return; }
  try {
    const resp = await fetch(url + "/api/ingest/v1/health", {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (resp.ok) showBanner(`连通成功（HTTP ${resp.status}）`, true);
    else showBanner(`HTTP ${resp.status}`, false);
  } catch (e) {
    showBanner("连接失败：" + String(e).slice(0, 100), false);
  }
});

$("purge").addEventListener("click", () => {
  if (!confirm("确认清空当前待上报队列？已抓未发的数据会丢失。")) return;
  // 走 SW，因 IndexedDB 在 SW 上下文打开
  chrome.runtime.sendMessage({ type: "FLUSH_NOW" }); // 触发一次后再清更稳
  // 直接打开 IndexedDB 删（options 页同 origin 可访问）
  const req = indexedDB.deleteDatabase("temu-monitor");
  req.onsuccess = () => showBanner("队列已清空", true);
  req.onerror = () => showBanner("清空失败", false);
});

load();
