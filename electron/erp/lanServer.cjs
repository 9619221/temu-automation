const http = require("http");
const crypto = require("crypto");
const os = require("os");

const DEFAULT_LAN_PORT = 19380;
const DEFAULT_BIND_ADDRESS = "0.0.0.0";
const SESSION_COOKIE_NAME = "temu_erp_lan_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const ROLE_PERMISSIONS = Object.freeze({
  "/": ["admin", "manager", "operations", "buyer", "finance", "warehouse", "viewer"],
  "/purchase": ["admin", "manager", "operations", "buyer", "finance"],
  "/api/purchase/workbench": ["admin", "manager", "operations", "buyer", "finance"],
  "/api/purchase/action": ["admin", "manager", "operations", "buyer", "finance"],
  "/warehouse": ["admin", "manager", "warehouse"],
  "/api/warehouse/workbench": ["admin", "manager", "warehouse"],
  "/api/warehouse/action": ["admin", "manager", "warehouse"],
  "/qc": ["admin", "manager", "operations"],
  "/api/qc/workbench": ["admin", "manager", "operations"],
  "/api/qc/action": ["admin", "manager", "operations"],
  "/outbound": ["admin", "manager", "operations", "warehouse"],
  "/api/outbound/workbench": ["admin", "manager", "operations", "warehouse"],
  "/api/outbound/action": ["admin", "manager", "operations", "warehouse"],
  "/api/work-items/list": ["admin", "manager", "operations", "buyer", "finance", "warehouse", "viewer"],
  "/api/work-items/stats": ["admin", "manager", "operations", "buyer", "finance", "warehouse", "viewer"],
  "/api/work-items/generate": ["admin", "manager", "operations", "buyer", "finance", "warehouse"],
  "/api/work-items/update-status": ["admin", "manager", "operations", "buyer", "finance", "warehouse"],
});

const PR_STATUS_LABELS = Object.freeze({
  draft: "草稿",
  submitted: "运营已提交",
  buyer_processing: "采购处理中",
  sourced: "已寻源",
  waiting_ops_confirm: "待运营确认",
  converted_to_po: "已转采购单",
  rejected: "已驳回",
  cancelled: "已取消",
});

const PO_STATUS_LABELS = Object.freeze({
  draft: "草稿",
  pending_finance_approval: "待财务审批",
  approved_to_pay: "已批准付款",
  paid: "已付款",
  supplier_processing: "供应商备货",
  shipped: "供应商已发货",
  arrived: "货已到仓",
  inbounded: "已入库",
  closed: "已关闭",
  delayed: "已延期",
  exception: "异常",
  cancelled: "已取消",
});

const PAYMENT_STATUS_LABELS = Object.freeze({
  pending: "待审批",
  approved: "已批准",
  paid: "已付款",
  rejected: "已驳回",
  unpaid: "未付款",
  deposit_paid: "已付定金",
  partial_refund: "部分退款",
  deducted: "已扣款",
});

const INBOUND_STATUS_LABELS = Object.freeze({
  pending_arrival: "待到货",
  arrived: "已到仓",
  counted: "已核数",
  inbounded_pending_qc: "已入库待 QC",
  quantity_mismatch: "数量异常",
  damaged: "破损异常",
  exception: "异常",
  cancelled: "已取消",
});

const BATCH_QC_STATUS_LABELS = Object.freeze({
  pending: "待 QC",
  passed: "QC 通过",
  passed_with_observation: "观察放行",
  partial_passed: "部分通过",
  failed: "QC 不通过",
  rework_required: "需返工",
});

const QC_STATUS_LABELS = Object.freeze({
  pending_qc: "待抽检",
  in_progress: "抽检中",
  passed: "通过",
  passed_with_observation: "观察通过",
  partial_passed: "部分通过",
  failed: "不通过",
  rework_required: "需返工",
  exception: "异常",
});

const OUTBOUND_STATUS_LABELS = Object.freeze({
  draft: "草稿",
  pending_warehouse: "待仓库处理",
  picking: "拣货中",
  packed: "已打包",
  shipped_out: "已发出",
  pending_ops_confirm: "待运营确认",
  confirmed: "已确认",
  exception: "异常",
  cancelled: "已取消",
});

const lanState = {
  server: null,
  port: DEFAULT_LAN_PORT,
  bindAddress: DEFAULT_BIND_ADDRESS,
  startedAt: null,
  lastError: null,
  sessions: new Map(),
  wsClients: new Set(),
};

function roleLabel(role) {
  switch (role) {
    case "admin": return "管理员";
    case "manager": return "负责人";
    case "operations": return "运营";
    case "buyer": return "采购";
    case "finance": return "财务";
    case "warehouse": return "仓库";
    case "viewer": return "只读";
    default: return role || "-";
  }
}

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const entries of Object.values(interfaces)) {
    for (const item of entries || []) {
      if (!item || item.family !== "IPv4" || item.internal) continue;
      addresses.push(item.address);
    }
  }
  return addresses;
}

function buildUrls(port, bindAddress = DEFAULT_BIND_ADDRESS) {
  const localUrl = `http://127.0.0.1:${port}`;
  const localOnly = bindAddress === "127.0.0.1" || bindAddress === "localhost";
  const lanAddresses = localOnly ? [] : getLanAddresses();
  const lanUrls = lanAddresses.map((address) => `http://${address}:${port}`);
  if (!localOnly && bindAddress && bindAddress !== DEFAULT_BIND_ADDRESS) {
    const explicitUrl = `http://${bindAddress}:${port}`;
    if (!lanUrls.includes(explicitUrl)) lanUrls.unshift(explicitUrl);
  }
  return {
    localUrl,
    lanUrls,
    primaryUrl: lanUrls[0] || localUrl,
  };
}

function getLanStatus(extra = {}) {
  const urls = buildUrls(lanState.port, lanState.bindAddress);
  return {
    running: Boolean(lanState.server),
    port: lanState.port,
    bindAddress: lanState.bindAddress,
    startedAt: lanState.startedAt,
    localUrl: urls.localUrl,
    primaryUrl: urls.primaryUrl,
    lanUrls: urls.lanUrls,
    routes: [
      { path: "/", label: "入口", allowedRoles: ROLE_PERMISSIONS["/"] },
      { path: "/purchase", label: "采购工作台", allowedRoles: ROLE_PERMISSIONS["/purchase"] },
      { path: "/warehouse", label: "仓库工作台", allowedRoles: ROLE_PERMISSIONS["/warehouse"] },
      { path: "/qc", label: "QC 抽检工作台", allowedRoles: ROLE_PERMISSIONS["/qc"] },
      { path: "/outbound", label: "出库发货工作台", allowedRoles: ROLE_PERMISSIONS["/outbound"] },
      { path: "/health", label: "健康检查" },
      { path: "/api/status", label: "服务状态" },
    ],
    authMode: "cookie_session",
    sessionCount: lanState.sessions.size,
    wsClientCount: lanState.wsClients.size,
    lastError: lanState.lastError,
    ...extra,
  };
}

function writeJson(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of lanState.sessions.entries()) {
    if (!session || session.expiresAt <= now) {
      lanState.sessions.delete(token);
    }
  }
}

function createSession(user) {
  cleanupExpiredSessions();
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  lanState.sessions.set(token, {
    token,
    user,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  return token;
}

function getSessionFromRequest(req) {
  cleanupExpiredSessions();
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (!token) return null;
  const session = lanState.sessions.get(token);
  if (!session) return null;
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function destroySession(req) {
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (token) lanState.sessions.delete(token);
}

function writeUpgradeError(socket, statusCode, message) {
  try {
    socket.write([
      `HTTP/1.1 ${statusCode} ${message}`,
      "Connection: close",
      "Content-Length: 0",
      "",
      "",
    ].join("\r\n"));
  } catch {}
  socket.destroy();
}

function encodeWebSocketFrame(payload, opcode = 0x1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const length = body.length;
  if (length < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, length]), body]);
  }
  if (length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, body]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, body]);
}

function sendWebSocketPayload(client, payload) {
  if (!client?.socket || client.socket.destroyed) return false;
  try {
    client.socket.write(encodeWebSocketFrame(JSON.stringify(payload)));
    return true;
  } catch {
    try { client.socket.destroy(); } catch {}
    return false;
  }
}

function broadcastLanEvent(payload = {}) {
  const event = {
    type: payload.type || "erp:update",
    at: payload.at || new Date().toISOString(),
    ...payload,
  };
  for (const client of Array.from(lanState.wsClients)) {
    if (!sendWebSocketPayload(client, event)) {
      lanState.wsClients.delete(client);
    }
  }
  return {
    delivered: lanState.wsClients.size,
    event,
  };
}

function handleWebSocketData(client, chunk) {
  if (!chunk || chunk.length < 2) return;
  const opcode = chunk[0] & 0x0f;
  if (opcode === 0x8) {
    lanState.wsClients.delete(client);
    client.socket.end(encodeWebSocketFrame("", 0x8));
    return;
  }
  if (opcode === 0x9) {
    client.socket.write(encodeWebSocketFrame("", 0xA));
  }
}

function handleWebSocketUpgrade(req, socket) {
  let pathname = "/";
  try {
    const parsed = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    pathname = parsed.pathname;
  } catch {}

  if (pathname !== "/ws") {
    writeUpgradeError(socket, 404, "Not Found");
    return;
  }

  const session = getSessionFromRequest(req);
  if (!session) {
    writeUpgradeError(socket, 401, "Unauthorized");
    return;
  }

  const key = String(req.headers["sec-websocket-key"] || "").trim();
  const version = String(req.headers["sec-websocket-version"] || "");
  if (!key || version !== "13") {
    writeUpgradeError(socket, 400, "Bad Request");
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    "",
  ].join("\r\n"));
  socket.setNoDelay(true);

  const client = {
    id: crypto.randomBytes(8).toString("hex"),
    user: session.user,
    socket,
    connectedAt: new Date().toISOString(),
  };
  lanState.wsClients.add(client);
  sendWebSocketPayload(client, {
    type: "connected",
    at: new Date().toISOString(),
    userRole: session.user?.role || null,
  });

  socket.on("data", (chunk) => handleWebSocketData(client, chunk));
  socket.on("close", () => lanState.wsClients.delete(client));
  socket.on("error", () => lanState.wsClients.delete(client));
}

