/**
 * requestAnimationFrame loop with clamped delta time.
 * @param {(dt:number, elapsed:number) => void} update dt in seconds (≤ 0.1), elapsed seconds since start
 */
export function createLoop(update) {
  let raf = 0;
  let last = 0;
  let elapsed = 0;
  let running = false;

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    elapsed += dt;
    try {
      update(dt, elapsed);
    } catch (err) {
      console.error('[loop] frame failed', err);
    }
    raf = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    get elapsed() {
      return elapsed;
    },
  };
}
