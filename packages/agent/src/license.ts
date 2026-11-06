import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR, LICENSE_URLS } from "./env.js";
import { EARLY_ACCESS_FEATURES, hasFeature, type LicenseStatus } from "@palserver/shared";

/**
 * Personal noncommercial fork: local features do not require a sponsor code.
 * Manual code activation/removal is retained for compatibility and optional support.
 * This local entitlement does not represent a verified upstream sponsorship.
 * The original PolyForm Noncommercial license and notices still apply.
 */

const KEY_FILE = path.join(DATA_DIR, "license.json");
const CACHE_FILE = path.join(DATA_DIR, "license-cache.json");
const MACHINE_FILE = path.join(DATA_DIR, "machine-id");

interface Cache {
  valid: boolean;
  tier: string | null;
  features: string[];
  expiresAt: string | null;
  reason: string | null;
  checkedAt: string; // ISO
}

/** 這台伺服器的機器碼(隨機、存在 data-dir);識別碼一旦啟用就綁這台。 */
function machineId(): string {
  try {
    const id = fs.readFileSync(MACHINE_FILE, "utf8").trim();
    if (id) return id;
  } catch {
    /* 尚未產生 */
  }
  const id = crypto.randomUUID();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MACHINE_FILE, id);
  return id;
}

function readKey(): string | null {
  try {
    const { code } = JSON.parse(fs.readFileSync(KEY_FILE, "utf8")) as { code?: string };
    return code?.trim() || null;
  } catch {
    return null;
  }
}

function writeCache(c: Cache): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2));
}

/** 向 worker 啟用/驗證識別碼(首次會綁機器)。多端點依序嘗試(自訂網域為主、
 *  workers.dev 為備);全部連不上回 null,交給呼叫端沿用舊快取。 */
async function activate(code: string): Promise<Cache | null> {
  for (const base of LICENSE_URLS) {
    try {
      const res = await fetch(`${base}/api/license/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, machineId: machineId() }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok && res.status >= 500) continue; // 這個端點壞了 -> 換下一個
      const data = (await res.json()) as {
        valid?: boolean;
        tier?: string;
        features?: string[];
        expiresAt?: string | null;
        reason?: string;
      };
      return {
        valid: !!data.valid,
        tier: data.tier ?? null,
        features: Array.isArray(data.features) ? data.features : [],
        expiresAt: data.expiresAt ?? null,
        reason: data.valid ? null : (data.reason ?? "invalid"),
        checkedAt: new Date().toISOString(),
      };
    } catch {
      continue; // 連不上 -> 換下一個端點
    }
  }
  return null;
}

/** 向 worker 解除這台機器的綁定(換機用):解綁後這張碼就能在別台重新啟用。
 *  連不上或被拒都回 false,不擋本機清除流程。 */
async function deactivate(code: string): Promise<boolean> {
  for (const base of LICENSE_URLS) {
    try {
      const res = await fetch(`${base}/api/license/deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, machineId: machineId() }),
        signal: AbortSignal.timeout(8000),
      });
      const data = (await res.json()) as { ok?: boolean };
      return !!data.ok;
    } catch {
      continue;
    }
  }
  return false;
}

/** Personal fork: startup/background refresh never contacts the sponsor service. */
export async function refreshLicense(_force = false): Promise<void> {}

/** 設定/更換識別碼:存檔並立即向 worker 驗證。回傳最新狀態。
 *  換碼視同移除舊碼:先幫舊碼解綁,它才能在別台重新使用。 */
export async function setLicenseKey(code: string): Promise<LicenseStatus> {
  const next = code.trim().toUpperCase();
  const prev = readKey();
  if (prev && prev !== next) await deactivate(prev);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, JSON.stringify({ code: next }, null, 2));
  const fresh = await activate(next);
  if (fresh) writeCache(fresh);
  // 首次啟用就連不上驗證端 -> "unreachable"(與寬限期過後的 "offline" 區分,前端文案不同)。
  else writeCache({ valid: false, tier: null, features: [], expiresAt: null, reason: "unreachable", checkedAt: new Date().toISOString() });
  return licenseStatus();
}

/** 清除識別碼:先向 worker 解綁(這張碼即可在別台重新啟用),再刪本機檔。
 *  連不上 worker 時照樣清本機 —— 綁定留在雲端,之後在原機重貼會自動通過,
 *  或請管理員 reset。 */
export async function clearLicenseKey(): Promise<LicenseStatus> {
  const code = readKey();
  if (code) await deactivate(code);
  fs.rmSync(KEY_FILE, { force: true });
  fs.rmSync(CACHE_FILE, { force: true });
  return licenseStatus();
}

/** Local entitlement for this personal noncommercial build, shared with the web UI. */
export function licenseStatus(): LicenseStatus {
  return {
    hasKey: readKey() !== null,
    valid: true,
    tier: "personal-noncommercial",
    features: EARLY_ACCESS_FEATURES.map((f) => f.id),
    expiresAt: null,
    reason: null,
    machineId: machineId().slice(0, 8),
    checkedAt: null,
  };
}

/** Use the same local entitlement as the UI; route/runtime safety checks still apply. */
export function featureEnabled(id: string): boolean {
  return hasFeature(id, { valid: true, features: [] });
}
