import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { WorldSettingsSchema } from "@palserver/shared";
import { writeConfig, prepareSavedPermissions, detectManualIniEdits } from "./docker.js";
import { fileLocation, readFile, writeFile } from "./files.js";
import { getConfigHealth, regenerateConfig } from "./config-health.js";
import type { InstanceRecord } from "./store.js";

const rec = { id: "docker-config", backend: "docker", flavor: "vanilla", runtime: "native",
  settings: WorldSettingsSchema.parse({ ServerName: "before" }) } as InstanceRecord;

test("Docker raw editor reads and saves the managed world INI before first game boot", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palserver-config-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ctx = { instanceDir: dir };
  writeConfig(dir, rec.settings);
  const location = fileLocation(rec, ctx, "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini");
  const before = readFile(location.root, location.path).content;
  assert.match(before, /ServerName="before"/);
  writeFile(location.root, location.path, before.replace('ServerName="before"', 'ServerName="after"'));
  assert.equal(detectManualIniEdits(dir).ServerName, "after");
  assert.equal((await getConfigHealth(rec, ctx)).world.exists, true);
  assert.equal((await getConfigHealth(rec, ctx)).world.corrupted, false);
  fs.rmSync(path.join(dir, "config", "PalWorldSettings.ini"));
  await regenerateConfig(rec, ctx, "world");
  assert.equal((await getConfigHealth(rec, ctx)).world.exists, true);
  assert.equal(fs.existsSync(path.join(dir, "server")), false);
  const unsafe = fileLocation(rec, ctx, "../../config/PalWorldSettings.ini");
  assert.throws(() => readFile(unsafe.root, unsafe.path), /路徑不合法/);
});

test("built-in Linux UID 1000 can create and overwrite the runtime INI while the source stays read-only", {
  skip: process.platform !== "linux" || process.getuid?.() !== 0,
}, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palserver-permissions-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.chmodSync(dir, 0o755);
  writeConfig(dir, rec.settings);
  const config = path.join(dir, "saved", "Config", "LinuxServer");
  fs.mkdirSync(config, { recursive: true });
  const dst = path.join(config, "PalWorldSettings.ini");
  fs.writeFileSync(dst, "old root-owned config");
  const src = path.join(dir, "config", "PalWorldSettings.ini");
  fs.chmodSync(src, 0o444);
  prepareSavedPermissions(rec, dir);
  assert.equal(fs.statSync(src).uid, 0, "managed source remains Agent-owned");
  const result = spawnSync(process.execPath, ["-e", `
    const fs = require('node:fs');
    fs.copyFileSync(process.argv[1], process.argv[2]);
    fs.mkdirSync(process.argv[3]);
    try { fs.writeFileSync(process.argv[1], 'must not write'); process.exit(2); } catch {}
  `, src, dst, path.join(dir, "saved", "SaveGames")], { uid: 1000, gid: 1000, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(dst, "utf8"), /ServerName="before"/);
});
