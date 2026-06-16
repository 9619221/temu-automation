"use strict";

const { spawn } = require("child_process");
const path = require("path");

/**
 * 串行子进程调度器。
 * 同一时刻最多 fork 一个 cron 子进程，消除多独立进程并发竞争 SQLite 磁盘 I/O 的根因。
 * 主进程事件循环完全不受阻塞。
 */
class CronScheduler {
  constructor(opts = {}) {
    this._tasks = new Map();
    this._queue = [];
    this._processing = false;
    this._stopped = false;
    this._currentChild = null;
    this._erpDbPath = opts.erpDbPath || null;
    this._log = opts.log || ((msg) => console.log(`[cron-scheduler] ${msg}`));
  }

  register(name, intervalMs, scriptPath, env = {}) {
    if (this._tasks.has(name)) throw new Error(`task "${name}" already registered`);
    this._tasks.set(name, {
      scriptPath,
      env,
      intervalMs,
      timer: null,
      lastRun: null,
      lastDurationMs: null,
      lastError: null,
      running: false,
    });
  }

  start(initialDelayMs = 60000) {
    this._stopped = false;
    const STAGGER = 10000;
    let offset = 0;
    for (const [name, task] of this._tasks) {
      const delay = initialDelayMs + offset;
      const firstTimer = setTimeout(() => {
        if (this._stopped) return;
        this.enqueue(name);
        task.timer = setInterval(() => this.enqueue(name), task.intervalMs);
      }, delay);
      task._firstTimer = firstTimer;
      offset += STAGGER;
      this._log(`registered "${name}" interval=${Math.round(task.intervalMs / 60000)}min firstRun=${Math.round(delay / 1000)}s`);
    }
  }

  stop() {
    this._stopped = true;
    for (const [, task] of this._tasks) {
      if (task.timer) { clearInterval(task.timer); task.timer = null; }
      if (task._firstTimer) { clearTimeout(task._firstTimer); task._firstTimer = null; }
    }
    this._queue.length = 0;
    if (this._currentChild) {
      try { this._currentChild.kill("SIGTERM"); } catch {}
      this._currentChild = null;
    }
  }

  enqueue(name) {
    if (!this._tasks.has(name) || this._stopped) return;
    if (this._queue.includes(name)) {
      this._log(`"${name}" already queued, skip`);
      return;
    }
    this._queue.push(name);
    this._drain();
  }

  async _drain() {
    if (this._processing) return;
    this._processing = true;
    try {
      while (this._queue.length > 0 && !this._stopped) {
        const name = this._queue.shift();
        const task = this._tasks.get(name);
        if (!task) continue;
        task.running = true;
        const t0 = Date.now();
        try {
          this._log(`>> ${name}`);
          await this._runChild(task);
          task.lastError = null;
          this._log(`<< ${name} OK ${((Date.now() - t0) / 1000).toFixed(1)}s`);
          this._passiveCheckpoint();
        } catch (e) {
          task.lastError = (e && e.message) || String(e);
          this._log(`<< ${name} FAIL ${((Date.now() - t0) / 1000).toFixed(1)}s err=${task.lastError}`);
        } finally {
          task.running = false;
          task.lastRun = Date.now();
          task.lastDurationMs = Date.now() - t0;
          this._currentChild = null;
        }
      }
    } finally {
      this._processing = false;
    }
  }

  _runChild(task) {
    return new Promise((resolve, reject) => {
      const child = spawn("ionice", ["-c3", "nice", "-n19", process.execPath, task.scriptPath], {
        env: { ...process.env, ...task.env },
        stdio: ["ignore", "pipe", "pipe"],
        cwd: path.dirname(task.scriptPath),
      });
      this._currentChild = child;
      let stderr = "";
      child.stdout.on("data", (d) => {
        for (const line of d.toString().split("\n").filter(Boolean)) this._log(`  ${line}`);
      });
      child.stderr.on("data", (d) => { stderr += d.toString(); });
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`exit ${code}: ${stderr.slice(0, 200)}`));
      });
      child.on("error", reject);
    });
  }

  _passiveCheckpoint() {
    if (!this._erpDbPath) return;
    try {
      const Database = require("better-sqlite3");
      const db = new Database(this._erpDbPath, { readonly: false });
      const r = db.pragma("wal_checkpoint(PASSIVE)");
      db.close();
      if (r && r[0]) this._log(`  checkpoint: busy=${r[0].busy} log=${r[0].log} checkpointed=${r[0].checkpointed}`);
    } catch (e) {
      this._log(`  checkpoint err: ${e && e.message}`);
    }
  }

  getStatus() {
    const out = {};
    for (const [name, task] of this._tasks) {
      out[name] = {
        intervalMin: Math.round(task.intervalMs / 60000),
        running: task.running,
        queued: this._queue.includes(name),
        lastRun: task.lastRun ? new Date(task.lastRun).toISOString() : null,
        lastDurationMs: task.lastDurationMs,
        lastError: task.lastError,
      };
    }
    out._queueLength = this._queue.length;
    return out;
  }
}

module.exports = { CronScheduler };
