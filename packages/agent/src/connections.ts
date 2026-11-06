import type { InstanceRecord } from "./store.js";
import { connectionAddressUrl } from "@palserver/shared";

function unifiedBase(rec: InstanceRecord): URL {
  return connectionAddressUrl(rec.connection?.address ?? "localhost");
}

function serviceUrl(rec: InstanceRecord, port: number, api: "api" | "pdapi"): string {
  const url = unifiedBase(rec);
  url.port = String(port);
  const prefix = url.pathname.replace(/\/+$/, "").replace(/\/v1\/(api|pdapi)$/, "");
  url.pathname = `${prefix}/v1/${api}`;
  return url.href.replace(/\/+$/, "");
}

// Preserve existing split destinations until the user saves the unified setting.
function legacy(rec: InstanceRecord): boolean {
  return rec.connection?.address === undefined;
}

export function restApiBaseUrl(rec: InstanceRecord): string {
  const old = legacy(rec) ? rec.connection?.restApiUrl?.trim() : undefined;
  if (old) {
    const base = new URL(old).href.replace(/\/+$/, "");
    return base.endsWith("/v1/api") ? base : `${base}/v1/api`;
  }
  return serviceUrl(rec, Number(rec.settings.RESTAPIPort), "api");
}

export function rconEndpoint(rec: InstanceRecord): { host: string; port: number } {
  const old = legacy(rec) ? rec.connection?.rconAddress?.trim() : undefined;
  if (old) {
    const url = new URL(`tcp://${old}`);
    return { host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port) };
  }
  return { host: unifiedBase(rec).hostname.replace(/^\[|\]$/g, ""), port: Number(rec.settings.RCONPort) };
}

export function palDefenderBaseUrl(rec: InstanceRecord, port: number): string {
  const old = legacy(rec) ? rec.connection?.palDefenderAddress?.trim() : undefined;
  if (old) {
    const url = new URL(`http://${old}`);
    return `http://${url.host}/v1/pdapi`;
  }
  return serviceUrl(rec, port, "pdapi");
}
