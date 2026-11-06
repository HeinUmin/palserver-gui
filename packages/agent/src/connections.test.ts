import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConnectionSettingsSchema, WorldSettingsSchema } from "@palserver/shared";
import { restApiBaseUrl, rconEndpoint, palDefenderBaseUrl } from "./connections.js";
import { rest } from "./restapi.js";
import { rconExec, encodeRconPacket } from "./rcon.js";
import type { InstanceRecord } from "./store.js";

const rec = { id: "connections-test", name: "connections-test", backend: "docker", flavor: "vanilla",
  gamePort: 8211, settings: WorldSettingsSchema.parse({ RESTAPIEnabled: true, RCONEnabled: true,
    RESTAPIPort: 8212, RCONPort: 25575, AdminPassword: "test-password" }) } as InstanceRecord;

test("default destinations remain compatible and explicit endpoints support IPv6 and URL prefixes", () => {
  assert.equal(restApiBaseUrl(rec), "http://127.0.0.1:8212/v1/api");
  assert.deepEqual(rconEndpoint(rec), { host: "127.0.0.1", port: 25575 });
  const k8s = { ...rec, backend: "k8s" as const, k8sServiceName: "game", k8sNamespace: "palworld" };
  assert.equal(restApiBaseUrl(k8s), "http://game.palworld:8212/v1/api");
  assert.deepEqual(rconEndpoint(k8s), { host: "game.palworld", port: 25575 });
  const custom = { ...k8s, connection: { restApiUrl: "https://example.com/proxy/v1/api/", rconAddress: "[::1]:25580", palDefenderAddress: "[::1]:8219" } };
  assert.equal(restApiBaseUrl(custom), "https://example.com/proxy/v1/api");
  assert.deepEqual(rconEndpoint(custom), { host: "::1", port: 25580 });
  assert.equal(palDefenderBaseUrl(custom, 9000), "http://[::1]:8219/v1/pdapi");
  assert.equal(restApiBaseUrl({ ...rec, connection: { restApiUrl: "http://game:9000/proxy/" } }), "http://game:9000/proxy/v1/api");
  assert.equal(restApiBaseUrl({ ...rec, connection: { restApiUrl: "" } }), restApiBaseUrl(rec));
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
  const actual = await rest.info({ ...rec, connection: { restApiUrl: `http://127.0.0.1:${port}/proxy` } });
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
  assert.equal(await rconExec({ ...rec, connection: { rconAddress: `127.0.0.1:${port}` } }, "Info", { base64: false }), "configured-rcon");
});

test("connection settings survive an instance store reload and can be cleared", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palserver-connections-"));
  const previous = process.env.PALSERVER_DATA_DIR;
  process.env.PALSERVER_DATA_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.PALSERVER_DATA_DIR; else process.env.PALSERVER_DATA_DIR = previous; fs.rmSync(dir, { recursive: true, force: true }); });
  const { InstanceStore } = await import("./store.js");
  const store = new InstanceStore();
  const created = store.create({ ...rec, connection: { restApiUrl: "http://game:8212", rconAddress: "game:25575" } });
  assert.deepEqual(new InstanceStore().get(created.id)?.connection, created.connection);
  store.update(created.id, { connection: {} });
  assert.deepEqual(new InstanceStore().get(created.id)?.connection, {});
});
