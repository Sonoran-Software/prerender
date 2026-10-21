const assert = require('assert');
const RenderQueue = require('../lib/renderQueue');

describe('render admission', function () {
  it('bounds active work, admits waiters in order, and releases only once', async function () {
    const queue = new RenderQueue(1, 2, 1000);
    const first = await queue.acquire();
    let admitted = false;
    const second = queue.acquire().then(release => { admitted = true; return release; });
    await Promise.resolve();
    assert.equal(admitted, false);
    first();
    first();
    const release = await second;
    assert.equal(queue.active, 1);
    release();
    assert.equal(queue.active, 0);
  });

  it('rejects overflow and removes expired waiters without leaking slots', async function () {
    const queue = new RenderQueue(1, 1, 10);
    const release = await queue.acquire();
    const waiter = assert.rejects(queue.acquire(), /wait timed out/);
    await assert.rejects(queue.acquire(), /queue full/);
    await waiter;
    assert.equal(queue.waiting.length, 0);
    release();
    const next = await queue.acquire();
    next();
    assert.equal(queue.active, 0);
  });
});
