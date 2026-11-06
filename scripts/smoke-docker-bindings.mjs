// Real Docker regression using the fake game image; no Palworld download.
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { lookup } from "node:dns/promises";
import { setTimeout as delay } from "node:timers/promises";
import { WorldSettingsSchema } from "../packages/shared/dist/index.js";
import { docker, writeConfig, startInstance, removeInstanceContainer, execInContainerChecked } from "../packages/agent/dist/docker.js";
import { INSTANCE_LABEL } from "../packages/agent/dist/env.js";
import { instanceHostname } from "../packages/agent/dist/docker-network.js";
import { restApiBaseUrl, rconEndpoint } from "../packages/agent/dist/connections.js";

const dir = process.env.PALSERVER_BINDINGS_TEST_DIR;
assert.ok(dir, "Mount the test directory at the same path on host and Agent");
const id = `bindings-${crypto.randomBytes(5).toString("hex")}`;
const image = `palserver/dev-stub:${id}`;
const context = `${process.env.PALSERVER_REPO_DIR}/images/dev-stub`;
const stream = await docker.buildImage({ context, src: fs.readdirSync(context) }, { t: image });
await new Promise((resolve, reject) => docker.modem.followProgress(stream, (error, events) => {
  const failure = events?.find((event) => event.error || event.errorDetail?.message);
  if (error || failure) reject(error ?? new Error(failure.errorDetail?.message || failure.error));
  else resolve();
}));
const port = 42000 + Math.floor(Math.random() * 1000);
const rec = { id, name: id, backend: "docker", flavor: "vanilla", dockerImage: image, gamePort: port,
  settings: WorldSettingsSchema.parse({ RESTAPIEnabled: false, RCONEnabled: true, RCONPort: port + 1000 }) };
const find = async () => {
  const list = await docker.listContainers({ all: true, filters: { label: [`${INSTANCE_LABEL}=${id}`] } });
  assert.equal(list.length, 1);
  return docker.getContainer(list[0].Id);
};
const stop = async (container) => { await container.kill(); await container.wait(); };
let volume;
let sharedNetwork;
const agentId = process.env.HOSTNAME;
const resolveGame = async () => {
  for (let attempt = 0; ; attempt++) {
    try { return await lookup(instanceHostname(id)); }
    catch (error) { if (attempt >= 30) throw error; await delay(100); }
  }
};
try {
  writeConfig(dir, rec.settings);
  const original = await docker.createContainer({
    Image: image, Labels: { [INSTANCE_LABEL]: id }, Env: ["KEEP_SETTING=yes"], Volumes: { "/extra-data": {} },
    ExposedPorts: { "8211/udp": {}, [`${port + 1000}/tcp`]: {} },
    HostConfig: { Binds: [`${dir}/saved:/data/saved`, `${dir}/config:/data/config:ro`],
      PortBindings: { "8211/udp": [{ HostPort: String(port) }],
        [`${port + 1000}/tcp`]: [{ HostPort: String(port + 1000), HostIp: "127.0.0.1" }] } },
  });
  await original.start();
  volume = (await original.inspect()).Mounts.find((mount) => mount.Destination === "/extra-data").Name;
  await execInContainerChecked(rec, ["sh", "-c", "printf preserved > /extra-data/marker; printf saved-world > /data/saved/world.sav"]);
  await stop(original);

  // Migrate the legacy bridge container without recreation, then resolve its
  // stable alias from this Agent container through Docker's embedded DNS.
  assert.ok(agentId);
  sharedNetwork = await docker.createNetwork({ Name: `palserver-${id}`, Driver: "bridge" });
  await sharedNetwork.connect({ Container: agentId });
  process.env.PALSERVER_DOCKER_NETWORK = `palserver-${id}`;
  await startInstance(rec, dir);
  const migrated = await find();
  assert.equal(migrated.id, original.id);
  assert.ok((await resolveGame()).address);
  assert.equal(restApiBaseUrl(rec), `http://${instanceHostname(id)}:${rec.settings.RESTAPIPort}/v1/api`);
  assert.equal(rconEndpoint(rec).host, instanceHostname(id));
  await stop(migrated);

  rec.settings.RCONPort = port + 1001; // Same record update used by world settings.
  await startInstance(rec, dir);
  let current = await find();
  assert.notEqual(current.id, original.id);
  let info = await current.inspect();
  assert.equal(info.HostConfig.PortBindings[`${port + 1000}/tcp`], undefined);
  assert.deepEqual(info.HostConfig.PortBindings[`${port + 1001}/tcp`], [{ HostIp: "127.0.0.1", HostPort: String(port + 1001) }]);
  assert.equal(info.Mounts.find((mount) => mount.Destination === "/extra-data").Name, volume);
  assert.ok(info.NetworkSettings.Networks[`palserver-${id}`].Aliases.includes(instanceHostname(id)));
  assert.ok((await resolveGame()).address);
  assert.ok((await lookup(info.Name.replace(/^\//, ""))).address);
  assert.ok(info.Config.Env.includes("KEEP_SETTING=yes"));
  assert.equal(await execInContainerChecked(rec, ["cat", "/extra-data/marker"]), "preserved");
  assert.equal(fs.readFileSync(`${dir}/saved/world.sav`, "utf8"), "saved-world");

  await stop(current);
  rec.settings.RCONEnabled = false;
  await startInstance(rec, dir);
  current = await find();
  assert.equal((await current.inspect()).HostConfig.PortBindings[`${port + 1001}/tcp`], undefined);
  await stop(current);
  rec.settings.RCONEnabled = true;
  await startInstance(rec, dir);
  info = await (await find()).inspect();
  assert.equal(info.HostConfig.PortBindings[`${port + 1001}/tcp`][0].HostPort, String(port + 1001));
  assert.equal(info.Mounts.find((mount) => mount.Destination === "/extra-data").Name, volume);
  assert.ok((await resolveGame()).address);
  console.log("Docker shared-network migration, Agent-to-game DNS, RCON mapping refresh and volume preservation passed.");
} finally {
  await removeInstanceContainer(rec).catch(() => {});
  if (volume) await docker.getVolume(volume).remove().catch(() => {});
  await docker.getImage(image).remove().catch(() => {});
  if (sharedNetwork) {
    await sharedNetwork.disconnect({ Container: agentId }).catch(() => {});
    await sharedNetwork.remove().catch(() => {});
  }
}
