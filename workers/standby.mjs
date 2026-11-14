// Warm standby worker: load input, solve speculatively while reserved, then wait.
// Usage: node standby.mjs input.json
// Emits {type:"ready",solve_ms} then waits for stdin line "deliver" or "kill".
// On "deliver" emits {type:"solution",solution,wait_ms}. This models a paid
// standby that has already done the deterministic work and can deliver quickly.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { solveSystem } from './solve.mjs';

const t0 = performance.now();
let solution;
try {
  const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const sol = solveSystem(input.n, input.a, input.b);
  solution = sol.map(v => {
    if (v > 2147483647n || v < -2147483648n) throw new Error('solution out of i32 range');
    return Number(v);
  });
  console.log(JSON.stringify({ type: 'ready', solve_ms: performance.now() - t0 }));
} catch (e) {
  console.log(JSON.stringify({ type: 'error', error: String(e.message || e) }));
  process.exit(1);
}

const readyAt = performance.now();
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const cmd = line.trim();
  if (cmd === 'deliver') {
    console.log(JSON.stringify({ type: 'solution', solution, wait_ms: performance.now() - readyAt }));
  } else if (cmd === 'kill') {
    process.exit(0);
  }
});
