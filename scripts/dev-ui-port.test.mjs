import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import {
  canListenOnLocalhost,
  createTauriDevConfigOverride,
  parsePreferredUiPort,
  resolveDevUiPort,
  selectDevUiPort,
} from "./dev-ui-port.mjs";

function listenOnIpv6Loopback() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "::1", () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("uses the Desk-specific UI range and validates an explicit port", () => {
  assert.equal(parsePreferredUiPort(undefined), 49_373);
  assert.equal(parsePreferredUiPort(" 50000 "), 50_000);
  assert.throws(() => parsePreferredUiPort("0"), /1\.\.65535/u);
  assert.throws(() => parsePreferredUiPort("not-a-port"), /1\.\.65535/u);
});

test("moves upward from an occupied default UI port", async () => {
  const visited = [];
  const port = await selectDevUiPort({
    preferredPort: 49_373,
    attempts: 4,
    canListen: async (candidate) => {
      visited.push(candidate);
      return candidate === 49_375;
    },
  });
  assert.equal(port, 49_375);
  assert.deepEqual(visited, [49_373, 49_374, 49_375]);
});

test("treats an IPv6-only localhost listener as occupied", async (context) => {
  let server;
  try {
    server = await listenOnIpv6Loopback();
  } catch (error) {
    if (["EAFNOSUPPORT", "EADDRNOTAVAIL", "EPERM"].includes(error?.code)) {
      context.skip("IPv6 loopback is unavailable in this environment");
      return;
    }
    throw error;
  }

  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.equal(await canListenOnLocalhost(address.port), false);
  } finally {
    await closeServer(server);
  }
});

test("keeps an explicitly configured UI port strict", async () => {
  await assert.rejects(
    resolveDevUiPort({ WEB_UI_PORT: "50000" }, async () => false),
    /50000\.\.50000/u,
  );
});

test("keeps Tauri devUrl, WebSocket and CSP on the selected UI port", () => {
  const override = createTauriDevConfigOverride(49_374);
  assert.equal(override.build.devUrl, "http://localhost:49374");
  assert.match(override.app.security.devCsp, /http:\/\/localhost:49374/u);
  assert.match(override.app.security.devCsp, /ws:\/\/localhost:49374/u);
  assert.doesNotMatch(override.app.security.devCsp, /localhost:49373/u);
});
