const $ = (id) => document.getElementById(id);
const HK_CLOUD_ENDPOINT = "https://erp.temu.chat/cloud";

function showBanner(text, ok) {
  const b = $("banner");
  b.textContent = text;
  b.className = "banner " + (ok ? "ok" : "err");
  setTimeout(() => { b.className = "banner"; b.textContent = ""; }, 4000);
}

function load() {
  chrome.storage.local.get(["cloud_endpoint", "auth_token", "device_id"], (v) => {
    $("cloud_endpoint").value = HK_CLOUD_ENDPOINT;
    $("auth_token").value = v.auth_token || "";
    $("device_id").value = v.device_id || "";
  });
}

$("toggleToken").addEventListener("click", () => {
  const input = $("auth_token");
  const isPassword = input.type === "password";
  input.type = isPassword ? "text" : "password";
  $("toggleToken").textContent = isPassword ? "🙈" : "👁";
});

$("save").addEventListener("click", () => {
  const auth_token = $("auth_token").value.trim();
  if (!auth_token) {
    showBanner("请填写 Token", false);
    return;
  }
  chrome.storage.local.set({ cloud_endpoint: HK_CLOUD_ENDPOINT, auth_token }, () => {
    showBanner("已保存", true);
  });
});

$("test").addEventListener("click", async () => {
  const token = $("auth_token").value.trim();
  if (!token) { showBanner("先填写 Token", false); return; }
  try {
    const resp = await fetch(HK_CLOUD_ENDPOINT + "/api/ingest/v1/health", {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (resp.ok) showBanner("连通成功", true);
    else showBanner(`连接失败 HTTP ${resp.status}`, false);
  } catch (e) {
    showBanner("连接失败: " + String(e).slice(0, 80), false);
  }
});

$("purge").addEventListener("click", () => {
  if (!confirm("确认清空待上报队列？未发送的数据将丢失。")) return;
  chrome.runtime.sendMessage({ type: "FLUSH_NOW" });
  const req = indexedDB.deleteDatabase("temu-monitor");
  req.onsuccess = () => showBanner("队列已清空", true);
  req.onerror = () => showBanner("清空失败", false);
});

load();
