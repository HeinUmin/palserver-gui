import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EARLY_ACCESS_FEATURES, hasFeature } from "@palserver/shared";

test("personal features work without a code, offline, and with stale license files", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palserver-personal-license-"));
  const previousDir = process.env.PALSERVER_DATA_DIR;
  process.env.PALSERVER_DATA_DIR = dir;
  const previousFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error("offline");
  };
  try {
    const { licenseStatus, featureEnabled, refreshLicense, clearLicenseKey } = await import("./license.js");
    const checkFeatures = () => {
      const status = licenseStatus();
      assert.equal(status.valid, true);
      assert.equal(status.tier, "personal-noncommercial");
      assert.equal(status.expiresAt, null);
      assert.equal(status.checkedAt, null);
      assert.equal(status.reason, null);
      assert.deepEqual(status.features, EARLY_ACCESS_FEATURES.map((f) => f.id));
      for (const { id } of EARLY_ACCESS_FEATURES) {
        assert.equal(featureEnabled(id), true, `backend: ${id}`);
        assert.equal(hasFeature(id, status), true, `frontend: ${id}`);
      }
      assert.equal(featureEnabled("ordinary-free-feature"), true);
    };
    assert.equal(licenseStatus().hasKey, false);
    checkFeatures();
    await refreshLicense();
    await refreshLicense(true);
    assert.equal(requests, 0);
    fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ code: "OLD-CODE" }));
    for (const reason of ["expired", "invalid", "offline", "bound-to-another"]) {
      fs.writeFileSync(path.join(dir, "license-cache.json"), JSON.stringify({
        valid: false, features: [], reason, expiresAt: "2000-01-01", checkedAt: "2000-01-01",
      }));
      checkFeatures();
      await refreshLicense(true);
    }
    assert.equal(requests, 0, "background refresh must not validate old codes remotely");
    fs.rmSync(path.join(dir, "license.json"));
    assert.equal((await clearLicenseKey()).hasKey, false);
    checkFeatures();
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDir === undefined) delete process.env.PALSERVER_DATA_DIR;
    else process.env.PALSERVER_DATA_DIR = previousDir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
