import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type Docker from "dockerode";
import { WorldSettingsSchema } from "@palserver/shared";
import { docker, createContainer, startInstance } from "./docker.js";
import { instanceHostname } from "./docker-network.js";
import { restApiBaseUrl, rconEndpoint, palDefenderBaseUrl } from "./connections.js";
import type { InstanceRecord } from "./store.js";

const networkName = "palserver-test-network";
const rec = { id: "network-test", name: "display-name", backend: "docker", dockerImage: "test/game:local",
  flavor: "vanilla", gamePort: 8211, settings: WorldSettingsSchema.parse({ RESTAPIEnabled: false, RCONEnabled: false }) } as InstanceRecord;

function setup(t: TestContext) {
  const previous = process.env.PALSERVER_DOCKER_NETWORK;
  process.env.PALSERVER_DOCKER_NETWORK = networkName;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palserver-network-"));
  t.after(() => {
    if (previous === undefined) delete process.env.PALSERVER_DOCKER_NETWORK; else process.env.PALSERVER_DOCKER_NETWORK = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const info = { Id: "old-container", State: { Running: false },
    HostConfig: { NetworkMode: "bridge", PortBindings: { "8211/udp": [{ HostPort: "8211" }] } },
    NetworkSettings: { Networks: {} }, Config: {}, Mounts: [],
  } as unknown as Docker.ContainerInspectInfo;
  const order: string[] = [];
  const remove = t.mock.fn(async () => { order.push("remove"); });
  const connect = t.mock.fn(async (_options: unknown) => { order.push("connect"); });
  const disconnect = t.mock.fn(async (_options: unknown) => { order.push("disconnect"); });
  const inspectNetwork = t.mock.fn(async () => ({}));
  const container = { inspect: async () => info, start: async () => { order.push("start"); }, remove };
  t.mock.method(docker, "getImage", () => ({ inspect: async () => ({ Id: "image" }) }));
  t.mock.method(docker, "listContainers", async () => [{ Id: "old-container" }]);
  t.mock.method(docker, "getContainer", () => container);
  t.mock.method(docker, "getNetwork", () => ({ connect, disconnect, inspect: inspectNetwork }));
  const create = t.mock.method(docker, "createContainer", async (_options: Docker.ContainerCreateOptions) => ({ id: "new-container" }));
  return { dir, info, order, remove, connect, disconnect, create, inspectNetwork };
}

test("shared-network DNS is the default for Docker connections, with explicit overrides taking precedence", (t) => {
  setup(t);
  const hostname = instanceHostname(rec.id);
  assert.equal(restApiBaseUrl(rec), `http://${hostname}:${rec.settings.RESTAPIPort}/v1/api`);
  assert.equal(rconEndpoint(rec).host, hostname);
  assert.equal(palDefenderBaseUrl(rec, 8213), `http://${hostname}:8213/v1/pdapi`);
  assert.equal(restApiBaseUrl({ ...rec, name: "renamed" }), restApiBaseUrl(rec));
  const custom = { ...rec, connection: { restApiUrl: "http://custom:9000", rconAddress: "custom:9001", palDefenderAddress: "custom:9002" } };
  assert.equal(restApiBaseUrl(custom), "http://custom:9000/v1/api");
  assert.equal(rconEndpoint(custom).host, "custom");
  assert.equal(palDefenderBaseUrl(custom, 8213), "http://custom:9002/v1/pdapi");
  assert.match(restApiBaseUrl({ ...rec, backend: "native" }), /127\.0\.0\.1/);
  assert.match(restApiBaseUrl({ ...rec, backend: "k8s", k8sServiceName: "game", k8sNamespace: "pal" }), /game\.pal/);
});

test("new game containers join the configured network with a stable alias", async (t) => {
  const f = setup(t);
  await createContainer(rec, f.dir);
  const options = f.create.mock.calls[0].arguments[0];
  assert.equal(options.HostConfig?.NetworkMode, networkName);
  assert.deepEqual(options.NetworkingConfig?.EndpointsConfig?.[networkName].Aliases, [instanceHostname(rec.id)]);
});

test("legacy bridge containers join the shared network without recreation", async (t) => {
  const f = setup(t);
  await startInstance(rec, f.dir);
  assert.deepEqual(f.order, ["connect", "start"]);
  assert.deepEqual(f.connect.mock.calls[0].arguments[0], { Container: "old-container", EndpointConfig: { Aliases: [instanceHostname(rec.id)] } });
  assert.equal(f.remove.mock.callCount(), 0);
  assert.equal(f.create.mock.callCount(), 0);
});

test("existing correct DNS attachment is reused", async (t) => {
  const f = setup(t);
  f.info.NetworkSettings.Networks[networkName] = { Aliases: [instanceHostname(rec.id)] } as Docker.NetworkInfo;
  await startInstance(rec, f.dir);
  assert.deepEqual(f.order, ["start"]);
});

test("stopped manually attached containers gain the stable alias and retain old aliases", async (t) => {
  const f = setup(t);
  f.info.NetworkSettings.Networks[networkName] = { Aliases: ["existing-name"] } as Docker.NetworkInfo;
  await startInstance(rec, f.dir);
  assert.deepEqual(f.order, ["disconnect", "connect", "start"]);
  assert.deepEqual(f.connect.mock.calls[0].arguments[0], { Container: "old-container", EndpointConfig: { Aliases: ["existing-name", instanceHostname(rec.id)] } });
});

test("running alias changes require stopping first", async (t) => {
  const f = setup(t);
  f.info.State.Running = true;
  f.info.NetworkSettings.Networks[networkName] = { Aliases: ["existing-name"] } as Docker.NetworkInfo;
  await assert.rejects(startInstance(rec, f.dir), /請先停止伺服器/);
  assert.deepEqual(f.order, []);
});

test("a missing configured network does not delete an old container during port reconciliation", async (t) => {
  const f = setup(t);
  f.inspectNetwork.mock.mockImplementation(async () => { throw new Error("network not found"); });
  await assert.rejects(startInstance({ ...rec, gamePort: 8219 }, f.dir), /network not found/);
  assert.equal(f.remove.mock.callCount(), 0);
});
