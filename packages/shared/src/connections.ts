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

/** Agent-side destinations only; these do not change game listen ports. Empty restores defaults. */
export const ConnectionSettingsSchema = z.object({
  restApiUrl: httpAddress.optional(),
  rconAddress: tcpAddress.optional(),
  palDefenderAddress: tcpAddress.optional(),
}).strict();
export type ConnectionSettings = z.infer<typeof ConnectionSettingsSchema>;
