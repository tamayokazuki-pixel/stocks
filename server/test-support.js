import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

export async function startIsolatedServer(overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-test-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: path.resolve(''),
    env: { ...process.env, NODE_ENV: 'production', DEMO_MODE: 'true', MARKET_PROVIDER: 'demo', DATABASE_PATH: path.join(directory, 'test.sqlite'),
      ADMIN_EMAIL: 'admin@tests.example', ADMIN_PASSWORD: 'a-long-test-password-123', PORT: String(port),
      MANUAL_TRANSFERS_ENABLED: 'false', TRANSFER_DETAILS_KEY: '', ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', data => { logs += data.toString(); });
  child.stderr.on('data', data => { logs += data.toString(); });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited unexpectedly: ${logs}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return { base, child, directory };
    } catch { /* Starting up. */ }
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  child.kill('SIGTERM');
  throw new Error(`Timed out waiting for server: ${logs}`);
}

export async function request(base, route, { method = 'GET', body, cookie, verified = true } = {}) {
  const response = await fetch(`${base}/api${route}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(verified && method !== 'GET' ? { 'X-Requested-With': 'northstar' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sessionCookie = response.headers.getSetCookie().filter(value => value.startsWith('northstar_session=')).at(-1);
  return { status: response.status, data: await response.json(), cookie: sessionCookie?.split(';')[0] };
}
