const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');

class QueryPool {
  constructor(options = {}) {
    const size = options.size || Math.max(2, Math.min(4, os.cpus().length - 2));
    if (!options.dbPath) {
      throw new Error('QueryPool requires dbPath');
    }

    this.size = size;
    this.dbPath = options.dbPath;
    this.workerPath = path.join(__dirname, 'queryWorker.cjs');
    this.workers = [];
    this.idleWorkers = [];
    this.queue = [];
    this.pending = new Map();
    this.nextId = 1;
    this.draining = false;
    this.spawned = false;
  }

  spawn() {
    if (this.spawned) return;
    this.spawned = true;
    for (let index = 0; index < this.size; index += 1) {
      this.spawnWorker(index);
    }
    console.log(`[QueryPool] spawned ${this.size} workers`);
  }

  run(handler, args) {
    if (this.draining) {
      return Promise.reject(new Error('QueryPool is draining'));
    }
    if (!this.spawned) {
      this.spawn();
    }

    return new Promise((resolve, reject) => {
      const task = {
        id: this.nextId,
        handler,
        args,
        resolve,
        reject,
      };
      this.nextId += 1;
      this.queue.push(task);
      this.dispatch();
    });
  }

  drain() {
    this.draining = true;
    const error = new Error('QueryPool drained');

    for (const task of this.queue.splice(0)) {
      task.reject(error);
    }

    for (const [id, task] of this.pending.entries()) {
      this.pending.delete(id);
      task.reject(error);
    }

    const terminations = this.workers
      .filter(Boolean)
      .map((slot) => slot.worker.terminate().catch(() => {}));

    this.workers = [];
    this.idleWorkers = [];
    return Promise.all(terminations);
  }

  spawnWorker(index) {
    const worker = new Worker(this.workerPath, {
      workerData: {
        dbPath: this.dbPath,
        index,
      },
    });
    const slot = {
      index,
      worker,
      currentTaskId: null,
    };
    this.workers[index] = slot;
    this.idleWorkers.push(slot);

    worker.on('message', (message) => this.handleMessage(slot, message));
    worker.on('error', (error) => {
      console.error(`[QueryPool] worker ${index} error`, error);
    });
    worker.on('exit', (code) => this.handleExit(slot, code));

    this.dispatch();
  }

  handleMessage(slot, message = {}) {
    const task = this.pending.get(message.id);
    if (!task) return;

    this.pending.delete(message.id);
    slot.currentTaskId = null;

    if (message.error) {
      task.reject(new Error(message.error));
    } else {
      task.resolve(message.result);
    }

    if (!this.draining) {
      this.idleWorkers.push(slot);
      this.dispatch();
    }
  }

  handleExit(slot, code) {
    this.removeIdleWorker(slot);
    if (slot.currentTaskId !== null) {
      const task = this.pending.get(slot.currentTaskId);
      this.pending.delete(slot.currentTaskId);
      if (task) {
        task.reject(new Error(`Query worker ${slot.index} exited with code ${code}`));
      }
    }

    if (this.workers[slot.index] === slot) {
      this.workers[slot.index] = null;
    }

    if (!this.draining) {
      console.error(`[QueryPool] worker ${slot.index} crashed with code ${code}`);
      this.spawnWorker(slot.index);
    }
  }

  dispatch() {
    while (!this.draining && this.queue.length && this.idleWorkers.length) {
      const slot = this.idleWorkers.shift();
      if (!slot || this.workers[slot.index] !== slot) continue;

      const task = this.queue.shift();
      slot.currentTaskId = task.id;
      this.pending.set(task.id, task);
      slot.worker.postMessage({
        id: task.id,
        handler: task.handler,
        args: task.args,
      });
    }
  }

  removeIdleWorker(slot) {
    const index = this.idleWorkers.indexOf(slot);
    if (index !== -1) {
      this.idleWorkers.splice(index, 1);
    }
  }
}

module.exports = { QueryPool };