function buildSessionCookie(token) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function buildClearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function isRoleAllowed(pathname, role) {
  const allowedRoles = ROLE_PERMISSIONS[pathname];
  if (!allowedRoles) return true;
  return allowedRoles.includes(role);
}

function normalizeLocalNext(value) {
  const text = String(value || "/").trim();
  if (!text.startsWith("/") || text.startsWith("//")) return "/";
  return text;
}

function writeRedirect(res, location, headers = {}) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end();
}

function writeForbidden(res, user, pathname) {
  writeHtml(res, renderShell({
    title: "无权访问",
    subtitle: `${user?.name || "当前用户"}（${roleLabel(user?.role)}）没有访问 ${pathname} 的权限。`,
    cards: [
      {
        title: "可用入口",
        body: "请返回首页，或使用具备对应角色的账号重新登录。",
      },
      {
        title: "当前角色",
        body: `<code>${escapeHtml(roleLabel(user?.role))}</code>`,
      },
    ],
    currentPath: pathname,
    user,
  }), 403);
}

function renderShell({ title, subtitle, cards = [], currentPath, user, content = "" }) {
  const navItems = [
    ["/", "入口"],
    ["/purchase", "采购"],
    ["/warehouse", "仓库"],
    ["/qc", "QC"],
    ["/outbound", "发货"],
    ["/health", "Health"],
  ];
  const cardHtml = cards.map((card) => `
    <section class="card">
      <div class="card-title">${escapeHtml(card.title)}</div>
      <div class="card-body">${card.body}</div>
    </section>
  `).join("");
  const navHtml = navItems.map(([path, label]) => `
    <a class="${path === currentPath ? "active" : ""}" href="${path}">${escapeHtml(label)}</a>
  `).join("");
  const userHtml = user
    ? `<div class="user-pill">${escapeHtml(user.name)} · ${escapeHtml(roleLabel(user.role))}<a href="/logout">退出</a></div>`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7fb;
      --panel: #ffffff;
      --line: #e6e8ef;
      --text: #1f2937;
      --muted: #667085;
      --brand: #e55b00;
      --blue: #1677ff;
      --green: #16a34a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    header {
      background: var(--panel);
      border-bottom: 1px solid var(--line);
      padding: 16px 20px;
      position: sticky;
      top: 0;
      z-index: 2;
    }
    .top {
      max-width: 1120px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 800;
    }
    .user-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #344054;
      background: #f7f8fb;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 13px;
      white-space: nowrap;
    }
    .user-pill a {
      color: var(--brand);
      text-decoration: none;
      font-weight: 700;
    }
    .dot {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      background: var(--green);
      box-shadow: 0 0 0 5px rgba(22, 163, 74, 0.12);
    }
    nav {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    nav a {
      color: var(--muted);
      text-decoration: none;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 7px 10px;
      background: #fff;
      font-size: 14px;
    }
    nav a.active {
      color: #fff;
      border-color: var(--brand);
      background: var(--brand);
    }
    main {
      max-width: 1120px;
      margin: 0 auto;
      padding: 24px 20px 48px;
    }
    .hero {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
      flex-wrap: wrap;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 24px;
      line-height: 1.25;
    }
    .subtitle {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.7;
      max-width: 720px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      border-radius: 999px;
      padding: 4px 11px;
      background: #eef6ff;
      color: var(--blue);
      border: 1px solid #cfe5ff;
      font-size: 13px;
      font-weight: 600;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
      margin-bottom: 18px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      min-height: 132px;
    }
    .card-title {
      font-size: 16px;
      font-weight: 750;
      margin-bottom: 10px;
    }
    .card-body {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.7;
    }
    .section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      margin-top: 16px;
      overflow: hidden;
    }
    .section-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      flex-wrap: wrap;
    }
    .section-title {
      font-size: 17px;
      font-weight: 800;
      margin-bottom: 4px;
    }
    .section-subtitle {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 820px;
      font-size: 13px;
    }
    th, td {
      padding: 11px 12px;
      border-bottom: 1px solid #eef0f5;
      text-align: left;
      vertical-align: top;
    }
    th {
      color: #475467;
      background: #fafbfc;
      font-weight: 750;
      white-space: nowrap;
    }
    tr:last-child td {
      border-bottom: 0;
    }
    .primary-text {
      color: #1f2937;
      font-weight: 750;
    }
    .muted {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.6;
    }
    .status {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border-radius: 999px;
      padding: 2px 9px;
      background: #f1f3f7;
      color: #475467;
      border: 1px solid #e4e7ec;
      font-size: 12px;
      font-weight: 750;
      white-space: nowrap;
    }
    .status-warn {
      background: #fff7ed;
      color: #c2410c;
      border-color: #fed7aa;
    }
    .status-info {
      background: #eef6ff;
      color: #175cd3;
      border-color: #cfe5ff;
    }
    .status-ok {
      background: #ecfdf3;
      color: #067647;
      border-color: #abefc6;
    }
    .status-danger {
      background: #fff1f0;
      color: #b42318;
      border-color: #ffd5d5;
    }
    .action-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 28px;
      border: 0;
      border-radius: 7px;
      padding: 4px 10px;
      background: #e55b00;
      color: #fff;
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
      cursor: pointer;
      font-family: inherit;
      text-decoration: none;
    }
    .action-chip.secondary {
      background: #1677ff;
    }
    .action-chip.success {
      background: #16a34a;
    }
    .inline-form {
      display: inline-flex;
      margin: 0;
    }
    .actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .mini-input {
      width: 84px;
      height: 30px;
      border: 1px solid #d0d5dd;
      border-radius: 7px;
      padding: 0 8px;
      font-size: 13px;
      margin: 0;
      background: #fff;
      font-family: inherit;
    }
    .mini-input.wide {
      width: 150px;
    }
    .mini-input.full {
      width: 100%;
    }
    .mini-input.remark {
      width: 132px;
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 8px;
      margin-top: 10px;
    }
    .stacked-form {
      display: grid;
      gap: 8px;
      max-width: 520px;
    }
    .compact-form {
      display: grid;
      gap: 7px;
      min-width: 220px;
      max-width: 300px;
    }
    .inline-label {
      display: grid;
      gap: 4px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .timeline-list,
    .candidate-list {
      margin: 8px 0 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 6px;
    }
    .timeline-list li,
    .candidate-list li {
      border: 1px solid #eef0f5;
      border-radius: 7px;
      padding: 8px;
      background: #fafbfc;
    }
    .unread-dot {
      display: inline-flex;
      min-width: 18px;
      height: 18px;
      align-items: center;
      justify-content: center;
      margin-left: 6px;
      border-radius: 999px;
      background: #e55b00;
      color: #fff;
      font-size: 11px;
      font-weight: 800;
    }
    .empty {
      padding: 18px 16px;
      color: var(--muted);
      font-size: 14px;
    }
    .realtime-toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 20;
      display: none;
      max-width: min(360px, calc(100vw - 36px));
      border: 1px solid #cfe5ff;
      border-radius: 8px;
      background: #eef6ff;
      color: #175cd3;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
      padding: 10px 12px;
      font-size: 13px;
      font-weight: 700;
    }
    .realtime-toast.is-visible {
      display: block;
    }
    code {
      color: #344054;
      background: #f1f3f7;
      border: 1px solid #e4e7ec;
      border-radius: 6px;
      padding: 2px 6px;
      word-break: break-all;
    }
    ul { margin: 8px 0 0 18px; padding: 0; }
    @media (max-width: 640px) {
      header { padding: 14px 12px; }
      main { padding: 18px 12px 36px; }
      h1 { font-size: 22px; }
      nav { width: 100%; }
      nav a { flex: 1; text-align: center; }
    }
  </style>
</head>
<body>
  <header>
    <div class="top">
      <div class="brand"><span class="dot"></span><span>Temu ERP LAN</span></div>
      ${userHtml}
      <nav>${navHtml}</nav>
    </div>
  </header>
  <main>
    <div class="hero">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p class="subtitle">${escapeHtml(subtitle)}</p>
      </div>
      <span class="badge">服务运行中</span>
    </div>
    ${cardHtml ? `<div class="grid">${cardHtml}</div>` : ""}
    ${content}
  </main>
  <div id="realtime-toast" class="realtime-toast">采购协作已更新，正在刷新...</div>
  <script>
    (function () {
      if (!("WebSocket" in window)) return;
      var currentPath = ${JSON.stringify(currentPath || "")};
      var retryCount = 0;
      var reloadTimer = null;
      var toastTimer = null;

      function showRealtimeToast() {
        var toast = document.getElementById("realtime-toast");
        if (!toast) return;
        toast.classList.add("is-visible");
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(function () {
          toast.classList.remove("is-visible");
        }, 2200);
      }

      function connectRealtimeSocket() {
        var protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        var socket = new WebSocket(protocol + "//" + window.location.host + "/ws");
        socket.onopen = function () {
          retryCount = 0;
        };
        socket.onmessage = function (event) {
          var payload = null;
          try {
            payload = JSON.parse(event.data || "{}");
          } catch {
            return;
          }
          if (!payload || payload.type !== "purchase:update" || currentPath !== "/purchase") return;
          showRealtimeToast();
          window.clearTimeout(reloadTimer);
          reloadTimer = window.setTimeout(function () {
            window.location.reload();
          }, 700);
        };
        socket.onclose = function () {
          retryCount += 1;
          window.setTimeout(connectRealtimeSocket, Math.min(10000, 1000 * retryCount));
        };
      }

      connectRealtimeSocket();
    })();
  </script>
