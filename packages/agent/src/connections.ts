import type { InstanceRecord } from "./store.js";

function defaultHost(rec: InstanceRecord): string {
  return rec.backend === "k8s" && rec.k8sServiceName && rec.k8sNamespace
    ? `${rec.k8sServiceName}.${rec.k8sNamespace}` : "127.0.0.1";
}

function tcpEndpoint(address: string | undefined, host: string, port: number): { host: string; port: number } {
  if (!address?.trim()) return { host, port };
  const url = new URL(`tcp://${address.trim()}`);
  return { host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port) };
}

export function restApiBaseUrl(rec: InstanceRecord): string {
  const custom = rec.connection?.restApiUrl?.trim();
  if (!custom) return `http://${defaultHost(rec)}:${rec.settings.RESTAPIPort}/v1/api`;
  const base = new URL(custom).href.replace(/\/+$/, "");
  return base.endsWith("/v1/api") ? base : `${base}/v1/api`;
}

export function rconEndpoint(rec: InstanceRecord): { host: string; port: number } {
  return tcpEndpoint(rec.connection?.rconAddress, defaultHost(rec), Number(rec.settings.RCONPort));
}

export function palDefenderBaseUrl(rec: InstanceRecord, port: number): string {
  const endpoint = tcpEndpoint(rec.connection?.palDefenderAddress, defaultHost(rec), port);
  const host = endpoint.host.includes(":") ? `[${endpoint.host}]` : endpoint.host;
  return `http://${host}:${endpoint.port}/v1/pdapi`;
}
