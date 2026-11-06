import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { WorldSettingsSchema } from "@palserver/shared";
import { createContainer, docker } from "./docker.js";
import type { InstanceRecord } from "./store.js";

const rec = {
  id: "build-test", name: "build-test", backend: "docker", flavor: "vanilla",
  runtime: "native", gamePort: 8211, settings: WorldSettingsSchema.parse({}),
} as InstanceRecord;

for (const event of [
  { error: "COPY --chmod requires BuildKit" },
  { errorDetail: { message: "failed to download base image" } },
]) {
  test(`failed Docker build stops container creation: ${JSON.stringify(event)}`, async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palserver-build-test-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    t.mock.method(docker, "getImage", () => ({ inspect: async () => { throw new Error("missing image"); } }));
    t.mock.method(docker, "buildImage", async () => Readable.from([
      JSON.stringify({ stream: "Step 1/8: building\n" }) + "\n",
      JSON.stringify(event) + "\n",
    ]));
    const create = t.mock.method(docker, "createContainer", async () => {
      throw new Error("must not try creating a container after a failed build");
    });
    await assert.rejects(createContainer(rec, dir), {
      message: event.errorDetail?.message ?? event.error,
    });
    assert.equal(create.mock.callCount(), 0);
  });
}

test("completed build without a tagged image cannot create a container", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palserver-build-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  t.mock.method(docker, "getImage", () => ({ inspect: async () => { throw new Error("missing image"); } }));
  t.mock.method(docker, "buildImage", async () => Readable.from(['{"stream":"done"}\n']));
  const create = t.mock.method(docker, "createContainer", async () => ({ id: "must-not-create" }));
  await assert.rejects(createContainer(rec, dir), /鏡像準備完成後仍找不到/);
  assert.equal(create.mock.callCount(), 0);
});

test("successful build verifies the image before creating a container", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palserver-build-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let inspections = 0;
  t.mock.method(docker, "getImage", () => ({ inspect: async () => {
    if (++inspections === 1) throw new Error("missing image");
    return { Id: "built-image" };
  } }));
  t.mock.method(docker, "buildImage", async () => Readable.from(['{"stream":"Successfully tagged"}\n']));
  const create = t.mock.method(docker, "createContainer", async () => ({ id: "created-container" }));
  assert.equal(await createContainer({ ...rec, settings: { ...rec.settings, RCONEnabled: true, RCONPort: 25575 } }, dir), "created-container");
  assert.equal(inspections, 2);
  assert.equal(create.mock.callCount(), 1);
  const options = create.mock.calls[0].arguments[0];
  assert.deepEqual(options?.HostConfig?.PortBindings?.["25575/tcp"], [{ HostPort: "25575" }]);
});