</body>
</html>`;
}

function renderLoginPage({ error = "", next = "/" } = {}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Temu ERP LAN 登录</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: #f6f7fb;
      color: #1f2937;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .panel {
      width: min(100%, 400px);
      background: #fff;
      border: 1px solid #e6e8ef;
      border-radius: 10px;
      padding: 22px;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
    }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { margin: 0 0 18px; color: #667085; line-height: 1.7; }
    label { display: block; margin-bottom: 7px; color: #344054; font-weight: 650; }
    input {
      width: 100%;
      height: 42px;
      border: 1px solid #d0d5dd;
      border-radius: 8px;
      padding: 0 11px;
      font-size: 15px;
      margin-bottom: 14px;
    }
    .mini-input {
      width: 84px;
      height: 30px;
      border: 1px solid #d0d5dd;
      border-radius: 7px;
      padding: 0 8px;
      font-size: 13px;
      margin: 0;
    }
    .mini-input.remark {
      width: 132px;
    }
    button {
      width: 100%;
      height: 42px;
      border: 0;
      border-radius: 8px;
      background: #e55b00;
      color: #fff;
      font-size: 15px;
      font-weight: 750;
      cursor: pointer;
    }
    .error {
      margin-bottom: 14px;
      border: 1px solid #ffd5d5;
      background: #fff1f0;
      color: #b42318;
      border-radius: 8px;
      padding: 9px 10px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <main class="panel">
    <h1>LAN 登录</h1>
    <p>使用 ERP 调试台里创建的用户和访问码登录。</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    <form method="post" action="/api/login">
      <input type="hidden" name="next" value="${escapeHtml(next)}" />
      <label for="login">用户 ID 或姓名</label>
      <input id="login" name="login" autocomplete="username" required />
      <label for="accessCode">访问码</label>
      <input id="accessCode" name="accessCode" type="password" autocomplete="current-password" required />
      <button type="submit">登录</button>
    </form>
  </main>
</body>
</html>`;
}

function writeHtml(res, html, statusCode = 200, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(html);
}

function getRequestPath(req) {
  try {
    const parsed = new URL(req.url || "/", "http://127.0.0.1");
    return parsed.pathname;
  } catch {
    return "/";
  }
}

function buildLandingCards() {
  const status = getLanStatus();
  const urlList = [status.localUrl, ...status.lanUrls]
    .map((url) => `<li><code>${escapeHtml(url)}</code></li>`)
    .join("");
  return [
    {
      title: "服务地址",
      body: `<ul>${urlList || "<li>暂无可用地址</li>"}</ul>`,
    },
    {
      title: "已开放页面",
      body: "<ul><li>采购工作台：<code>/purchase</code></li><li>仓库工作台：<code>/warehouse</code></li><li>QC 抽检：<code>/qc</code></li></ul>",
    },
    {
      title: "安全边界",
      body: "当前阶段已经启用 LAN 登录和角色权限。真实采购/仓库业务 API 会在后续工作台开发包接入。",
    },
  ];
}

function buildWorkspaceCards(kind) {
  const descriptions = {
    purchase: {
      title: "采购工作台",
      subtitle: "后续用于采购接收运营 PR、记录供应商寻源、推进 PO 和付款审批。",
      items: ["待接采购申请", "供应商筛选", "采购单状态", "财务付款审批"],
    },
    warehouse: {
      title: "仓库工作台",
      subtitle: "后续用于仓管收货、核数、入库、拣货、打包和发货回填。",
      items: ["待到货", "入库批次", "待拣货", "发货回填"],
    },
    qc: {
      title: "QC 抽检工作台",
      subtitle: "后续用于运营抽检录入、按百分比判定通过/部分通过/失败。",
      items: ["待抽检批次", "不良数量", "不良率判定", "库存释放"],
    },
  };
  const meta = descriptions[kind] || descriptions.purchase;
  return {
    title: meta.title,
    subtitle: meta.subtitle,
    cards: [
      {
        title: "当前状态",
        body: "LAN 服务已经启动，页面路由必须登录后访问，并按用户角色控制入口。",
      },
      {
        title: "即将接入",
        body: `<ul>${meta.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`,
      },
      {
        title: "接口预留",
        body: "健康检查：<code>/health</code><br/>服务状态：<code>/api/status</code>",
      },
    ],
  };
}

function formatDate(value) {
  if (!value) return "-";
  return String(value).slice(0, 10);
}

function formatMoney(value) {
  const number = Number(value || 0);
  return `¥${number.toFixed(2)}`;
}

