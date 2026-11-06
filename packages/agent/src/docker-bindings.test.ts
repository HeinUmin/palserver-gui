import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type Docker from "dockerode";
import { WorldSettingsSchema } from "@palserver/shared";
import { docker, startInstance, restartInstance } from "./docker.js";
import type { InstanceRecord } from "./store.js";

const base = { id: "bindings-test", name: "bindings-test", backend: "docker", flavor: "vanilla",
  gamePort: 8211, settings: WorldSettingsSchema.parse({ RESTAPIEnabled: true, RESTAPIPort: 8212,
    RCONEnabled: true, RCONPort: 25576 }) } as InstanceRecord;

const ports = (rcon?: number) => ({
  "8211/udp": [{ HostPort: "8211" }], "8212/tcp": [{ HostPort: "8212" }],
  ...(rcon === undefined ? {} : { [`${rcon}/tcp`]: [{ HostPort: String(rcon), HostIp: "127.0.0.1" }] }),
});

function fixture(t: TestContext, oldPort: number | undefined, running = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palserver-bindings-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "saved"));
  fs.writeFileSync(path.join(dir, "saved", "world.sav"), "keep-world-data");
  const binds = [`${dir}/saved:/data/saved`, `${dir}/config:/data/config:ro`];
  const info = {
    Config: { Env: ["KEEP_SETTING=yes"], Labels: {}, Volumes: { "/palworld": {} } },
    State: { Running: running, Restarting: false, Paused: false },
    HostConfig: { PortBindings: ports(oldPort), Binds: binds, NetworkMode: "shared-network" },
    Mounts: [{ Type: "volume", Name: "existing-world-volume", Destination: "/palworld", RW: true }],
    NetworkSettings: { Networks: { "shared-network": { Aliases: ["existing-game"] } } },
  } as unknown as Docker.ContainerInspectInfo;
  const order: string[] = [];
  const oldContainer = {
    inspect: async () => info,
    remove: async (options: unknown) => { order.push("remove"); assert.deepEqual(options, { force: false }); },
    start: async () => { order.push("old-start"); },
    stop: async () => { order.push("stop"); info.State.Running = false; },
  };
  const newContainer = { id: "new-container", start: async () => { order.push("new-start"); } };
  t.mock.method(docker, "listContainers", async () => [{ Id: "old-container" }]);
  t.mock.method(docker, "getContainer", (id: string) => id === "old-container" ? oldContainer : newContainer);
  t.mock.method(docker, "getImage", () => ({ inspect: async () => ({ Id: "existing-image" }) }));
  const create = t.mock.method(docker, "createContainer", async (_options: Docker.ContainerCreateOptions) => {
    order.push("create"); return newContainer;
  });
  return { dir, info, order, create, binds };
}

test("world-settings RCON port change recreates stopped bindings and preserves data and networking", async (t) => {
  const f = fixture(t, 25575);
  await startInstance(base, f.dir);
  assert.deepEqual(f.order, ["remove", "create", "new-start"]);
  const options = f.create.mock.calls[0].arguments[0];
  assert.deepEqual(options.HostConfig?.PortBindings?.["25576/tcp"], [{ HostPort: "25576", HostIp: "127.0.0.1" }]);
  assert.equal(options.HostConfig?.PortBindings?.["25575/tcp"], undefined);
  assert.deepEqual(options.HostConfig?.Binds, [...f.binds, "existing-world-volume:/palworld"]);
  assert.equal(options.HostConfig?.NetworkMode, "shared-network");
  assert.deepEqual(options.NetworkingConfig?.EndpointsConfig?.["shared-network"].Aliases, ["existing-game"]);
  assert.deepEqual(options.Env, ["KEEP_SETTING=yes"]);
  assert.equal(fs.readFileSync(path.join(f.dir, "saved", "world.sav"), "utf8"), "keep-world-data");
});

test("enabling RCON in world settings adds a previously unpublished port", async (t) => {
  const f = fixture(t, undefined);
  await startInstance(base, f.dir);
  assert.deepEqual(f.create.mock.calls[0].arguments[0].HostConfig?.PortBindings?.["25576/tcp"], [{ HostPort: "25576" }]);
});

test("disabling RCON removes its old published port", async (t) => {
  const f = fixture(t, 25576);
  await startInstance({ ...base, settings: { ...base.settings, RCONEnabled: false } }, f.dir);
  assert.equal(f.create.mock.calls[0].arguments[0].HostConfig?.PortBindings?.["25576/tcp"], undefined);
});

test("matching stopped container is reused without recreation", async (t) => {
  const f = fixture(t, 25576);
  await startInstance(base, f.dir);
  assert.deepEqual(f.order, ["old-start"]);
  assert.equal(f.create.mock.callCount(), 0);
});

test("explicit host networking does not trigger published-port recreation", async (t) => {
  const f = fixture(t, undefined);
  f.info.HostConfig.NetworkMode = "host";
  f.info.HostConfig.PortBindings = {};
  await startInstance(base, f.dir);
  assert.deepEqual(f.order, ["old-start"]);
  assert.equal(f.create.mock.callCount(), 0);
});

test("starting a running container never force-removes it to apply new settings", async (t) => {
  const f = fixture(t, 25575, true);
  await assert.rejects(startInstance(base, f.dir), /請先停止伺服器/);
  assert.deepEqual(f.order, []);
});

test("normal restart stops the old game before refreshing the bindings", async (t) => {
  const f = fixture(t, 25575, true);
  await restartInstance(base, f.dir);
  assert.deepEqual(f.order, ["stop", "remove", "create", "new-start"]);
});
