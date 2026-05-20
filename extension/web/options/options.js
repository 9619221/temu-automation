const $ = (id) => document.getElementById(id);

function showBanner(text, ok) {
  const banner = $("banner");
  banner.textContent = text;
  banner.className = ok ? "ok-banner" : "err-banner";
  setTimeout(() => {
    banner.textContent = "";
    banner.className = "";
  }, 4000);
}

function load() {
  chrome.storage.local.get(["cloud_endpoint", "auth_token", "device_id"], (value) => {
    $("cloud_endpoint").value = value.cloud_endpoint || "http://127.0.0.1:19380";
    $("auth_token").value = value.auth_token || "temu-jst-extension-v1";
    $("device_id").value = value.device_id || "";
  });
}

$("save").addEventListener("click", () => {
  const cloud_endpoint = $("cloud_endpoint").value.trim().replace(/\/$/, "");
  const auth_token = $("auth_token").value.trim();
  if (!cloud_endpoint || !auth_token) {
    showBanner("请填写 URL 和 Token", false);
    return;
  }
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(cloud_endpoint);
  if (!isLocal && !/^https:\/\//.test(cloud_endpoint)) {
    showBanner("非本地地址必须使用 https://", false);
    return;
  }
  chrome.storage.local.set({ cloud_endpoint, auth_token }, () => {
    showBanner("已保存", true);
  });
});

$("test").addEventListener("click", async () => {
  const url = $("cloud_endpoint").value.trim().replace(/\/$/, "");
  const token = $("auth_token").value.trim();
  if (!url || !token) {
    showBanner("先填写 URL 和 Token", false);
    return;
  }
  try {
    const resp = await fetch(url + "/api/ingest/v1/health", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.ok) showBanner(`连通成功（HTTP ${resp.status}）`, true);
    else showBanner(`HTTP ${resp.status}`, false);
  } catch (error) {
    showBanner("连接失败：" + String(error).slice(0, 100), false);
  }
});

$("purge").addEventListener("click", () => {
  if (!confirm("确认清空当前待上报队列？已抓取但未发送的数据会丢失。")) return;
  const req = indexedDB.deleteDatabase("temu-monitor");
  req.onsuccess = () => showBanner("队列已清空", true);
  req.onerror = () => showBanner("清空失败", false);
});

load();