function formatQty(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function statusClass(status) {
  if (["submitted", "pending_finance_approval", "pending", "approved_to_pay", "pending_arrival", "pending_qc", "pending_warehouse", "pending_ops_confirm"].includes(status)) {
    return "status-warn";
  }
  if (["buyer_processing", "sourced", "waiting_ops_confirm", "supplier_processing", "shipped", "arrived", "counted", "in_progress", "picking", "packed", "shipped_out"].includes(status)) {
    return "status-info";
  }
  if (["converted_to_po", "paid", "inbounded", "closed", "approved", "inbounded_pending_qc", "passed", "passed_with_observation", "partial_passed", "confirmed"].includes(status)) {
    return "status-ok";
  }
  if (["rejected", "cancelled", "exception", "delayed", "quantity_mismatch", "damaged", "failed", "rework_required"].includes(status)) {
    return "status-danger";
  }
  return "";
}

function statusPill(status, labels) {
  const text = labels[status] || status || "-";
  return `<span class="status ${statusClass(status)}">${escapeHtml(text)}</span>`;
}

function renderSection({ title, subtitle, badge, table, empty }) {
  return `
    <section class="section">
      <div class="section-head">
        <div>
          <div class="section-title">${escapeHtml(title)}</div>
          <div class="section-subtitle">${escapeHtml(subtitle)}</div>
        </div>
        ${badge ? `<span class="badge">${escapeHtml(badge)}</span>` : ""}
      </div>
      ${table || `<div class="empty">${escapeHtml(empty || "暂无数据")}</div>`}
    </section>
  `;
}

function renderTable({ columns, rows, emptyText }) {
  if (!rows.length) {
    return `<div class="empty">${escapeHtml(emptyText || "暂无数据")}</div>`;
  }
  const head = columns.map((column) => `<th>${escapeHtml(column.title)}</th>`).join("");
  const body = rows.map((row) => `
    <tr>
      ${columns.map((column) => `<td>${column.render(row)}</td>`).join("")}
    </tr>
  `).join("");
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderSkuCell(row) {
  return `
    <div class="primary-text">${escapeHtml(row.productName || row.skuSummary || row.poNo || "-")}</div>
    <div class="muted">${escapeHtml(row.internalSkuCode || row.skuId || row.skuSummary || "-")}</div>
  `;
}

function renderEvidence(row) {
  const evidence = Array.isArray(row.evidence) ? row.evidence.slice(0, 2) : [];
  if (!evidence.length) return '<span class="muted">-</span>';
  return `<div class="muted">${evidence.map((item) => escapeHtml(item)).join("<br/>")}</div>`;
}

function renderPaymentAction(row, user) {
  const role = user?.role || "";
  if (row.paymentApprovalStatus === "pending" || row.poStatus === "pending_finance_approval") {
    if (!canRole(role, ["finance", "manager", "admin"])) return renderUnavailableAction("待财务");
    return renderActionButton({
      action: "approve_payment",
      label: "财务批准",
      fields: {
        poId: row.poId,
        paymentApprovalId: row.paymentApprovalId,
      },
      className: "secondary",
    });
  }
  if (row.paymentApprovalStatus === "approved" || row.poStatus === "approved_to_pay") {
    if (!canRole(role, ["finance", "manager", "admin"])) return renderUnavailableAction("待付款");
    return renderActionButton({
      action: "confirm_paid",
      label: "确认已付款",
      fields: {
        poId: row.poId,
        paymentApprovalId: row.paymentApprovalId,
      },
      className: "success",
    });
  }
  return '<span class="status">查看</span>';
}

function canRole(role, allowedRoles) {
  return allowedRoles.includes(role);
}

function renderHiddenInputs(fields = {}) {
  return Object.entries(fields)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}" />`)
    .join("");
}

function renderActionButton({ action, label, fields = {}, className = "", endpoint = "/api/purchase/action" }) {
  return `
    <form class="inline-form" method="post" action="${escapeHtml(endpoint)}">
      <input type="hidden" name="action" value="${escapeHtml(action)}" />
      ${renderHiddenInputs(fields)}
      <button class="action-chip ${escapeHtml(className)}" type="submit">${escapeHtml(label)}</button>
    </form>
  `;
}

function renderUnavailableAction(text = "等待") {
  return `<span class="status">${escapeHtml(text)}</span>`;
}

function renderSelectOptions(rows = [], valueKey = "id", labelFn = (row) => row.name || row.id, emptyLabel = "请选择") {
  return [
    `<option value="">${escapeHtml(emptyLabel)}</option>`,
    ...rows.map((row) => `<option value="${escapeHtml(row[valueKey])}">${escapeHtml(labelFn(row))}</option>`),
  ].join("");
}

function renderCreatePurchaseRequestForm(model = {}, user = {}) {
  const role = user?.role || "";
  if (!canRole(role, ["operations", "manager", "admin"])) return "";
  const skuOptions = Array.isArray(model.skuOptions) ? model.skuOptions : [];
  return renderSection({
    title: "新建采购需求",
    subtitle: "运营端可在用户端直接提交采购需求，采购端会实时收到并处理。",
    badge: "运营端",
    table: `
      <form class="stacked-form" method="post" action="/api/purchase/action">
        <input type="hidden" name="action" value="create_pr" />
        <label class="inline-label">SKU
          <select class="mini-input full" name="skuId" required>
            ${renderSelectOptions(skuOptions, "id", (sku) => `${sku.internalSkuCode || "-"} · ${sku.productName || "-"}`, "选择 SKU")}
          </select>
        </label>
        <div class="form-grid">
          <label class="inline-label">需求数量
            <input class="mini-input full" name="requestedQty" type="number" min="1" step="1" value="1" required />
          </label>
          <label class="inline-label">目标单价
            <input class="mini-input full" name="targetUnitCost" type="number" min="0" step="0.01" placeholder="可选" />
          </label>
          <label class="inline-label">期望到货
            <input class="mini-input full" name="expectedArrivalDate" type="date" />
          </label>
        </div>
        <label class="inline-label">需求原因
          <input class="mini-input full" name="reason" placeholder="活动备货 / 缺货补采 / 新品打样" required />
        </label>
        <label class="inline-label">证据或链接
          <input class="mini-input full" name="evidenceText" placeholder="截图说明、竞品链接、数据结论" />
        </label>
        <button class="action-chip" type="submit">提交采购需求</button>
      </form>
    `,
  });
}

function renderQuoteFeedbackForm(row, model = {}, user = {}) {
  const role = user?.role || "";
  if (!canRole(role, ["buyer", "manager", "admin"])) return "";
  if (!["submitted", "buyer_processing", "sourced"].includes(row.status)) return "";
  const supplierOptions = Array.isArray(model.supplierOptions) ? model.supplierOptions : [];
  return `
    <form class="compact-form" method="post" action="/api/purchase/action">
      <input type="hidden" name="action" value="quote_feedback" />
      <input type="hidden" name="prId" value="${escapeHtml(row.id)}" />
      <label class="inline-label">已有供应商
        <select class="mini-input full" name="supplierId">
          ${renderSelectOptions(supplierOptions, "id", (supplier) => supplier.name || supplier.id, "手填供应商")}
        </select>
      </label>
      <label class="inline-label">供应商名称
        <input class="mini-input full" name="supplierName" placeholder="未选已有供应商时填写" />
      </label>
      <div class="form-grid">
        <label class="inline-label">单价
          <input class="mini-input full" name="unitPrice" type="number" min="0" step="0.01" required />
        </label>
        <label class="inline-label">运费
          <input class="mini-input full" name="logisticsFee" type="number" min="0" step="0.01" value="0" />
        </label>
        <label class="inline-label">MOQ
          <input class="mini-input full" name="moq" type="number" min="1" step="1" value="1" />
        </label>
        <label class="inline-label">交期天数
          <input class="mini-input full" name="leadDays" type="number" min="0" step="1" />
        </label>
      </div>
      <input class="mini-input full" name="productUrl" placeholder="报价链接，可选" />
      <input class="mini-input full" name="remark" placeholder="报价说明，可选" />
      <button class="action-chip secondary" type="submit">报价反馈</button>
    </form>
  `;
}

function renderGeneratePoForm(row, user = {}) {
  const role = user?.role || "";
  const candidates = Array.isArray(row.candidates) ? row.candidates : [];
  if (!canRole(role, ["buyer", "manager", "admin"])) return "";
  if (!candidates.length || !["submitted", "buyer_processing", "sourced", "waiting_ops_confirm"].includes(row.status)) return "";
  return `
    <form class="compact-form" method="post" action="/api/purchase/action">
      <input type="hidden" name="action" value="generate_po" />
      <input type="hidden" name="prId" value="${escapeHtml(row.id)}" />
      <label class="inline-label">选择报价
        <select class="mini-input full" name="candidateId" required>
          ${renderSelectOptions(candidates, "id", (candidate) => `${candidate.supplierName || "供应商"} · ${formatMoney(candidate.unitPrice)} · MOQ ${formatQty(candidate.moq)}`, "选择报价")}
        </select>
      </label>
      <div class="form-grid">
        <label class="inline-label">采购数量
          <input class="mini-input full" name="qty" type="number" min="1" step="1" value="${escapeHtml(row.requestedQty || 1)}" required />
        </label>
        <label class="inline-label">预计到货
          <input class="mini-input full" name="expectedDeliveryDate" type="date" />
        </label>
      </div>
      <input class="mini-input full" name="remark" placeholder="采购单备注，可选" />
      <button class="action-chip success" type="submit">生成采购单</button>
    </form>
  `;
}

function renderCommentForm(row, user = {}) {
  const role = user?.role || "";
  if (!canRole(role, ["operations", "buyer", "manager", "admin"])) return "";
  return `
    <form class="compact-form" method="post" action="/api/purchase/action">
      <input type="hidden" name="action" value="add_comment" />
      <input type="hidden" name="prId" value="${escapeHtml(row.id)}" />
      <input class="mini-input full" name="body" placeholder="留言给对方" required />
      <button class="action-chip" type="submit">发送留言</button>
    </form>
  `;
}

function renderCandidateList(row) {
  const candidates = Array.isArray(row.candidates) ? row.candidates : [];
  if (!candidates.length) return '<span class="muted">暂无报价</span>';
  return `
    <ul class="candidate-list">
      ${candidates.slice(0, 4).map((candidate) => `
        <li>
          <div class="primary-text">${escapeHtml(candidate.supplierName || "供应商")}</div>
          <div class="muted">单价 ${formatMoney(candidate.unitPrice)} · MOQ ${formatQty(candidate.moq)} · 交期 ${candidate.leadDays ? `${escapeHtml(candidate.leadDays)} 天` : "-"}</div>
          ${candidate.remark ? `<div class="muted">${escapeHtml(candidate.remark)}</div>` : ""}
        </li>
      `).join("")}
    </ul>
  `;
}

function renderTimelineList(row) {
  const items = Array.isArray(row.timeline) ? row.timeline.slice(-5).reverse() : [];
  if (!items.length) return '<span class="muted">暂无协作记录</span>';
  return `
    <ul class="timeline-list">
      ${items.map((item) => `
        <li>
          <div>${escapeHtml(item.message || "-")}</div>
          <div class="muted">${escapeHtml(item.actorName || "系统")} · ${escapeHtml(item.actorRole || "-")} · ${formatDate(item.createdAt)}</div>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderPurchaseRequestActions(row, user, model = {}) {
  const role = user?.role || "";
  const actions = [];
  if (row.status === "submitted" && canRole(role, ["buyer", "manager", "admin"])) {
    actions.push(renderActionButton({
      action: "accept_pr",
      label: "接收 PR",
      fields: { prId: row.id },
    }));
  }
  if (row.status === "buyer_processing" && canRole(role, ["buyer", "manager", "admin"])) {
    actions.push(renderActionButton({
      action: "mark_sourced",
      label: "标记已寻源",
      fields: { prId: row.id },
      className: "secondary",
    }));
  }
  return actions.length ? `<div class="actions">${actions.join("")}</div>` : renderUnavailableAction("无动作");
}

function renderPurchaseRequestActionsV2(row, user, model = {}) {
  const role = user?.role || "";
  const actions = [];
  if (row.status === "submitted" && canRole(role, ["buyer", "manager", "admin"])) {
    actions.push(renderActionButton({
      action: "accept_pr",
      label: "接收",
      fields: { prId: row.id },
    }));
  }
  if (row.status === "buyer_processing" && canRole(role, ["buyer", "manager", "admin"])) {
    actions.push(renderActionButton({
      action: "mark_sourced",
      label: "标记已寻源",
      fields: { prId: row.id },
      className: "secondary",
    }));
  }
  if (Number(row.unreadCount || 0) > 0 && canRole(role, ["operations", "buyer", "manager", "admin"])) {
    actions.push(renderActionButton({
      action: "mark_read",
      label: "标记已读",
      fields: { prId: row.id },
      className: "secondary",
    }));
  }
  actions.push(renderQuoteFeedbackForm(row, model, user));
  actions.push(renderGeneratePoForm(row, user));
  actions.push(renderCommentForm(row, user));
  const html = actions.filter(Boolean).join("");
  return html ? `<div class="actions">${html}</div>` : renderUnavailableAction("无待办");
}

function renderPurchaseOrderActions(row, user) {
  const role = user?.role || "";
  const actions = [];
  if (row.status === "draft" && canRole(role, ["buyer", "manager", "admin"])) {
    actions.push(renderActionButton({
      action: "submit_payment_approval",
      label: "提交付款审批",
      fields: {
        poId: row.id,
        amount: row.totalAmount,
      },
    }));
  }
  if (row.status === "pending_finance_approval" && canRole(role, ["finance", "manager", "admin"])) {
    actions.push(renderActionButton({
      action: "approve_payment",
      label: "财务批准",
      fields: { poId: row.id },
      className: "secondary",
    }));
  }
  if (row.status === "approved_to_pay" && canRole(role, ["finance", "manager", "admin"])) {
    actions.push(renderActionButton({
      action: "confirm_paid",
      label: "确认已付款",
      fields: { poId: row.id },
      className: "success",
    }));
  }
  return actions.length ? `<div class="actions">${actions.join("")}</div>` : renderUnavailableAction("无动作");
}

function buildPurchaseSummaryCards(model) {
  const summary = model.summary || {};
  return [
    {
      title: "采购申请",
      body: `<div class="primary-text">${formatQty(summary.pendingPurchaseRequestCount)} 个待处理</div><div class="muted">列表共 ${formatQty(summary.purchaseRequestCount)} 条 PR</div>`,
    },
    {
      title: "采购单",
      body: `<div class="primary-text">${formatQty(summary.openPurchaseOrderCount)} 个未关闭</div><div class="muted">列表共 ${formatQty(summary.purchaseOrderCount)} 张 PO</div>`,
    },
    {
      title: "付款审批",
      body: `<div class="primary-text">${formatQty(summary.paymentQueueCount)} 个入口</div><div class="muted">待处理金额 ${formatMoney(summary.paymentQueueAmount)}</div>`,
    },
  ];
}

function renderPurchaseWorkbench(model = {}, user = {}) {
  const purchaseRequests = Array.isArray(model.purchaseRequests) ? model.purchaseRequests : [];
  const purchaseOrders = Array.isArray(model.purchaseOrders) ? model.purchaseOrders : [];
  const paymentQueue = Array.isArray(model.paymentQueue) ? model.paymentQueue : [];

  const requestTable = renderTable({
    rows: purchaseRequests,
    emptyText: "暂无采购申请。运营提交 PR 后会出现在这里。",
    columns: [
      { title: "SKU", render: renderSkuCell },
      { title: "状态", render: (row) => statusPill(row.status, PR_STATUS_LABELS) },
      {
        title: "申请",
        render: (row) => `
          <div class="primary-text">${formatQty(row.requestedQty)} 件</div>
          <div class="muted">${escapeHtml(row.reason || "-")} · ${escapeHtml(row.requestedByName || "-")}</div>
        `,
      },
      { title: "目标成本", render: (row) => formatMoney(row.targetUnitCost) },
      { title: "期望到货", render: (row) => formatDate(row.expectedArrivalDate) },
      { title: "证据", render: renderEvidence },
      {
        title: "寻源",
        render: (row) => `
          <div class="primary-text">${formatQty(row.candidateCount)} 个候选</div>
          <div class="muted">已选 ${formatQty(row.selectedCandidateCount)}</div>
        `,
      },
      {
        title: "协作",
        render: (row) => `
          <div class="primary-text">报价 ${formatQty(row.candidateCount)}${row.unreadCount ? `<span class="unread-dot">${escapeHtml(row.unreadCount)}</span>` : ""}</div>
          ${renderCandidateList(row)}
          ${renderTimelineList(row)}
        `,
      },
      { title: "动作", render: (row) => renderPurchaseRequestActionsV2(row, user, model) },
    ],
  });

  const orderTable = renderTable({
    rows: purchaseOrders,
    emptyText: "暂无采购单。PR 确认后生成 PO。",
    columns: [
      {
        title: "采购单",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.poNo || row.id)}</div>
          <div class="muted">${escapeHtml(row.supplierName || "-")}</div>
        `,
      },
      { title: "状态", render: (row) => statusPill(row.status, PO_STATUS_LABELS) },
      {
        title: "SKU / 数量",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.skuSummary || "-")}</div>
          <div class="muted">${formatQty(row.receivedQty)} / ${formatQty(row.totalQty)} 已收</div>
        `,
      },
      { title: "金额", render: (row) => formatMoney(row.totalAmount) },
      { title: "付款", render: (row) => statusPill(row.paymentStatus, PAYMENT_STATUS_LABELS) },
      { title: "预计到货", render: (row) => formatDate(row.expectedDeliveryDate) },
      { title: "更新", render: (row) => formatDate(row.updatedAt) },
      { title: "动作", render: (row) => renderPurchaseOrderActions(row, user) },
    ],
  });

  const paymentTable = renderTable({
    rows: paymentQueue,
    emptyText: "暂无待审批付款。PO 提交付款审批后会出现在这里。",
    columns: [
      {
        title: "付款入口",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.paymentApprovalId || row.poNo || row.poId)}</div>
          <div class="muted">PO：${escapeHtml(row.poNo || row.poId || "-")}</div>
        `,
      },
      { title: "供应商", render: (row) => escapeHtml(row.supplierName || "-") },
      { title: "金额", render: (row) => formatMoney(row.paymentAmount ?? row.totalAmount) },
      {
        title: "审批状态",
        render: (row) => statusPill(row.paymentApprovalStatus || row.poStatus, {
          ...PAYMENT_STATUS_LABELS,
          ...PO_STATUS_LABELS,
        }),
      },
      { title: "申请人", render: (row) => escapeHtml(row.requestedByName || "-") },
      { title: "下一步", render: (row) => renderPaymentAction(row, user) },
    ],
  });

  return [
    renderCreatePurchaseRequestForm(model, user),
    renderSection({
      title: "采购申请列表",
      subtitle: "运营发起的 PR 在这里由采购接收、寻源、推进确认。",
      badge: `${purchaseRequests.length} 条`,
      table: requestTable,
    }),
    renderSection({
      title: "采购单列表",
      subtitle: "采购单用于跟踪财务审批、付款、供应商备货、到仓与入库。",
      badge: `${purchaseOrders.length} 张`,
      table: orderTable,
    }),
    renderSection({
      title: "付款审批入口",
      subtitle: "财务角色重点看这里；采购可以确认哪些 PO 已经进入付款链路。",
      badge: `${paymentQueue.length} 个`,
      table: paymentTable,
    }),
  ].join("");
}

function buildWarehouseSummaryCards(model) {
  const summary = model.summary || {};
  return [
    {
      title: "待到货",
      body: `<div class="primary-text">${formatQty(summary.pendingArrivalCount)} 单待确认</div><div class="muted">入库单共 ${formatQty(summary.inboundReceiptCount)} 张</div>`,
    },
    {
      title: "待核数 / 建批次",
      body: `<div class="primary-text">${formatQty(summary.arrivedCount + summary.countedCount)} 单处理中</div><div class="muted">已收数量 ${formatQty(summary.receivedQty)} 件</div>`,
    },
    {
      title: "库存批次",
      body: `<div class="primary-text">${formatQty(summary.inventoryBatchCount)} 个批次</div><div class="muted">新批次默认进入待 QC 锁定库存</div>`,
    },
  ];
}

function renderWarehouseReceiptActions(row, user) {
  const role = user?.role || "";
  if (!canRole(role, ["warehouse", "manager", "admin"])) return renderUnavailableAction("无权限");
  const actions = [];
  if (row.status === "pending_arrival") {
    actions.push(renderActionButton({
      endpoint: "/api/warehouse/action",
      action: "register_arrival",
      label: "确认到仓",
      fields: { receiptId: row.id },
    }));
  }
  if (row.status === "arrived") {
    actions.push(renderActionButton({
      endpoint: "/api/warehouse/action",
      action: "confirm_count",
      label: "确认核数",
      fields: { receiptId: row.id },
      className: "secondary",
    }));
  }
  if (row.status === "counted") {
    actions.push(renderActionButton({
      endpoint: "/api/warehouse/action",
      action: "create_batches",
      label: "创建批次",
      fields: { receiptId: row.id },
      className: "success",
    }));
  }
  return actions.length ? `<div class="actions">${actions.join("")}</div>` : renderUnavailableAction("无动作");
}

function renderWarehouseWorkbench(model = {}, user = {}) {
  const inboundReceipts = Array.isArray(model.inboundReceipts) ? model.inboundReceipts : [];
  const inventoryBatches = Array.isArray(model.inventoryBatches) ? model.inventoryBatches : [];

  const receiptTable = renderTable({
    rows: inboundReceipts,
    emptyText: "暂无待到货入库单。采购单发货后会进入这里。",
    columns: [
      {
        title: "入库单",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.receiptNo || row.id)}</div>
          <div class="muted">PO：${escapeHtml(row.poNo || row.poId || "-")}</div>
        `,
      },
      { title: "状态", render: (row) => statusPill(row.status, INBOUND_STATUS_LABELS) },
      {
        title: "供应商 / SKU",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.supplierName || "-")}</div>
          <div class="muted">${escapeHtml(row.skuSummary || "-")}</div>
        `,
      },
      {
        title: "数量",
        render: (row) => `
          <div class="primary-text">${formatQty(row.receivedQty)} / ${formatQty(row.expectedQty)} 已收</div>
          <div class="muted">破损 ${formatQty(row.damagedQty)} · 短少 ${formatQty(row.shortageQty)} · 多到 ${formatQty(row.overQty)}</div>
        `,
      },
      {
        title: "批次",
        render: (row) => `
          <div class="primary-text">${formatQty(row.batchLineCount)} / ${formatQty(row.lineCount)} 已建</div>
          <div class="muted">${escapeHtml(row.operatorName || "-")}</div>
        `,
      },
      { title: "到仓", render: (row) => formatDate(row.receivedAt) },
      { title: "动作", render: (row) => renderWarehouseReceiptActions(row, user) },
    ],
  });

  const batchTable = renderTable({
    rows: inventoryBatches,
    emptyText: "暂无库存批次。点击创建批次后会出现在这里。",
    columns: [
      {
        title: "批次",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.batchCode || row.id)}</div>
          <div class="muted">${escapeHtml(row.receiptNo || "-")}</div>
        `,
      },
      {
        title: "SKU",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.productName || "-")}</div>
          <div class="muted">${escapeHtml(row.internalSkuCode || row.skuId || "-")}</div>
        `,
      },
      {
        title: "数量",
        render: (row) => `
          <div class="primary-text">${formatQty(row.receivedQty)} 件</div>
          <div class="muted">可用 ${formatQty(row.availableQty)} · 锁定 ${formatQty(row.blockedQty)}</div>
        `,
      },
      { title: "QC", render: (row) => statusPill(row.qcStatus, BATCH_QC_STATUS_LABELS) },
      { title: "库位", render: (row) => escapeHtml(row.locationCode || "-") },
      { title: "入库时间", render: (row) => formatDate(row.receivedAt) },
    ],
  });

  return [
    renderSection({
      title: "待到货 / 入库单",
      subtitle: "仓管在这里确认到仓、核对数量，并把已核数的入库单创建为库存批次。",
      badge: `${inboundReceipts.length} 张`,
      table: receiptTable,
    }),
    renderSection({
      title: "库存批次",
      subtitle: "批次创建后默认进入锁定库存，等待运营抽检/QC 放行。",
      badge: `${inventoryBatches.length} 个`,
      table: batchTable,
    }),
  ].join("");
}

function formatPercent(value) {
  const number = Number(value || 0);
  return `${(number * 100).toFixed(1)}%`;
}

function buildQcSummaryCards(model) {
  const summary = model.summary || {};
  return [
    {
      title: "待抽检批次",
      body: `<div class="primary-text">${formatQty(summary.pendingBatchCount)} 个</div><div class="muted">锁定数量 ${formatQty(summary.blockedQty)} 件</div>`,
    },
    {
      title: "QC 进行中",
      body: `<div class="primary-text">${formatQty(summary.inProgressCount)} 单</div><div class="muted">待开始 ${formatQty(summary.pendingQcCount)} 单</div>`,
    },
    {
      title: "已判定",
      body: `<div class="primary-text">${formatQty(summary.completedCount)} 单</div><div class="muted">通过/部分通过/失败都会回写批次库存</div>`,
    },
  ];
}

function renderQcStartAction(row, user) {
  const role = user?.role || "";
  if (!canRole(role, ["operations", "manager", "admin"])) return renderUnavailableAction("无权限");
  if (row.qcStatusValue === "in_progress") return renderUnavailableAction("抽检中");
  return renderActionButton({
    endpoint: "/api/qc/action",
    action: "start_qc",
    label: "开始抽检",
    fields: {
      batchId: row.id,
      qcId: row.qcId,
    },
  });
}

function renderQcSubmitForm(row, user) {
  const role = user?.role || "";
  if (!canRole(role, ["operations", "manager", "admin"])) return renderUnavailableAction("无权限");
  const qcId = row.qcId || row.id;
  const batchId = row.batchId || row.id;
  const suggested = Number(row.suggestedSampleQty || row.actualSampleQty || 20);
  return `
    <form class="actions" method="post" action="/api/qc/action">
      <input type="hidden" name="action" value="submit_qc_percent" />
      <input type="hidden" name="qcId" value="${escapeHtml(qcId)}" />
      <input type="hidden" name="batchId" value="${escapeHtml(batchId)}" />
      <input class="mini-input" name="actualSampleQty" type="number" min="1" step="1" value="${escapeHtml(suggested || 1)}" title="抽检数" required />
      <input class="mini-input" name="defectiveQty" type="number" min="0" step="1" value="${escapeHtml(row.defectiveQty || row.qcDefectiveQty || 0)}" title="不良数" required />
      <input class="mini-input remark" name="remark" placeholder="备注" />
      <button class="action-chip success" type="submit">提交判定</button>
    </form>
  `;
}

function renderQcBatchAction(row, user) {
  if (row.qcStatusValue === "in_progress") return renderQcSubmitForm(row, user);
  return `<div class="actions">${renderQcStartAction(row, user)}${renderQcSubmitForm(row, user)}</div>`;
}

function renderQcInspectionAction(row, user) {
  if (row.status === "pending_qc") {
    return renderActionButton({
      endpoint: "/api/qc/action",
      action: "start_qc",
      label: "开始抽检",
      fields: {
        qcId: row.id,
        batchId: row.batchId,
      },
    });
  }
  if (row.status === "in_progress") {
    return renderQcSubmitForm(row, user);
  }
  return renderUnavailableAction("已判定");
}

function renderQcWorkbench(model = {}, user = {}) {
  const pendingBatches = Array.isArray(model.pendingBatches) ? model.pendingBatches : [];
  const inspections = Array.isArray(model.inspections) ? model.inspections : [];

  const batchTable = renderTable({
    rows: pendingBatches,
    emptyText: "暂无待抽检批次。仓库创建批次后会进入这里。",
    columns: [
      {
        title: "批次",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.batchCode || row.id)}</div>
          <div class="muted">${escapeHtml(row.receiptNo || "-")}</div>
        `,
      },
      {
        title: "SKU",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.productName || "-")}</div>
          <div class="muted">${escapeHtml(row.internalSkuCode || row.skuId || "-")}</div>
        `,
      },
      {
        title: "库存",
        render: (row) => `
          <div class="primary-text">${formatQty(row.receivedQty)} 件</div>
          <div class="muted">可用 ${formatQty(row.availableQty)} · 锁定 ${formatQty(row.blockedQty)}</div>
        `,
      },
      { title: "批次 QC", render: (row) => statusPill(row.qcStatus, BATCH_QC_STATUS_LABELS) },
      {
        title: "QC 单",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.qcId || "未创建")}</div>
          <div class="muted">${escapeHtml(row.inspectorName || "-")}</div>
        `,
      },
      { title: "抽检 / 不良", render: (row) => `${formatQty(row.actualSampleQty)} / ${formatQty(row.qcDefectiveQty)}` },
      { title: "操作", render: (row) => renderQcBatchAction(row, user) },
    ],
  });

  const inspectionTable = renderTable({
    rows: inspections,
    emptyText: "暂无 QC 单。",
    columns: [
      {
        title: "QC 单",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.id)}</div>
          <div class="muted">${escapeHtml(row.batchCode || row.batchId || "-")}</div>
        `,
      },
      {
        title: "SKU",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.productName || "-")}</div>
          <div class="muted">${escapeHtml(row.internalSkuCode || row.skuId || "-")}</div>
        `,
      },
      { title: "状态", render: (row) => statusPill(row.status, QC_STATUS_LABELS) },
      { title: "抽检 / 不良", render: (row) => `${formatQty(row.actualSampleQty)} / ${formatQty(row.defectiveQty)}` },
      { title: "不良率", render: (row) => formatPercent(row.defectRate) },
      {
        title: "释放 / 锁定",
        render: (row) => `${formatQty(row.releaseQty)} / ${formatQty(row.blockedQty)}`,
      },
      { title: "批次状态", render: (row) => statusPill(row.batchQcStatus, BATCH_QC_STATUS_LABELS) },
      { title: "操作", render: (row) => renderQcInspectionAction(row, user) },
    ],
  });

  return [
    renderSection({
      title: "待抽检批次",
      subtitle: "运营按简单百分比录入抽检数和不良数，系统自动判定通过、部分通过或失败。",
      badge: `${pendingBatches.length} 个`,
      table: batchTable,
    }),
    renderSection({
      title: "QC 记录",
      subtitle: "QC 判定结果会回写批次库存：通过释放库存，部分通过释放一部分，失败继续锁定。",
      badge: `${inspections.length} 单`,
      table: inspectionTable,
    }),
  ].join("");
}

