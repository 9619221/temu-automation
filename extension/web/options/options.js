const $ = (id) => document.getElementById(id);
const HK_CLOUD_ENDPOINT = "https://erp.temu.chat/cloud";

function showBanner(text, ok) {
  const b = $("banner");
  b.textContent = text;
  b.className = "banner show " + (ok ? "ok" : "err");
  setTimeout(() => { b.className = "banner"; }, 3000);
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
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  $("toggleToken").textContent = show ? "🙈" : "👁";
});

$("save").addEventListener("click", () => {
  const auth_token = $("auth_token").value.trim();
  if (!auth_token) { showBanner("请输入访问令牌", false); return; }
  chrome.storage.local.set({ cloud_endpoint: HK_CLOUD_ENDPOINT, auth_token }, () => {
    showBanner("已保存", true);
  });
});

$("test").addEventListener("click", async () => {
  const token = $("auth_token").value.trim();
  if (!token) { showBanner("请先输入令牌", false); return; }
  try {
    const r = await fetch(HK_CLOUD_ENDPOINT + "/api/ingest/v1/health", {
      headers: { Authorization: "Bearer " + token },
    });
    showBanner(r.ok ? "连接成功" : `失败 (${r.status})`, r.ok);
  } catch (e) {
    showBanner("无法连接: " + String(e).slice(0, 60), false);
  }
});

$("purge").addEventListener("click", () => {
  if (!confirm("确认清空队列？未上报数据将丢失。")) return;
  chrome.runtime.sendMessage({ type: "FLUSH_NOW" });
  const req = indexedDB.deleteDatabase("temu-monitor");
  req.onsuccess = () => showBanner("已清空", true);
  req.onerror = () => showBanner("清空失败", false);
});

load();
