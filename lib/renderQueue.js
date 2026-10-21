// Bound browser work independently from HTTP traffic and cache hits.
class RenderQueue {
  constructor(limit, maxQueued, waitMs) {
    this.limit = limit;
    this.maxQueued = maxQueued;
    this.waitMs = waitMs;
    this.active = 0;
    this.waiting = [];
  }

  acquire() {
    return new Promise((resolve, reject) => {
      const start = () => {
        this.active++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active--;
          const next = this.waiting.shift();
          if (next) {
            clearTimeout(next.timer);
            next.start();
          }
        });
      };
      if (this.active < this.limit) return start();
      if (this.waiting.length >= this.maxQueued) return reject(new Error('Render queue full'));
      const entry = { start };
      entry.timer = setTimeout(() => {
        this.waiting.splice(this.waiting.indexOf(entry), 1);
        reject(new Error('Render queue wait timed out'));
      }, this.waitMs);
      this.waiting.push(entry);
    });
  }
}

module.exports = RenderQueue;