function buildOutboundSummaryCards(model) {
  const summary = model.summary || {};
  return [
    {
      title: "可出库批次",
      body: `<div class="primary-text">${formatQty(summary.availableBatchCount)} 个</div><div class="muted">可用库存 ${formatQty(summary.availableQty)} 件</div>`,
    },
    {
      title: "仓库处理中",
      body: `<div class="primary-text">${formatQty(summary.pendingWarehouseCount + summary.pickingCount + summary.packedCount)} 单</div><div class="muted">待接收 / 拣货 / 已打包</div>`,
    },
    {
      title: "待运营确认",
      body: `<div class="primary-text">${formatQty(summary.pendingOpsConfirmCount)} 单</div><div class="muted">已发出后由运营确认出库完成</div>`,
    },
  ];
}

function renderCreateOutboundPlanForm(row, user) {
  const role = user?.role || "";
  if (!canRole(role, ["operations", "manager", "admin"])) return renderUnavailableAction("待运营");
  const maxQty = Math.max(1, Number(row.availableQty || 1));
  return `
    <form class="actions" method="post" action="/api/outbound/action">
      <input type="hidden" name="action" value="create_outbound_plan" />
      <input type="hidden" name="batchId" value="${escapeHtml(row.id)}" />
      <input class="mini-input" name="qty" type="number" min="1" max="${escapeHtml(maxQty)}" step="1" value="${escapeHtml(maxQty)}" title="出库数量" required />
      <input class="mini-input" name="boxes" type="number" min="1" step="1" value="1" title="箱数" />
      <input class="mini-input remark" name="remark" placeholder="备注" />
      <button class="action-chip" type="submit">创建计划</button>
    </form>
  `;
}

