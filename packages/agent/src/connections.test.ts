import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConnectionSettingsSchema, WorldSettingsSchema, legacyConnectionAddress } from "@palserver/shared";
import { restApiBaseUrl, rconEndpoint, palDefenderBaseUrl } from "./connections.js";
import { rest } from "./restapi.js";
import { rconExec, encodeRconPacket } from "./rcon.js";
import type { InstanceRecord } from "./store.js";

const rec = { id: "connections-test", name: "connections-test", backend: "docker", flavor: "vanilla",
  gamePort: 8211, settings: WorldSettingsSchema.parse({ RESTAPIEnabled: true, RCONEnabled: true,
    RESTAPIPort: 8212, RCONPort: 25575, AdminPassword: "test-password" }) } as InstanceRecord;

test("blank destinations use localhost and legacy endpoints remain compatible", () => {
  assert.equal(restApiBaseUrl(rec), "http://localhost:8212/v1/api");
  assert.deepEqual(rconEndpoint(rec), { host: "localhost", port: 25575 });
  const k8s = { ...rec, backend: "k8s" as const, k8sServiceName: "game", k8sNamespace: "palworld" };
  assert.equal(restApiBaseUrl(k8s), "http://localhost:8212/v1/api");
  assert.deepEqual(rconEndpoint(k8s), { host: "localhost", port: 25575 });
  const custom = { ...k8s, connection: { restApiUrl: "https://example.com/proxy/v1/api/", rconAddress: "[::1]:25580", palDefenderAddress: "[::1]:8219" } };
  assert.equal(restApiBaseUrl(custom), "https://example.com/proxy/v1/api");
  assert.deepEqual(rconEndpoint(custom), { host: "::1", port: 25580 });
  assert.equal(palDefenderBaseUrl(custom, 9000), "http://[::1]:8219/v1/pdapi");
  assert.equal(restApiBaseUrl({ ...rec, connection: { restApiUrl: "http://game:9000/proxy/" } }), "http://game:9000/proxy/v1/api");
  assert.equal(restApiBaseUrl({ ...rec, connection: { restApiUrl: "" } }), restApiBaseUrl(rec));
});

test("one address uses config ports for every service and blank always uses localhost", () => {
  const custom = { ...rec, connection: { address: "https://[::1]/proxy/v1/api/" } };
  assert.equal(restApiBaseUrl(custom), "https://[::1]:8212/proxy/v1/api");
  assert.deepEqual(rconEndpoint(custom), { host: "::1", port: 25575 });
  assert.equal(palDefenderBaseUrl(custom, 8213), "https://[::1]:8213/proxy/v1/pdapi");
  assert.equal(restApiBaseUrl({ ...custom, settings: { ...custom.settings, RESTAPIPort: 9000 } }), "https://[::1]:9000/proxy/v1/api");
  assert.deepEqual(rconEndpoint({ ...custom, settings: { ...custom.settings, RCONPort: 9001 } }), { host: "::1", port: 9001 });
  assert.equal(palDefenderBaseUrl(custom, 9002), "https://[::1]:9002/proxy/v1/pdapi");
  assert.equal(restApiBaseUrl({ ...rec, connection: { address: "" } }), "http://localhost:8212/v1/api");
  assert.equal(restApiBaseUrl({ ...rec, connection: { address: "palserver-test" } }), "http://palserver-test:8212/v1/api");
});

test("unified address rejects manual ports and invalid inputs while suggesting compatible legacy hosts", () => {
  for (const address of ["host:8212", "http://host:80", "https://host:443", "http://host:8212", "file:///etc/passwd", "http://user:pass@host", "http://host/?token=secret", "http://host/#fragment"]) {
    assert.equal(ConnectionSettingsSchema.safeParse({ address }).success, false, address);
  }
  for (const address of ["", "localhost", "192.168.1.10", "palserver-test", "https://game/proxy", "[::1]", "::1"]) {
    assert.equal(ConnectionSettingsSchema.safeParse({ address }).success, true, address);
  }
  assert.equal(ConnectionSettingsSchema.safeParse({ address: "game", rconAddress: "other:25575" }).success, false);
  assert.equal(legacyConnectionAddress({ restApiUrl: "http://game:8212/v1/api", rconAddress: "game:25575" }), "http://game");
  assert.equal(legacyConnectionAddress({ restApiUrl: "http://one:8212", rconAddress: "two:25575" }), undefined);
});

test("connection schema rejects malformed URLs, embedded credentials and invalid TCP destinations", () => {
  for (const restApiUrl of ["file:///etc/passwd", "http://user:password@host", "http://host/?token=x", "http://host/#fragment", "host:8212"]) {
    assert.equal(ConnectionSettingsSchema.safeParse({ restApiUrl }).success, false, restApiUrl);
  }
  for (const rconAddress of ["http://host:25575", "host", "host:0", "host:65536", "host:25575/path", "user:password@host:25575"]) {
    assert.equal(ConnectionSettingsSchema.safeParse({ rconAddress }).success, false, rconAddress);
  }
  assert.equal(ConnectionSettingsSchema.safeParse({ restApiUrl: "", rconAddress: "", palDefenderAddress: "" }).success, true);
  assert.equal(ConnectionSettingsSchema.safeParse({ unknown: "value" }).success, false);
});

test("REST requests use the configured destination and existing admin credentials", async (t) => {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url ?? "");
    assert.equal(req.headers.authorization, `Basic ${Buffer.from("admin:test-password").toString("base64")}`);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ servername: "configured-endpoint", version: "1.0", description: "", worldguid: "test" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = (server.address() as net.AddressInfo).port;
  const actual = await rest.info({ ...rec, settings: { ...rec.settings, RESTAPIPort: port }, connection: { address: "http://127.0.0.1/proxy" } });
  assert.equal(actual.servername, "configured-endpoint");
  assert.deepEqual(requests, ["/proxy/v1/api/info"]);
});

test("RCON authenticates and executes on the configured host and port", async (t) => {
  const server = net.createServer((socket) => {
    t.after(() => socket.destroy());
    let buffer = Buffer.alloc(0);
    socket.on("data", (data) => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 4 && buffer.length >= buffer.readInt32LE(0) + 4) {
        const size = buffer.readInt32LE(0);
        const id = buffer.readInt32LE(4);
        const type = buffer.readInt32LE(8);
        const body = buffer.toString("utf8", 12, size + 2);
        buffer = buffer.subarray(size + 4);
        if (type === 3) {
          assert.equal(body, "test-password");
          socket.write(encodeRconPacket(id, 2, ""));
        } else {
          assert.equal(body, "Info");
          socket.write(encodeRconPacket(id, 0, "configured-rcon"));
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const port = (server.address() as net.AddressInfo).port;
  assert.equal(await rconExec({ ...rec, settings: { ...rec.settings, RCONPort: port }, connection: { address: "127.0.0.1" } }, "Info", { base64: false }), "configured-rcon");
});

test("connection settings survive an instance store reload and can be cleared", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palserver-connections-"));
  const previous = process.env.PALSERVER_DATA_DIR;
  process.env.PALSERVER_DATA_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.PALSERVER_DATA_DIR; else process.env.PALSERVER_DATA_DIR = previous; fs.rmSync(dir, { recursive: true, force: true }); });
  const { InstanceStore } = await import("./store.js");
  const store = new InstanceStore();
  const created = store.create({ ...rec, connection: { address: "http://game" } });
  assert.deepEqual(new InstanceStore().get(created.id)?.connection, created.connection);
  store.update(created.id, { connection: { address: "" } });
  assert.deepEqual(new InstanceStore().get(created.id)?.connection, { address: "" });
});
