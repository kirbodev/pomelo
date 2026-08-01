import sharp from "sharp";
import { readBarcodes } from "zxing-wasm/reader";
import { DEFAULT_BLOCKLIST } from "./default-blocklist.js";
import { DEFAULT_ALLOWLIST } from "./default-allowlist.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type QRContentType = "url" | "text" | "wifi" | "vcard" | "other";

export interface QRDecodeResult {
  raw: string;
  format: string;
  contentType: QRContentType;
}

export interface ParsedQrData {
  raw: string;
  contentType: QRContentType;
  url?: string;
  wifi?: { ssid: string; encryption?: string };
}

// ── Image preprocessing ──────────────────────────────────────────────────────

/**
 * Preprocess an image buffer for optimal QR code detection.
 * Resizes to max 1024px (keeping aspect ratio), converts to greyscale,
 * boosts contrast slightly, and sharpens.
 */
export async function preprocessImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .greyscale()
    .linear(1.2, -20) // slight contrast boost
    .sharpen({ sigma: 1.5 })
    .png()
    .toBuffer();
}

// ── QR decoding ──────────────────────────────────────────────────────────────

/**
 * Decode all QR codes found in an image buffer using zxing-wasm.
 * Returns an empty array if decoding fails entirely.
 */
export async function decodeQrCodes(buffer: Buffer): Promise<QRDecodeResult[]> {
  try {
    const results = await readBarcodes(buffer, {
      formats: ["QRCode"],
      tryHarder: true,
    });

    return results.map((r) => ({
      raw: r.text,
      format: r.format,
      contentType: classifyQrContent(r.text),
    }));
  } catch {
    return [];
  }
}

// ── Content classification ───────────────────────────────────────────────────

const UrlPattern = /^https?:\/\//i;

/**
 * Classify the content of a decoded QR code string.
 */
export function classifyQrContent(raw: string): QRContentType {
  if (UrlPattern.test(raw)) return "url";
  if (raw.toUpperCase().startsWith("WIFI:")) return "wifi";
  if (raw.toUpperCase().startsWith("BEGIN:VCARD")) return "vcard";

  // Fallback: try URL constructor for non-standard URL schemes
  try {
    new URL(raw);
    return "url";
  } catch {
    // not a URL
  }

  return "text";
}

// ── Structured data parsing ──────────────────────────────────────────────────

/**
 * Parse structured data from a QR code based on its content type.
 */
export function parseQrData(raw: string, contentType: QRContentType): ParsedQrData {
  const base: ParsedQrData = { raw, contentType };

  switch (contentType) {
    case "url": {
      try {
        base.url = new URL(raw).href;
      } catch {
        base.url = raw;
      }
      break;
    }
    case "wifi": {
      base.wifi = parseWifiQr(raw);
      break;
    }
    case "vcard": {
      // vCard parsing is intentionally minimal – extract only what's needed
      break;
    }
    default:
      break;
  }

  return base;
}

/**
 * Parse a WiFi QR string in the format: WIFI:T:<encryption>;S:<ssid>;P:<password>;;
 */
function parseWifiQr(raw: string): { ssid: string; encryption?: string } {
  const fields: Record<string, string> = {};
  // Strip the leading "WIFI:" and trailing ";;", then split on ";"
  const body = raw.replace(/^WIFI:/i, "").replace(/;;$/, "");
  for (const segment of body.split(";")) {
    const colonIdx = segment.indexOf(":");
    if (colonIdx === -1) continue;
    const key = segment.slice(0, colonIdx).toUpperCase();
    const value = segment.slice(colonIdx + 1);
    fields[key] = value;
  }

  return {
    ssid: fields["S"] ?? "",
    encryption: fields["T"] || undefined,
  };
}

// ── Safety evaluation ────────────────────────────────────────────────────────

export interface QrSafetySettings {
  mode: "allowlist" | "blocklist" | "off";
  customAllowlist: string[];
  customBlocklist: string[];
  defaultAllowlistEnabled: boolean;
  defaultBlocklistEnabled: boolean;
}

export function normalizeDomain(input: string): string {
  let domain = input.toLowerCase().trim();
  if (domain.startsWith("www.")) domain = domain.slice(4);
  try {
    const url = new URL(domain.startsWith("http") ? domain : `https://${domain}`);
    domain = url.hostname;
  } catch {
    // not a URL, use as-is
  }
  if (domain.startsWith("www.")) domain = domain.slice(4);
  return domain;
}