function renderOutboundShipmentActions(row, user) {
  const role = user?.role || "";
  const actions = [];
  if (row.status === "pending_warehouse" && canRole(role, ["warehouse", "manager", "admin"])) {
    actions.push(renderActionButton({
      endpoint: "/api/outbound/action",
      action: "start_picking",
      label: "开始拣货",
      fields: { outboundId: row.id },
    }));
  }
  if (row.status === "picking" && canRole(role, ["warehouse", "manager", "admin"])) {
    actions.push(`
      <form class="actions" method="post" action="/api/outbound/action">
        <input type="hidden" name="action" value="mark_packed" />
        <input type="hidden" name="outboundId" value="${escapeHtml(row.id)}" />
        <input class="mini-input" name="boxes" type="number" min="1" step="1" value="${escapeHtml(row.boxes || 1)}" title="箱数" />
        <button class="action-chip secondary" type="submit">打包完成</button>
      </form>
    `);
  }
  if (row.status === "packed" && canRole(role, ["warehouse", "manager", "admin"])) {
    actions.push(`
      <form class="actions" method="post" action="/api/outbound/action">
        <input type="hidden" name="action" value="confirm_shipped_out" />
        <input type="hidden" name="outboundId" value="${escapeHtml(row.id)}" />
        <input class="mini-input remark" name="logisticsProvider" placeholder="物流" />
        <input class="mini-input remark" name="trackingNo" placeholder="单号" />
        <button class="action-chip success" type="submit">确认发出</button>
      </form>
    `);
  }
  if (row.status === "pending_ops_confirm" && canRole(role, ["operations", "manager", "admin"])) {
    actions.push(renderActionButton({
      endpoint: "/api/outbound/action",
      action: "confirm_outbound_done",
      label: "确认完成",
      fields: { outboundId: row.id },
      className: "success",
    }));
  }
  return actions.length ? `<div class="actions">${actions.join("")}</div>` : renderUnavailableAction("等待");
}

