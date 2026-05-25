// 单文件控制台 JS
const $ = (id) => document.getElementById(id);

// 支持 URL 参数 ?cloud=https://erp.temu.chat/cloud 切到 HK cloud
const urlParams = new URLSearchParams(location.search);
const apiOverride = urlParams.get("cloud") || localStorage.getItem("temu_console_api") || "";
if (apiOverride) localStorage.setItem("temu_console_api", apiOverride);

const state = {
  token: localStorage.getItem("temu_console_token_" + apiOverride) || "",
  user: null,
  intervalId: null,
};

const API = apiOverride; // 空 = 同源；非空 = 远端

async function api(path, opts) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opts?.headers || {});
  if (state.token) headers["Authorization"] = "Bearer " + state.token;
  const r = await fetch((API || "").replace(/\/$/, "") + path, Object.assign({}, opts, { headers }));
  if (r.status === 401) {
    state.token = "";
    localStorage.removeItem("temu_console_token_" + API);
    showLogin();
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

function showLogin() {
  $("login").style.display = "block";
  $("main").style.display = "none";
  $("meta-line").textContent = "未登录";
  if (state.intervalId) { clearInterval(state.intervalId); state.intervalId = null; }
}

function showMain() {
  $("login").style.display = "none";
  $("main").style.display = "block";
}

$("login-btn").addEventListener("click", async () => {
  const username = $("login-user").value.trim();
  const password = $("login-pass").value;
  $("login-err").textContent = "";
  try {
    const r = await fetch((API || "").replace(/\/$/, "") + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      $("login-err").textContent = j.error || ("HTTP " + r.status);
      return;
    }
    const j = await r.json();
    state.token = j.token;
    state.user = j.user;
    localStorage.setItem("temu_console_token_" + API, j.token);
    showMain();
    startPolling();
  } catch (e) {
    $("login-err").textContent = "请求失败：" + e.message;
  }
});

$("logout-btn").addEventListener("click", () => {
  state.token = "";
  localStorage.removeItem("temu_console_token");
  showLogin();
});

$("refresh-btn").addEventListener("click", refresh);

function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(typeof ts === "string" ? ts : Number(ts));
  if (isNaN(d.getTime())) return "—";
  const now = Date.now();
  const ago = (now - d.getTime()) / 1000;
  if (ago < 60) return Math.round(ago) + "秒前";
  if (ago < 3600) return Math.round(ago / 60) + "分钟前";
  if (ago < 86400) return Math.round(ago / 3600) + "小时前";
  return d.toLocaleString();
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function refresh() {
  try {
    const stats = await api("/api/dashboard/stats");
    $("m-total").textContent = stats.total ?? 0;
    $("m-24h").textContent = stats.last24h ?? 0;
    $("m-devices").textContent = (stats.devices || []).length;
    $("m-malls").textContent = (stats.malls || []).length;
    $("m-endpoints").textContent = (stats.topEndpoints || []).length;

    // malls
    const mallsRows = (stats.malls || []).map(m =>
      `<tr><td>${escapeHtml(m.site)}</td><td class="mono">${escapeHtml(m.mall_id)}</td><td>${escapeHtml(m.mall_name || "—")}</td><td>${escapeHtml(m.last_seen || "—")}</td></tr>`
    );
    $("malls-body").innerHTML = mallsRows.length ? mallsRows.join("") : `<tr><td colspan="4" class="empty">尚未识别到店铺（fetch 路径无 body 时无法解析 mallId，需要 v0.3 fetch hook 启用后才能拿到）</td></tr>`;

    // endpoints
    const epRows = (stats.topEndpoints || []).map(e =>
      `<tr><td>${escapeHtml(e.site || "—")}</td><td class="mono">${escapeHtml(e.method)}</td><td class="mono">${escapeHtml(e.url_path)}</td><td class="num">${e.count_total}</td><td class="dim">${fmtTime(e.last_seen)}</td></tr>`
    );
    $("endpoints-body").innerHTML = epRows.length ? epRows.join("") : `<tr><td colspan="5" class="empty">尚无数据</td></tr>`;

    // agent heartbeats
    const agents = await api("/api/dashboard/agent");
    // 按 device_uuid 取最新一条
    const byDevice = new Map();
    for (const a of agents) if (!byDevice.has(a.device_uuid)) byDevice.set(a.device_uuid, a);
    const agentRows = Array.from(byDevice.values()).map(a => {
      const fresh = a.ts ? (Date.now() - Number(a.ts) < 90000) : false;
      const hookStatus = a.hook_xhr_alive == 1
        ? `<span class="pill green">XHR ✓</span>`
        : a.hook_xhr_alive == 0
          ? `<span class="pill red">XHR ✗</span>`
          : `<span class="pill gray">无 tab</span>`;
      const flushStatus = a.last_flush_ok == 1
        ? `<span class="pill green">flush ✓</span>`
        : a.last_flush_ok == 0
          ? `<span class="pill red" title="${escapeHtml(a.last_flush_reason || '')}">flush ✗</span>`
          : `<span class="pill gray">未上报</span>`;
      return `<tr>
        <td class="mono">${escapeHtml((a.device_uuid || "").slice(0, 8))}</td>
        <td>${fmtTime(a.ts)} ${fresh ? '<span class="pill green">在线</span>' : '<span class="pill gray">离线</span>'}</td>
        <td class="num">${a.captured_count || 0} / ${a.total_sent || 0} ${flushStatus}</td>
        <td class="num">${a.queue_depth ?? "—"}</td>
        <td>${hookStatus}</td>
        <td class="mono dim" style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(a.page_url || '')}">${escapeHtml(a.page_url || "—")}</td>
        <td class="mono dim" style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(a.last_capture_url || '')}">${escapeHtml(a.last_capture_url || "—")}</td>
      </tr>`;
    });
    $("agents-body").innerHTML = agentRows.length ? agentRows.join("") : `<tr><td colspan="7" class="empty">尚无心跳</td></tr>`;

    // events
    const events = await api("/api/dashboard/events?limit=50");
    const evRows = events.map(e => {
      const statusCls = e.status >= 200 && e.status < 300 ? "ok" : (e.status >= 400 ? "err-text" : "");
      return `<tr>
        <td class="dim">${fmtTime(e.ts)}</td>
        <td class="mono">${escapeHtml(e.method)}</td>
        <td class="mono" style="max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(e.url_path)}">${escapeHtml(e.url_path)}</td>
        <td class="num ${statusCls}">${e.status ?? "—"}</td>
        <td class="num dim">${e.body_size || 0}</td>
        <td class="mono dim">${escapeHtml(e.mall_id || "—")}</td>
        <td class="mono dim" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(e.page || '')}">${escapeHtml(e.page || "—")}</td>
      </tr>`;
    });
    $("events-body").innerHTML = evRows.length ? evRows.join("") : `<tr><td colspan="7" class="empty">尚无事件</td></tr>`;

    // meta line
    const userMeta = state.user ? `${state.user.username} (${state.user.tenant_id})` : "已登录";
    $("meta-line").textContent = `${userMeta}  ·  ${new Date().toLocaleTimeString()}  ·  ${stats.total} 事件`;
  } catch (e) {
    if (e.message !== "unauthorized") {
      console.warn(e);
      $("meta-line").textContent = "刷新失败：" + e.message;
    }
  }
}

function startPolling() {
  refresh();
  if (state.intervalId) clearInterval(state.intervalId);
  state.intervalId = setInterval(refresh, 5000);
}

// 自动验证 token
async function bootstrap() {
  if (state.token) {
    try {
      const me = await api("/api/auth/me");
      state.user = me;
      showMain();
      startPolling();
      return;
    } catch {}
  }
  showLogin();
}

bootstrap();
