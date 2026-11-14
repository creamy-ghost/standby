import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FailureLab } from './lab-session.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
execFileSync(process.execPath, [join(root, 'js/artifact.mjs'), 'verify'], { cwd: root, stdio: 'inherit' });
process.env.NEAR_SANDBOX_BIN_PATH ||= join(root, 'js/node_modules/near-sandbox/bin/near-sandbox');
process.env.NEAR_SANDBOX_BINARY_PATH ||= join(root, 'js/node_modules/near-sandbox/bin');
const port = Number(process.env.STANDBY_LAB_PORT || 4318);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid STANDBY_LAB_PORT');
const lab = new FailureLab();
const staticFiles = new Map([
  ['/', ['js/lab/index.html', 'text/html; charset=utf-8']],
  ['/lab.css', ['js/lab/lab.css', 'text/css; charset=utf-8']],
  ['/lab.mjs', ['js/lab/lab.mjs', 'text/javascript; charset=utf-8']],
  ['/evidence', ['results/report.html', 'text/html; charset=utf-8']],
  ['/summary', ['js/lab/summary.html', 'text/html; charset=utf-8']],
]);
let origin;
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
  const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  try {
    const validHosts = new Set([new URL(origin).host, `localhost:${server.address().port}`]);
    if (!validHosts.has(req.headers.host)) return json(403, { error: 'Use the loopback URL printed by lab.sh.' });
    const url = new URL(req.url, origin);
    if (req.method === 'GET' && url.pathname === '/api/state') return json(200, lab.publicState());
    if (req.method === 'GET' && url.pathname === '/api/trace') {
      if (!lab.state.run_id) return json(404, { error: 'Create a job first.' });
      res.setHeader('Content-Disposition', 'attachment; filename="standby-lab-' + lab.state.run_id + '.json"');
      return json(200, lab.publicState());
    }
    if (req.method === 'POST' && url.pathname === '/api/action') {
      // JSON plus a same-origin custom header prevents cross-site form actions.
      const originHost = req.headers.origin ? new URL(req.headers.origin).host : '';
      if (!validHosts.has(originHost) || req.headers['x-standby-lab'] !== '1' ||
          req.headers['content-type'] !== 'application/json') return json(403, { error: 'Only same-origin lab actions are accepted.' });
      let bytes = 0, body = '';
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1024) return json(413, { error: 'Request too large.' });
        body += chunk;
      }
      let request;
      try { request = JSON.parse(body); } catch { return json(400, { error: 'Invalid JSON.' }); }
      if (!request || typeof request !== 'object' || Array.isArray(request) ||
          Object.keys(request).some(key => !['action', 'run_id'].includes(key)) ||
          typeof request.action !== 'string' || !(request.run_id === null || typeof request.run_id === 'string')) {
        return json(400, { error: 'Expected action and current run_id.' });
      }
      lab.begin(request.action, request.run_id);
      return json(202, lab.publicState());
    }
    if (req.method === 'GET' && staticFiles.has(url.pathname)) {
      const [file, type] = staticFiles.get(url.pathname);
      if (!existsSync(join(root, file))) {
        if (url.pathname === '/evidence') {
          res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'");
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(`<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#080f0c;color:#e2f4e7;padding:30px;text-align:center;">
            <h3 style="color:#c2f583;margin-bottom:12px;">Comparison Evidence Not Generated Yet</h3>
            <p style="color:#8fa89b;">Run <code style="color:#c2f583;background:#14241e;padding:3px 6px;border-radius:4px;">./run.sh</code> in your terminal to generate the live scenario comparison and 44 checks, then refresh.</p>
          </body></html>`);
        }
        return json(404, { error: 'Run ./run.sh to generate the comparison evidence first.' });
      }
      // The archived self-contained report intentionally contains inline code.
      if (url.pathname === '/evidence' || url.pathname === '/summary') res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
      res.writeHead(200, { 'Content-Type': type });
      return res.end(readFileSync(join(root, file)));
    }
    json(404, { error: 'Not found.' });
  } catch (error) {
    json(error.status || 500, { error: String(error.message || error) });
  }
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port ${port} is already in use.`);
    console.error(`👉 Try starting with another port: STANDBY_LAB_PORT=${port + 2} ./lab.sh\n`);
    process.exit(1);
  }
  throw err;
});
server.listen(port, '127.0.0.1', () => {
  origin = 'http://127.0.0.1:' + server.address().port;
  console.log('Standby failure lab: ' + origin);
  console.log('Real local NEAR sandbox · fixture funds · Ctrl+C stops the lab');
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  try { await lab.currentAction; await lab.close(); }
  finally { process.exit(0); }
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