function renderOutboundWorkbench(model = {}, user = {}) {
  const availableBatches = Array.isArray(model.availableBatches) ? model.availableBatches : [];
  const outboundShipments = Array.isArray(model.outboundShipments) ? model.outboundShipments : [];

  const batchTable = renderTable({
    rows: availableBatches,
    emptyText: "暂无可出库批次。QC 通过或部分通过后，可用库存会出现在这里。",
    columns: [
      {
        title: "批次",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.batchCode || row.id)}</div>
          <div class="muted">${escapeHtml(row.receiptNo || row.poNo || "-")}</div>
        `,
      },
      {
        title: "SKU",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.productName || "-")}</div>
          <div class="muted">${escapeHtml(row.internalSkuCode || row.skuId || "-")}</div>
        `,
      },
      {
        title: "库存",
        render: (row) => `
          <div class="primary-text">可用 ${formatQty(row.availableQty)}</div>
          <div class="muted">预留 ${formatQty(row.reservedQty)} · 锁定 ${formatQty(row.blockedQty)}</div>
        `,
      },
      { title: "QC", render: (row) => statusPill(row.qcStatus, BATCH_QC_STATUS_LABELS) },
      { title: "供应商", render: (row) => escapeHtml(row.supplierName || "-") },
      { title: "入库时间", render: (row) => formatDate(row.receivedAt) },
      { title: "出库计划", render: (row) => renderCreateOutboundPlanForm(row, user) },
    ],
  });

  const shipmentTable = renderTable({
    rows: outboundShipments,
    emptyText: "暂无出库/发货单。运营从可出库批次创建计划后会出现在这里。",
    columns: [
      {
        title: "发货单",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.shipmentNo || row.id)}</div>
          <div class="muted">${escapeHtml(row.id)}</div>
        `,
      },
      {
        title: "SKU / 批次",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.productName || "-")}</div>
          <div class="muted">${escapeHtml(row.internalSkuCode || row.skuId || "-")} · ${escapeHtml(row.batchCode || row.batchId || "-")}</div>
        `,
      },
      {
        title: "数量",
        render: (row) => `
          <div class="primary-text">${formatQty(row.qty)} 件</div>
          <div class="muted">${formatQty(row.boxes)} 箱</div>
        `,
      },
      { title: "状态", render: (row) => statusPill(row.status, OUTBOUND_STATUS_LABELS) },
      {
        title: "物流",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.logisticsProvider || "-")}</div>
          <div class="muted">${escapeHtml(row.trackingNo || "-")}</div>
        `,
      },
      {
        title: "处理人",
        render: (row) => `
          <div class="primary-text">${escapeHtml(row.warehouseOperatorName || "-")}</div>
          <div class="muted">运营确认：${escapeHtml(row.confirmedByName || "-")}</div>
        `,
      },
      { title: "动作", render: (row) => renderOutboundShipmentActions(row, user) },
    ],
  });

  return [
    renderSection({
      title: "可出库批次",
      subtitle: "运营从 QC 已放行的批次创建出库计划；创建后系统会预留库存，等待仓库处理。",
      badge: `${availableBatches.length} 个`,
      table: batchTable,
    }),
    renderSection({
      title: "出库 / 发货单",
      subtitle: "仓库负责拣货、打包和确认发出；发出后进入运营确认，运营确认后出库流程关闭。",
      badge: `${outboundShipments.length} 单`,
      table: shipmentTable,
    }),
  ].join("");
}

function createRequestHandler(options = {}) {
  const getErpStatus = options.getErpStatus || (() => ({}));
  const getPurchaseWorkbench = options.getPurchaseWorkbench || (() => ({
    summary: {},
    purchaseRequests: [],
    purchaseOrders: [],
    paymentApprovals: [],
    paymentQueue: [],
  }));
  const performPurchaseAction = options.performPurchaseAction || (() => {
    throw new Error("Purchase action handler is not available");
  });
  const getWarehouseWorkbench = options.getWarehouseWorkbench || (() => ({
    summary: {},
    inboundReceipts: [],
    inventoryBatches: [],
  }));
  const performWarehouseAction = options.performWarehouseAction || (() => {
    throw new Error("Warehouse action handler is not available");
  });
  const getQcWorkbench = options.getQcWorkbench || (() => ({
    summary: {},
    pendingBatches: [],
    inspections: [],
  }));
  const performQcAction = options.performQcAction || (() => {
    throw new Error("QC action handler is not available");
  });
  const getOutboundWorkbench = options.getOutboundWorkbench || (() => ({
    summary: {},
    availableBatches: [],
    outboundShipments: [],
  }));
  const performOutboundAction = options.performOutboundAction || (() => {
    throw new Error("Outbound action handler is not available");
  });
  const listWorkItems = options.listWorkItems || (() => []);
  const getWorkItemStats = options.getWorkItemStats || (() => ({
    total: 0,
    active: 0,
    byOwnerRole: {},
    byStatus: {},
    byPriority: {},
  }));
  const generateWorkItems = options.generateWorkItems || (() => ({
    created: 0,
    updated: 0,
    resolved: 0,
    items: [],
  }));
  const updateWorkItemStatus = options.updateWorkItemStatus || (() => {
    throw new Error("Work item action handler is not available");
  });
  const verifyLogin = options.verifyLogin || (() => null);

  return (req, res) => {
    handleRequest({
      req,
      res,
      getErpStatus,
      getPurchaseWorkbench,
      performPurchaseAction,
      getWarehouseWorkbench,
      performWarehouseAction,
      getQcWorkbench,
      performQcAction,
      getOutboundWorkbench,
      performOutboundAction,
      listWorkItems,
      getWorkItemStats,
      generateWorkItems,
      updateWorkItemStatus,
      verifyLogin,
    }).catch((error) => {
      writeJson(res, 500, {
        ok: false,
        error: error?.message || String(error),
      });
    });
  };
}

async function readRequestBody(req, maxBytes = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readLoginPayload(req) {
  const body = await readRequestBody(req);
  const contentType = String(req.headers["content-type"] || "");
  if (contentType.includes("application/json")) {
    return body ? JSON.parse(body) : {};
  }
  const params = new URLSearchParams(body);
  return Object.fromEntries(params.entries());
}

async function readOptionalPayload(req) {
  if (req.method === "GET" || req.method === "HEAD") return {};
  return readLoginPayload(req);
}

async function handleLoginRequest({ req, res, verifyLogin }) {
  const wantsJson = String(req.headers.accept || "").includes("application/json")
    || String(req.headers["content-type"] || "").includes("application/json");
  let payload = {};
  try {
    payload = await readLoginPayload(req);
  } catch (error) {
    if (wantsJson) {
      writeJson(res, 400, { ok: false, error: error?.message || "Invalid login request" });
      return;
    }
    writeHtml(res, renderLoginPage({ error: "登录请求格式不正确", next: "/" }), 400);
    return;
  }

  const next = normalizeLocalNext(payload.next);
  const user = verifyLogin({
    login: payload.login,
    accessCode: payload.accessCode,
  });

  if (!user) {
    if (wantsJson) {
      writeJson(res, 401, { ok: false, error: "用户名或访问码错误" });
      return;
    }
    writeHtml(res, renderLoginPage({ error: "用户名或访问码错误", next }), 401);
    return;
  }

  const token = createSession(user);
  if (wantsJson) {
    writeJson(res, 200, { ok: true, user }, { "Set-Cookie": buildSessionCookie(token) });
    return;
  }
  writeRedirect(res, next, {
    "Set-Cookie": buildSessionCookie(token),
  });
}

async function handlePurchaseActionRequest({ req, res, session, performPurchaseAction }) {
  const wantsJson = String(req.headers.accept || "").includes("application/json")
    || String(req.headers["content-type"] || "").includes("application/json");
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  let payload = {};
  try {
    payload = await readLoginPayload(req);
    const result = await performPurchaseAction(payload, session.user);
    if (wantsJson) {
      writeJson(res, 200, { ok: true, result });
      return;
    }
    writeRedirect(res, "/purchase");
  } catch (error) {
    if (wantsJson) {
      writeJson(res, 400, {
        ok: false,
        error: error?.message || String(error),
        code: error?.code || null,
      });
      return;
    }
    writeHtml(res, renderShell({
      title: "采购动作失败",
      subtitle: error?.message || String(error),
      cards: [
        {
          title: "处理建议",
          body: "请确认当前账号角色、单据状态和动作是否匹配，然后回到采购工作台重试。",
        },
        {
          title: "返回入口",
          body: '<a class="action-chip" href="/purchase">回到采购工作台</a>',
        },
      ],
      currentPath: "/purchase",
      user: session.user,
    }), 400);
  }
}

async function handleWarehouseActionRequest({ req, res, session, performWarehouseAction }) {
  const wantsJson = String(req.headers.accept || "").includes("application/json")
    || String(req.headers["content-type"] || "").includes("application/json");
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readLoginPayload(req);
    const result = await performWarehouseAction(payload, session.user);
    if (wantsJson) {
      writeJson(res, 200, { ok: true, result });
      return;
    }
    writeRedirect(res, "/warehouse");
  } catch (error) {
    if (wantsJson) {
      writeJson(res, 400, {
        ok: false,
        error: error?.message || String(error),
        code: error?.code || null,
      });
      return;
    }
    writeHtml(res, renderShell({
      title: "仓库动作失败",
      subtitle: error?.message || String(error),
      cards: [
        {
          title: "处理建议",
          body: "请确认当前账号角色、入库单状态和动作是否匹配，然后回到仓库工作台重试。",
        },
        {
          title: "返回入口",
          body: '<a class="action-chip" href="/warehouse">回到仓库工作台</a>',
        },
      ],
      currentPath: "/warehouse",
      user: session.user,
    }), 400);
  }
}

async function handleQcActionRequest({ req, res, session, performQcAction }) {
  const wantsJson = String(req.headers.accept || "").includes("application/json")
    || String(req.headers["content-type"] || "").includes("application/json");
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readLoginPayload(req);
    const result = await performQcAction(payload, session.user);
    if (wantsJson) {
      writeJson(res, 200, { ok: true, result });
      return;
    }
    writeRedirect(res, "/qc");
  } catch (error) {
    if (wantsJson) {
      writeJson(res, 400, {
        ok: false,
        error: error?.message || String(error),
        code: error?.code || null,
      });
      return;
    }
    writeHtml(res, renderShell({
      title: "QC 动作失败",
      subtitle: error?.message || String(error),
      cards: [
        {
          title: "处理建议",
          body: "请确认当前账号角色、QC 单状态、抽检数和不良数是否正确，然后回到 QC 工作台重试。",
        },
        {
          title: "返回入口",
          body: '<a class="action-chip" href="/qc">回到 QC 工作台</a>',
        },
      ],
      currentPath: "/qc",
      user: session.user,
    }), 400);
  }
}

async function handleOutboundActionRequest({ req, res, session, performOutboundAction }) {
  const wantsJson = String(req.headers.accept || "").includes("application/json")
    || String(req.headers["content-type"] || "").includes("application/json");
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readLoginPayload(req);
    const result = await performOutboundAction(payload, session.user);
    if (wantsJson) {
      writeJson(res, 200, { ok: true, result });
      return;
    }
    writeRedirect(res, "/outbound");
  } catch (error) {
    if (wantsJson) {
      writeJson(res, 400, {
        ok: false,
        error: error?.message || String(error),
        code: error?.code || null,
      });
      return;
    }
    writeHtml(res, renderShell({
      title: "出库动作失败",
      subtitle: error?.message || String(error),
      cards: [
        {
          title: "处理建议",
          body: "请确认当前账号角色、发货单状态、库存预留数量和动作是否匹配，然后回到出库/发货工作台重试。",
        },
        {
          title: "返回入口",
          body: '<a class="action-chip" href="/outbound">回到出库/发货工作台</a>',
        },
      ],
      currentPath: "/outbound",
      user: session.user,
    }), 400);
  }
}

async function handleRequest({
  req,
  res,
  getErpStatus,
  getPurchaseWorkbench,
  performPurchaseAction,
  getWarehouseWorkbench,
  performWarehouseAction,
  getQcWorkbench,
  performQcAction,
  getOutboundWorkbench,
  performOutboundAction,
  listWorkItems,
  getWorkItemStats,
  generateWorkItems,
  updateWorkItemStatus,
  verifyLogin,
}) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "X-Content-Type-Options": "nosniff",
      });
      res.end();
      return;
    }

    const pathname = getRequestPath(req);
    if (pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname === "/login") {
      const parsed = new URL(req.url || "/", "http://127.0.0.1");
      writeHtml(res, renderLoginPage({ next: normalizeLocalNext(parsed.searchParams.get("next")) }));
      return;
    }

    if (pathname === "/logout") {
      destroySession(req);
      writeRedirect(res, "/login", {
        "Set-Cookie": buildClearSessionCookie(),
      });
      return;
    }

    if (pathname === "/api/login") {
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      await handleLoginRequest({ req, res, verifyLogin });
      return;
    }

    if (pathname === "/health") {
      writeJson(res, 200, {
        ok: true,
        service: "temu-erp-lan",
        name: os.hostname(),
        running: true,
        startedAt: lanState.startedAt,
      });
      return;
    }

    if (pathname === "/api/status") {
      const session = getSessionFromRequest(req);
      writeJson(res, 200, {
        ok: true,
        lan: getLanStatus(),
        erp: getErpStatus(),
        user: session?.user || null,
      });
      return;
    }

    const protectedPath = ROLE_PERMISSIONS[pathname] ? pathname : null;
    const session = protectedPath ? getSessionFromRequest(req) : null;
    if (protectedPath && !session) {
      if (pathname.startsWith("/api/")) {
        writeJson(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }
      writeRedirect(res, `/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (protectedPath && !isRoleAllowed(pathname, session.user.role)) {
      if (pathname.startsWith("/api/")) {
        writeJson(res, 403, { ok: false, error: "Forbidden" });
        return;
      }
      writeForbidden(res, session.user, pathname);
      return;
    }

    if (pathname === "/api/purchase/workbench") {
      writeJson(res, 200, {
        ok: true,
        workbench: await getPurchaseWorkbench({ user: session.user }),
      });
      return;
    }

    if (pathname === "/api/purchase/action") {
      await handlePurchaseActionRequest({
        req,
        res,
        session,
        performPurchaseAction,
      });
      return;
    }

    if (pathname === "/api/warehouse/workbench") {
      writeJson(res, 200, {
        ok: true,
        workbench: await getWarehouseWorkbench({ user: session.user }),
      });
      return;
    }

    if (pathname === "/api/warehouse/action") {
      await handleWarehouseActionRequest({
        req,
        res,
        session,
        performWarehouseAction,
      });
      return;
    }

    if (pathname === "/api/qc/workbench") {
      writeJson(res, 200, {
        ok: true,
        workbench: await getQcWorkbench({ user: session.user }),
      });
      return;
    }

    if (pathname === "/api/qc/action") {
      await handleQcActionRequest({
        req,
        res,
        session,
        performQcAction,
      });
      return;
    }

    if (pathname === "/api/outbound/workbench") {
      writeJson(res, 200, {
        ok: true,
        workbench: await getOutboundWorkbench({ user: session.user }),
      });
      return;
    }

    if (pathname === "/api/outbound/action") {
      await handleOutboundActionRequest({
        req,
        res,
        session,
        performOutboundAction,
      });
      return;
    }

    if (pathname === "/api/work-items/list") {
      const payload = await readOptionalPayload(req);
      writeJson(res, 200, {
        ok: true,
        items: await listWorkItems(payload, session.user),
      });
      return;
    }

    if (pathname === "/api/work-items/stats") {
      const payload = await readOptionalPayload(req);
      writeJson(res, 200, {
        ok: true,
        stats: await getWorkItemStats(payload, session.user),
      });
      return;
    }

    if (pathname === "/api/work-items/generate") {
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const payload = await readOptionalPayload(req);
      writeJson(res, 200, {
        ok: true,
        result: await generateWorkItems(payload, session.user),
      });
      return;
    }

    if (pathname === "/api/work-items/update-status") {
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const payload = await readOptionalPayload(req);
      writeJson(res, 200, {
        ok: true,
        item: await updateWorkItemStatus(payload, session.user),
      });
      return;
    }

    if (pathname === "/") {
      writeHtml(res, renderShell({
        title: "Temu ERP 局域网入口",
        subtitle: "采购、仓库和 QC 网页工作台的本地服务已经启动。",
        cards: buildLandingCards(),
        currentPath: "/",
        user: session.user,
      }));
      return;
    }

    if (pathname === "/purchase") {
      const model = await getPurchaseWorkbench({ user: session.user });
      writeHtml(res, renderShell({
        title: "采购工作台",
        subtitle: "采购接收运营 PR，跟踪采购单，并把待财务处理的付款事项集中到一个入口。",
        cards: buildPurchaseSummaryCards(model),
        currentPath: pathname,
        user: session.user,
        content: renderPurchaseWorkbench(model, session.user),
      }));
      return;
    }

    if (pathname === "/warehouse") {
      const model = await getWarehouseWorkbench({ user: session.user });
      writeHtml(res, renderShell({
        title: "仓库工作台",
        subtitle: "仓管在这里处理待到货、确认到仓、核数和创建库存批次。",
        cards: buildWarehouseSummaryCards(model),
        currentPath: pathname,
        user: session.user,
        content: renderWarehouseWorkbench(model, session.user),
      }));
      return;
    }

    if (pathname === "/qc") {
      const model = await getQcWorkbench({ user: session.user });
      writeHtml(res, renderShell({
        title: "QC 工作台",
        subtitle: "运营录入抽检数和不良数，系统按不良率自动判定并释放或锁定库存。",
        cards: buildQcSummaryCards(model),
        currentPath: pathname,
        user: session.user,
        content: renderQcWorkbench(model, session.user),
      }));
      return;
    }

    if (pathname === "/outbound") {
      const model = await getOutboundWorkbench({ user: session.user });
      writeHtml(res, renderShell({
        title: "出库 / 发货工作台",
        subtitle: "运营创建出库计划，仓库拣货、打包并确认发出，最后由运营确认出库完成。",
        cards: buildOutboundSummaryCards(model),
        currentPath: pathname,
        user: session.user,
        content: renderOutboundWorkbench(model, session.user),
      }));
      return;
    }

    writeJson(res, 404, {
      ok: false,
      error: "Not found",
      path: pathname,
    });
}

