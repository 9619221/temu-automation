const TASKS = [
  { id: "sales_trend", name: "销售" }, { id: "review", name: "评论" },
  { id: "compliance_prop", name: "合规" }, { id: "price", name: "价格" },
  { id: "flow", name: "流量" }, { id: "quality", name: "品质" },
  { id: "income", name: "收入" }, { id: "settlement", name: "结算" },
  { id: "shop_stats", name: "店铺" }, { id: "products", name: "商品" },
  { id: "hpf", name: "爆品" }, { id: "fund_detail", name: "资金" },
  { id: "compliance", name: "巡查" }, { id: "aftersales", name: "售后" },
];

function rel(ts) {
  if (!ts) return "—";
  const d = Date.now() - ts;
  if (d < 60000) return "刚刚";
  if (d < 3600000) return Math.floor(d / 60000) + "m";
  if (d < 86400000) return Math.floor(d / 3600000) + "h";
  return Math.floor(d / 86400000) + "d";
}

function esc(s) { return String(s ?? "").replace(/</g, "&lt;"); }

function taskColor(ts) {
  if (!ts) return "x";
  const age = Date.now() - ts;
  return age < 12*3600000 ? "g" : age < 48*3600000 ? "y" : "r";
}

function refresh() {
  chrome.runtime.sendMessage({ type: "QUERY_STATUS" }, (r) => {
    if (chrome.runtime.lastError || !r) return;
    const pill = document.getElementById("pill");
    pill.textContent = r.configured ? "已连接" : "未配置";
    pill.className = "pill" + (r.configured ? "" : " off");

    const s = r.stats || {};
    document.getElementById("captured").textContent = (s.captured_count || 0).toLocaleString();
    document.getElementById("sent").textContent = (s.total_sent || 0).toLocaleString();
    document.getElementById("queue").textContent = r.queueDepth >= 0 ? r.queueDepth : "—";
    document.getElementById("lastFlush").textContent = rel(s.last_flush_at);

    // Tasks summary
    const tasks = r.tasks || {};
    let ok = 0, warn = 0, err = 0;
    const lines = [];
    TASKS.forEach((t) => {
      const st = tasks[t.id] || {};
      const ts = st.last_success_at || 0;
      const c = taskColor(ts);
      if (c === "g") ok++; else if (c === "y") warn++; else err++;
      lines.push(`<span class="dot dot-${c}"></span>${t.name} ${rel(ts)}`);
    });
    document.getElementById("taskSummary").innerHTML =
      `<span class="dot dot-g"></span>${ok} ` +
      (warn ? `<span class="dot dot-y"></span>${warn} ` : "") +
      (err ? `<span class="dot dot-r"></span>${err} ` : "") +
      '<span class="arrow">›</span>';
    document.getElementById("taskDetail").innerHTML = lines.join("&nbsp;&nbsp;");

    // Malls
    const malls = (r.malls || []).filter((m) => m && m.mallId);
    document.getElementById("mallCount").textContent = malls.length;
    const md = document.getElementById("mallDetail");
    if (!malls.length) { md.innerHTML = '<div style="color:var(--text-3)">登录 Temu 后台后自动识别</div>'; }
    else { md.innerHTML = malls.map((m) => `<div style="padding:2px 0"><span class="tag">${esc((m.site||"").toUpperCase().slice(0,4))||"—"}</span> ${esc(m.mallName||m.mallId)}</div>`).join(""); }
  });
}

// Toggle sections
document.getElementById("taskToggle").addEventListener("click", () => {
  document.getElementById("taskToggle").classList.toggle("open");
  document.getElementById("taskDetail").classList.toggle("show");
});
document.getElementById("mallToggle").addEventListener("click", () => {
  document.getElementById("mallToggle").classList.toggle("open");
  document.getElementById("mallDetail").classList.toggle("show");
});

document.getElementById("flushBtn").addEventListener("click", () => {
  const b = document.getElementById("flushBtn"); b.disabled = true; b.textContent = "…";
  chrome.runtime.sendMessage({ type: "FLUSH_NOW" }, () => { b.disabled = false; b.textContent = "同步"; setTimeout(refresh, 500); });
});
document.getElementById("collectBtn").addEventListener("click", () => {
  const b = document.getElementById("collectBtn"); b.disabled = true; b.textContent = "…";
  chrome.runtime.sendMessage({ type: "TRIGGER_COMPLIANCE_PROP" }, () => { b.disabled = false; b.textContent = "采集"; setTimeout(refresh, 1000); });
});
document.getElementById("optBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("reload").addEventListener("click", (e) => { e.preventDefault(); refresh(); });

document.getElementById("ver").textContent = "v" + chrome.runtime.getManifest().version;
refresh();
setInterval(refresh, 3000);
