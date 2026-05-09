// ============================================================
// IndexedDB 上报队列
// ============================================================
// service worker 会被 Chrome 频繁回收，setInterval 不可用 → 用 chrome.alarms
// 数据持久化在 IndexedDB，SW 重新唤醒时仍能继续上报
// 一次最多打包 50 条，失败按 exp backoff 重试

import { DB_NAME, DB_VERSION, STORE_QUEUE } from "./hook-config.js";

const BATCH_SIZE = 50;
const MAX_RETRIES = 6;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const store = db.createObjectStore(STORE_QUEUE, { keyPath: "id", autoIncrement: true });
        store.createIndex("ts", "ts");
        store.createIndex("retries", "retries");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, mode);
    const store = tx.objectStore(STORE_QUEUE);
    const result = fn(store);
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export async function enqueue(payload) {
  await withStore("readwrite", (store) => {
    store.add({
      ts: Date.now(),
      retries: 0,
      payload,
    });
  });
}

export async function queueDepth() {
  return withStore("readonly", (store) => {
    return new Promise((resolve) => {
      const r = store.count();
      r.onsuccess = () => resolve(r.result);
    });
  });
}

async function takeBatch(limit) {
  return withStore("readonly", (store) => {
    return new Promise((resolve) => {
      const out = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = (ev) => {
        const cur = ev.target.result;
        if (!cur || out.length >= limit) return resolve(out);
        out.push(cur.value);
        cur.continue();
      };
    });
  });
}

async function deleteIds(ids) {
  await withStore("readwrite", (store) => {
    for (const id of ids) store.delete(id);
  });
}

async function bumpRetries(items) {
  await withStore("readwrite", (store) => {
    for (const item of items) {
      const r = item.retries + 1;
      if (r >= MAX_RETRIES) {
        store.delete(item.id);
      } else {
        store.put({ ...item, retries: r, lastError: item.lastError });
      }
    }
  });
}

// ============================================================
// 上传：从 chrome.storage.local 读云端 URL + JWT
// ============================================================
async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["cloud_endpoint", "auth_token", "device_id"], (v) => resolve(v));
  });
}

export async function flush() {
  const { cloud_endpoint, auth_token, device_id } = await getConfig();
  if (!cloud_endpoint || !auth_token) {
    return { ok: false, reason: "未配置云端" };
  }
  const items = await takeBatch(BATCH_SIZE);
  if (!items.length) return { ok: true, sent: 0 };

  let resp;
  try {
    resp = await fetch(cloud_endpoint.replace(/\/$/, "") + "/api/ingest/v1/batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${auth_token}`,
        "X-Device-Id": device_id || "",
      },
      body: JSON.stringify({
        items: items.map((it) => ({ ts: it.ts, ...it.payload })),
      }),
      keepalive: false,
    });
  } catch (e) {
    await bumpRetries(items.map((it) => ({ ...it, lastError: String(e).slice(0, 200) })));
    return { ok: false, reason: "网络错误", error: String(e).slice(0, 200) };
  }

  if (resp.ok) {
    await deleteIds(items.map((it) => it.id));
    return { ok: true, sent: items.length };
  }
  // 4xx：丢弃这一批避免反复占队列
  if (resp.status >= 400 && resp.status < 500) {
    await deleteIds(items.map((it) => it.id));
    return { ok: false, sent: 0, reason: `HTTP ${resp.status}（已丢弃）` };
  }
  // 5xx：重试
  await bumpRetries(items.map((it) => ({ ...it, lastError: `HTTP ${resp.status}` })));
  return { ok: false, reason: `HTTP ${resp.status}` };
}

export async function purge() {
  await withStore("readwrite", (store) => store.clear());
}
