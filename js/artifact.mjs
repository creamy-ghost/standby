import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const files = ['contract/src/lib.rs', 'contract/Cargo.toml', 'contract/Cargo.lock', 'build.sh'];
const wasm = 'contract/target/source/wasm32-unknown-unknown/release/standby_validation.wasm';
try {
  const hashes = Object.fromEntries([...files, wasm].map(path => [path, digest(path)]));
  if (process.argv[2] === 'write') {
    mkdirSync('results', { recursive: true });
    writeFileSync('results/build.json', JSON.stringify({ rustc: process.env.STANDBY_BUILD_RUSTC, built_at: new Date().toISOString(), hashes }, null, 2));
    console.log('Source build recorded: ' + hashes[wasm]);
  } else {
    const built = JSON.parse(readFileSync('results/build.json'));
    for (const [path, hash] of Object.entries(hashes)) {
      if (built.hashes[path] !== hash) throw new Error('stale build: ' + path);
    }
    console.log('Verified source build: ' + hashes[wasm]);
  }
} catch (error) {
  console.error(error.message + '\nRun ./build.sh before ./run.sh; use --fixture only for the historical replay.');
  process.exitCode = 1;
}