function startLanServer(options = {}) {
  if (lanState.server) {
    return Promise.resolve(getLanStatus());
  }

  const port = Number.isInteger(Number(options.port)) && Number(options.port) >= 0
    ? Number(options.port)
    : DEFAULT_LAN_PORT;
  const bindAddress = options.bindAddress || DEFAULT_BIND_ADDRESS;
  const handler = createRequestHandler(options);
  const server = http.createServer(handler);
  server.on("upgrade", handleWebSocketUpgrade);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.removeAllListeners("error");
      server.removeAllListeners("listening");
    };

    server.once("error", (error) => {
      cleanup();
      lanState.lastError = error.message || String(error);
      reject(error);
    });

    server.once("listening", () => {
      cleanup();
      const address = server.address();
      lanState.server = server;
      lanState.port = address && typeof address === "object" ? Number(address.port) : port;
      lanState.bindAddress = bindAddress;
      lanState.startedAt = new Date().toISOString();
      lanState.lastError = null;
      resolve(getLanStatus());
    });

    server.listen(port, bindAddress);
  });
}

function stopLanServer() {
  if (!lanState.server) {
    return Promise.resolve(getLanStatus({
      running: false,
      startedAt: null,
    }));
  }

  const server = lanState.server;
  for (const client of Array.from(lanState.wsClients)) {
    try { client.socket.destroy(); } catch {}
  }
  lanState.wsClients.clear();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        lanState.lastError = error.message || String(error);
        reject(error);
        return;
      }
      lanState.server = null;
      lanState.startedAt = null;
      resolve(getLanStatus());
    });
  });
}

module.exports = {
  DEFAULT_BIND_ADDRESS,
  DEFAULT_LAN_PORT,
  createRequestHandler,
  getLanAddresses,
  getLanStatus,
  broadcastLanEvent,
  startLanServer,
  stopLanServer,
};
