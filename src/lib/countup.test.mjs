/**
 * Check that countUp lands on EXACTLY the target and never overshoots.
 * The bug this guards against shipped twice: a 9,994 target rendered as
 * 177,827, and a 30% break-even rendered as 445%.
 *
 * Run: node src/lib/countup.test.mjs
 */
import assert from 'node:assert';

// Minimal rAF/perf shims so the real module runs under plain node.
let clock = 0;
const queue = [];
globalThis.performance = { now: () => clock };
globalThis.requestAnimationFrame = (fn) => { queue.push(fn); return queue.length; };
globalThis.cancelAnimationFrame = () => {};

const { countUp } = await import('./countup.js');

function run({ from = 0, to, duration = 1000 }) {
  const el = { textContent: '' };
  const seen = [];
  // Reset before starting: countUp captures performance.now() as its t0.
  clock = 0;
  queue.length = 0;
  countUp(el, { from, to, duration, format: (n) => { seen.push(n); return String(n); } });
  // Drain the queue, advancing past the end so the final frame lands.
  for (let step = 0; step <= duration + 100 && queue.length; step += 16) {
    clock = step;
    queue.splice(0, queue.length).forEach((fn) => fn(clock));
  }
  return { el, seen };
}

// Lands exactly on target, formatted.
const a = run({ to: 9994 });
assert.strictEqual(a.el.textContent, '9994', `expected 9994, got ${a.el.textContent}`);

// Never exceeds the target at any frame — this is the overshoot guard.
const maxSeen = Math.max(...a.seen);
assert.ok(maxSeen <= 9994, `overshot: saw ${maxSeen}, target 9994`);

// Small integers work too (the 30% break-even case).
const b = run({ to: 30 });
assert.strictEqual(b.el.textContent, '30');
assert.ok(Math.max(...b.seen) <= 30);

// Counting DOWN from a previous value, as the dashboard does on refetch.
const c = run({ from: 500, to: 100 });
assert.strictEqual(c.el.textContent, '100');
assert.ok(Math.min(...c.seen) >= 100, 'undershot on a downward count');
assert.ok(Math.max(...c.seen) <= 500, 'overshot on a downward count');

console.log('✓ countUp lands exactly, never overshoots (up and down)');
