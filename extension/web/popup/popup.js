const TASK_META = {
  sales_trend: { name: "销售趋势", key: "last_success_at" },
  review: { name: "评论采集", key: "last_success_at" },
  hpf: { name: "爆品推荐", key: "last_success_at" },
  compliance: { name: "合规巡查", key: "last_success_at" },
  compliance_prop: { name: "合规属性", key: "last_success_at" },
  price: { name: "价格监控", key: "last_success_at" },
  income: { name: "收入概况", key: "last_success_at" },
  settlement: { name: "结算明细", key: "last_success_at" },
  fund_detail: { name: "资金流水", key: "last_success_at" },
  shop_stats: { name: "店铺数据", key: "last_success_at" },
  flow: { name: "流量分析", key: "last_success_at" },
  quality: { name: "品质数据", key: "last_success_at" },
  products: { name: "商品快照", key: "last_success_at" },
  aftersales: { name: "售后数据", key: "last_success_at" },
};

const SITE_CLASSES = { eu: "site-eu", us: "site-us", jp: "site-jp" };

function fmt(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getSiteClass(site) {
  if (!site) return "site-default";
  const s = site.toLowerCase();
  for (const [key, cls] of Object.entries(SITE_CLASSES)) {
    if (s.includes(key)) return cls;
  }
  return "site-default";
}

function getTaskDot(state) {
  if (!state || !state.last_success_at) return "dot-gray";
  const age = Date.now() - state.last_success_at;
  if (age < 12 * 3600000) return "dot-green";
  if (age < 48 * 3600000) return "dot-yellow";
  return "dot-red";
}

function renderTasks(tasks) {
  const grid = document.getElementById("taskGrid");
  if (!tasks || !Object.keys(tasks).length) {
    grid.innerHTML = '<div class="empty-hint" style="grid-column:1/-1">暂无任务状态</div>';
    return;
  }
  grid.innerHTML = Object.entries(TASK_META)
    .map(([id, meta]) => {
      const state = tasks[id] || {};
      const ts = state[meta.key] || state.last_run_at || 0;
      const dotCls = getTaskDot(state);
      return `<div class="task-item"><span class="dot ${dotCls}"></span><span class="task-name">${meta.name}</span><span class="task-time">${fmt(ts)}</span></div>`;
    })
    .join("");
}

function renderMalls(malls) {
  const list = document.getElementById("mallList");
  const filtered = (malls || []).filter((m) => m && m.mallId);
  document.getElementById("mallCount").textContent = filtered.length;
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-hint">打开 Temu 后台登录，扩展会自动识别店铺</div>';
    return;
  }
  list.innerHTML = filtered
    .map((m) => {
      const siteCls = getSiteClass(m.site);
      const name = escapeHtml(m.mallName || m.mallId);
      const site = escapeHtml((m.site || "").toUpperCase().slice(0, 5));
      return `<div class="mall-item"><span class="site-badge ${siteCls}">${site || "?"}</span><span class="mall-name">${name}</span><span class="mall-id">${escapeHtml(m.mallId)}</span></div>`;
    })
    .join("");
}

function refresh() {
  chrome.runtime.sendMessage({ type: "QUERY_STATUS" }, (resp) => {
    if (chrome.runtime.lastError || !resp) return;

    const cfgEl = document.getElementById("cfg");
    if (resp.configured) {
      cfgEl.innerHTML = '<span class="dot dot-green"></span>已连接';
    } else {
      cfgEl.innerHTML = '<span class="dot dot-red"></span>未配置';
    }

    const stats = resp.stats || {};
    document.getElementById("captured").textContent = (stats.captured_count || 0).toLocaleString();
    document.getElementById("sent").textContent = (stats.total_sent || 0).toLocaleString();
    document.getElementById("queue").textContent = resp.queueDepth >= 0 ? resp.queueDepth : "?";
    document.getElementById("lastFlush").textContent = fmt(stats.last_flush_at);

    const statusLine = document.getElementById("statusLine");
    const r = stats.last_flush_result;
    if (r && r.ok) {
      statusLine.textContent = `上次上报成功 · ${r.sent || 0} 条`;
    } else if (r && !r.ok) {
      statusLine.textContent = `上报异常: ${(r.reason || "未知").slice(0, 30)}`;
    } else {
      statusLine.textContent = resp.configured ? "运行正常" : "请先完成云端配置";
    }

    renderTasks(resp.tasks || {});
    renderMalls(resp.malls);
  });
}

document.getElementById("flushBtn").addEventListener("click", () => {
  const btn = document.getElementById("flushBtn");
  btn.disabled = true;
  btn.textContent = "上报中...";
  chrome.runtime.sendMessage({ type: "FLUSH_NOW" }, () => {
    btn.disabled = false;
    btn.textContent = "立即上报";
    setTimeout(refresh, 500);
  });
});

document.getElementById("collectBtn").addEventListener("click", () => {
  const btn = document.getElementById("collectBtn");
  btn.disabled = true;
  btn.textContent = "采集中...";
  chrome.runtime.sendMessage({ type: "TRIGGER_COMPLIANCE_PROP" }, () => {
    btn.disabled = false;
    btn.textContent = "立即采集";
    setTimeout(refresh, 1000);
  });
});

document.getElementById("startCollectorBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "START_COLLECTOR" }, () => refresh());
});

document.getElementById("stopCollectorBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "STOP_COLLECTOR" }, () => refresh());
});

document.getElementById("optBtn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("reload").addEventListener("click", (e) => {
  e.preventDefault();
  refresh();
});

// Version display
const manifest = chrome.runtime.getManifest();
document.getElementById("ver").textContent = `v${manifest.version}`;

refresh();
setInterval(refresh, 3000);
