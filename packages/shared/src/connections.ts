import { z } from "zod";

function validUrl(value: string, tcp: boolean): boolean {
  if (value === "") return true;
  if (/[\s\\]/.test(value)) return false;
  try {
    const url = new URL(tcp ? `tcp://${value}` : value);
    return !!url.hostname && (!url.port || Number(url.port) >= 1) && !url.username && !url.password && !url.search && !url.hash &&
      (tcp
        ? !value.includes("://") && !!url.port && (url.pathname === "" || url.pathname === "/") && !value.endsWith("/")
        : ["http:", "https:"].includes(url.protocol));
  } catch { return false; }
}

const tcpAddress = z.string().trim().max(300).refine((s) => validUrl(s, true), "請輸入主機:埠,例如 192.168.1.10:25575 或 [::1]:25575");
const httpAddress = z.string().trim().max(500).refine((s) => validUrl(s, false), "請輸入 http:// 或 https:// 位址,不要包含帳密、查詢參數或片段");

/** Shared HTTP base; bare IPs/DNS names default to HTTP. */
export function connectionAddressUrl(value: string): URL {
  let address = value.trim() || "localhost";
  if (!address.includes("://")) {
    if ((address.match(/:/g)?.length ?? 0) > 1 && !address.startsWith("[")) address = `[${address}]`;
    address = `http://${address}`;
  }
  return new URL(address);
}

const unifiedAddress = z.string().trim().max(500).refine((value) => {
  if (!value) return true;
  if (/[\s\\]/.test(value)) return false;
  try {
    const url = connectionAddressUrl(value);
    const authority = value.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0];
    const explicitPort = authority.startsWith("[") ? authority.slice(authority.indexOf("]") + 1).startsWith(":")
      : (authority.match(/:/g)?.length ?? 0) === 1;
    return ["http:", "https:"].includes(url.protocol) && !!url.hostname && !explicitPort &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}, "請填寫 IP、主機名或 http(s) URL,不要填端口、帳密或查詢參數;端口由各服務配置讀取");

/** Agent-side destinations only; these do not change game listen ports. Empty restores defaults. */
export const ConnectionSettingsSchema = z.object({
  address: unifiedAddress.optional(),
  // Legacy fields remain readable for upgrades; the UI writes only address.
  restApiUrl: httpAddress.optional(),
  rconAddress: tcpAddress.optional(),
  palDefenderAddress: tcpAddress.optional(),
}).strict().refine((value) => value.address === undefined ||
  (!value.restApiUrl && !value.rconAddress && !value.palDefenderAddress), "統一地址不能和舊版獨立地址同時設定");
export type ConnectionSettings = z.infer<typeof ConnectionSettingsSchema>;

/** Suggest a unified value only when all saved legacy destinations share a host. */
export function legacyConnectionAddress(value: ConnectionSettings | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const urls = [value.restApiUrl ? new URL(value.restApiUrl) : null,
      value.rconAddress ? new URL(`http://${value.rconAddress}`) : null,
      value.palDefenderAddress ? new URL(`http://${value.palDefenderAddress}`) : null].filter((url): url is URL => !!url);
    if (!urls.length || !urls.every((url) => url.hostname === urls[0].hostname)) return undefined;
    const url = urls[0];
    url.port = "";
    url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1\/(api|pdapi)$/, "");
    return value.restApiUrl ? url.href.replace(/\/+$/, "") : url.hostname;
  } catch { return undefined; }
}
