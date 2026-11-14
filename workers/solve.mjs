// Cold worker: solve integer linear system A x = b from an input file.
// Usage: node solve.mjs input.json
// Prints one JSON line: { ok, solution, solve_ms, error? }
import { readFileSync } from 'node:fs';

function gcd(a, b) { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { [a, b] = [b, a % b]; } return a; }
class Fr {
  constructor(n, d = 1n) {
    if (d === 0n) throw new Error('zero denominator');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d) || 1n;
    this.n = n / g; this.d = d / g;
  }
  add(o) { return new Fr(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { return new Fr(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { return new Fr(this.n * o.n, this.d * o.d); }
  div(o) { return new Fr(this.n * o.d, this.d * o.n); }
  isZero() { return this.n === 0n; }
}

export function solveSystem(n, a, b) {
  const m = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) row.push(new Fr(BigInt(a[i * n + j])));
    row.push(new Fr(BigInt(b[i])));
    m.push(row);
  }
  for (let col = 0; col < n; col++) {
    let pivot = -1;
    for (let r = col; r < n; r++) if (!m[r][col].isZero()) { pivot = r; break; }
    if (pivot < 0) throw new Error('singular matrix');
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const p = m[col][col];
    for (let j = col; j <= n; j++) m[col][j] = m[col][j].div(p);
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f.isZero()) continue;
      for (let j = col; j <= n; j++) m[r][j] = m[r][j].sub(f.mul(m[col][j]));
    }
  }
  const x = [];
  for (let i = 0; i < n; i++) {
    const f = m[i][n];
    if (f.d !== 1n) throw new Error('non-integer solution');
    x.push(f.n);
  }
  return x;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = performance.now();
  try {
    const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const sol = solveSystem(input.n, input.a, input.b);
    const solution = sol.map(v => {
      if (v > 2147483647n || v < -2147483648n) throw new Error('solution out of i32 range');
      return Number(v);
    });
    console.log(JSON.stringify({ ok: true, solution, solve_ms: performance.now() - t0 }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e.message || e), solve_ms: performance.now() - t0 }));
    process.exitCode = 1;
  }
}