export function matchesDomain(hostname: string, entry: string): boolean {
  const normalizedHost = normalizeDomain(hostname);
  const normalizedEntry = normalizeDomain(entry);
  if (normalizedHost === normalizedEntry) return true;
  if (normalizedHost.endsWith(`.${normalizedEntry}`)) return true;
  if (normalizedEntry.endsWith(`.${normalizedHost}`)) return true;
  return false;
}

function hostnameFromData(data: ParsedQrData): string | null {
  if (data.url) {
    try {
      return new URL(data.url).hostname;
    } catch {
      return null;
    }
  }
  try {
    return new URL(data.raw).hostname;
  } catch {
    return null;
  }
}

export function evaluateQrSafety(
  data: ParsedQrData,
  settings: QrSafetySettings,
): "safe" | "unsafe" {
  if (settings.mode === "off") return "safe";

  const hostname = hostnameFromData(data);

  if (settings.mode === "allowlist") {
    if (!hostname) return "unsafe";
    if (settings.customAllowlist.some((entry) => matchesDomain(hostname, entry))) return "safe";
    if (settings.defaultAllowlistEnabled && [...DEFAULT_ALLOWLIST].some((entry) => matchesDomain(hostname, entry))) return "safe";
    return "unsafe";
  }

  if (!hostname) return "safe";
  if (settings.customBlocklist.some((entry) => matchesDomain(hostname, entry))) return "unsafe";
  if (settings.defaultBlocklistEnabled && [...DEFAULT_BLOCKLIST].some((entry) => matchesDomain(hostname, entry))) return "unsafe";
  return "safe";
}

// ── Convenience ──────────────────────────────────────────────────────────────

/**
 * Full pipeline: preprocess an image buffer then decode all QR codes.
 * Returns a flat array of all decoded QR results.
 */
export async function scanImage(buffer: Buffer): Promise<QRDecodeResult[]> {
  const processed = await preprocessImage(buffer);
  return decodeQrCodes(processed);
}

// ── Safety check (full pipeline) ─────────────────────────────────────────────

export interface QrSafetyCheckSettings {
  guildId: string;
  mode: "allowlist" | "blocklist" | "off";
  customAllowlist: string[];
  customBlocklist: string[];
  defaultAllowlistEnabled: boolean;
  defaultBlocklistEnabled: boolean;
}

export interface QrSafetyCheckResult {
  guildId: string;
  totalQrCodes: number;
  unsafeQrCodes: number;
  blocked: boolean;
  results: Array<{
    raw: string;
    contentType: QRContentType;
    safety: "safe" | "unsafe";
  }>;
}

/**
 * Full safety pipeline: scan an image, classify each QR code, and evaluate
 * safety against the guild's allowlist/blocklist settings.
 */
export async function checkImageSafety(
  buffer: Buffer,
  settings: QrSafetyCheckSettings,
): Promise<QrSafetyCheckResult> {
  const decoded = await scanImage(buffer);

  const results = decoded.map((qr) => {
    const parsed = parseQrData(qr.raw, qr.contentType);
    const safety = evaluateQrSafety(parsed, {
      mode: settings.mode,
      customAllowlist: settings.customAllowlist,
      customBlocklist: settings.customBlocklist,
      defaultAllowlistEnabled: settings.defaultAllowlistEnabled,
      defaultBlocklistEnabled: settings.defaultBlocklistEnabled,
    });
    return { raw: qr.raw, contentType: qr.contentType, safety };
  });

  const unsafeQrCodes = results.filter((r) => r.safety === "unsafe").length;

  return {
    guildId: settings.guildId,
    totalQrCodes: decoded.length,
    unsafeQrCodes,
    blocked: unsafeQrCodes > 0,
    results,
  };
}

// ── Logging ──────────────────────────────────────────────────────────────────

export interface QrScanLogEntry {
  guildId: string;
  channelId: string;
  messageId: string;
  userId: string;
  totalQrCodes: number;
  unsafeQrCodes: number;
  blocked: boolean;
  timestamp: string;
  results: Array<{
    raw: string;
    contentType: QRContentType;
    safety: "safe" | "unsafe";
  }>;
}

export interface QrScanLogger {
  info(entry: QrScanLogEntry): void;
  warn(entry: QrScanLogEntry): void;
}

/**
 * Log a QR scan event using the provided logger.
 * Uses `warn` level when any QR codes were blocked, `info` otherwise.
 */
export function logQrScanEvent(
  logger: QrScanLogger,
  entry: QrScanLogEntry,
): void {
  if (entry.blocked) {
    logger.warn(entry);
  } else {
    logger.info(entry);
  }
}
