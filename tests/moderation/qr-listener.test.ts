import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { QrScannerSettings } from "../../src/db/redis/schema.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// We mock the heavy external dependencies so the listener logic can be tested
// in isolation from Discord.js, sharp, zxing-wasm, and network calls.

const mockDownloadAttachment = mock(() => Promise.resolve(null as Buffer | null));
const mockScanImage = mock(() => Promise.resolve([] as Array<{ raw: string; format: string; contentType: string }>));
const mockEvaluateQrSafety = mock((_data: any, _settings: any) => "safe" as "safe" | "unsafe" | "no_match");
const mockParseQrData = mock((raw: string, contentType: string) => ({ raw, contentType }));

mock.module("../../src/lib/helpers/qrImageDownload.js", () => ({
  downloadAttachment: mockDownloadAttachment,
}));

mock.module("../../src/lib/moderation/qr-scanner.js", () => ({
  scanImage: mockScanImage,
  evaluateQrSafety: mockEvaluateQrSafety,
  parseQrData: mockParseQrData,
}));

// Now import the listener after mocks are set up
const { ScanQrCodesListener } = await import("../../src/listeners/moderation/scanQrCodes.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSettings(overrides: Partial<QrScannerSettings> = {}): QrScannerSettings {
  return {
    mode: "allowlist",
    customAllowlist: ["example.com"],
    customBlocklist: [],
    defaultAllowlistEnabled: false,
    defaultBlocklistEnabled: false,
    safeAction: { enabled: false },
    unsafeAction: { enabled: false, deleteMessage: false },
    ...overrides,
  } as QrScannerSettings;
}

function makeMessage(overrides: Record<string, any> = {}) {
  const channels = new Map<string, any>();
  const client = {
    channels: { cache: { get: (id: string) => channels.get(id) } },
  };

  return {
    author: { bot: false, toString: () => "<@user>" },
    guild: {
      members: {
        me: {
          permissionsIn: () => ({ has: () => true }),
        },
      },
    },
    guildId: "guild-123",
    channelId: "channel-123",
    channel: { toString: () => "<#channel-123>" },
    client,
    attachments: makeCollection([]),
    delete: mock(() => Promise.resolve()),
    _channels: channels,
    ...overrides,
  };
}

function makeAttachment(overrides: Record<string, any> = {}) {
  return {
    id: "att-1",
    url: "https://cdn.discord.com/attachment.png",
    contentType: "image/png",
    ...overrides,
  };
}

/**
 * Creates a Discord.js Collection-like Map with .filter() support.
 */
function makeCollection<T>(entries: Array<[string, T]>): Map<string, T> & { filter: (fn: (v: T) => boolean) => Map<string, T> } {
  const map = new Map(entries);
  (map as any).filter = function (fn: (v: T) => boolean) {
    const result = new Map<string, T>();
    for (const [k, v] of this.entries()) {
      if (fn(v)) result.set(k, v);
    }
    return result;
  };
  return map as any;
}

function setContainer(instance: any, container: any) {
  Object.defineProperty(instance, "container", {
    value: container,
    writable: true,
    configurable: true,
  });
}

function createListenerInstance(settings: QrScannerSettings) {
  // Create a minimal mock of the Sapphire Listener container
  const instance = Object.create(ScanQrCodesListener.prototype);
  setContainer(instance, {
    redis: {
      jsonGet: mock(() => Promise.resolve(settings)),
    },
    logger: {
      error: mock(() => {}),
    },
  });
  return instance;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockDownloadAttachment.mockReset();
  mockScanImage.mockReset();
  mockEvaluateQrSafety.mockReset();
  mockParseQrData.mockReset();

  mockDownloadAttachment.mockImplementation(() => Promise.resolve(null));
  mockScanImage.mockImplementation(() => Promise.resolve([]));
  mockEvaluateQrSafety.mockImplementation(() => "safe");
  mockParseQrData.mockImplementation((raw: string, contentType: string) => ({ raw, contentType }));
});

describe("ScanQrCodesListener – early returns", () => {
  it("skips bot messages", async () => {
    const settings = makeSettings();
    const instance = createListenerInstance(settings);
    const message = makeMessage({ author: { bot: true } });

    await instance.run(message);

    // Redis should never be queried for bot messages
    expect(instance.container.redis.jsonGet).not.toBeCalled();
  });

  it("skips DM messages (no guild)", async () => {
    const settings = makeSettings();
    const instance = createListenerInstance(settings);
    const message = makeMessage({ guild: null, guildId: null });

    await instance.run(message);

    expect(instance.container.redis.jsonGet).not.toBeCalled();
  });

  it("skips messages with no attachments", async () => {
    const settings = makeSettings();
    const instance = createListenerInstance(settings);
    const message = makeMessage(); // empty attachments Map

    await instance.run(message);

    expect(instance.container.redis.jsonGet).not.toBeCalled();
  });

  it("skips messages with non-image attachments", async () => {
    const settings = makeSettings();
    const instance = createListenerInstance(settings);
    const attachments = makeCollection([["att-1", makeAttachment({ contentType: "application/pdf" })]]);
    const message = makeMessage({ attachments });

    await instance.run(message);

    expect(instance.container.redis.jsonGet).not.toBeCalled();
  });

  it("skips when QR scanner mode is off", async () => {
    const settings = makeSettings({ mode: "off" });
    const instance = createListenerInstance(settings);
    const attachments = makeCollection([["att-1", makeAttachment()]]);
    const message = makeMessage({ attachments });

    await instance.run(message);

    // Settings fetched but disabled → no scanning
    expect(instance.container.redis.jsonGet).toBeCalled();
    expect(mockScanImage).not.toBeCalled();
  });

  it("skips when settings are null", async () => {
    const instance = Object.create(ScanQrCodesListener.prototype);
    setContainer(instance, {
      redis: { jsonGet: mock(() => Promise.resolve(null)) },
      logger: { error: mock(() => {}) },
    });
    const attachments = makeCollection([["att-1", makeAttachment()]]);
    const message = makeMessage({ attachments });

    await instance.run(message);

    expect(mockScanImage).not.toBeCalled();
  });
});

describe("ScanQrCodesListener – processing pipeline", () => {
  it("scans image attachments and evaluates QR codes", async () => {
    const settings = makeSettings();
    const instance = createListenerInstance(settings);

    const imageBuffer = Buffer.from("fake-image");
    mockDownloadAttachment.mockImplementation(() => Promise.resolve(imageBuffer));
    mockScanImage.mockImplementation(() =>
      Promise.resolve([{ raw: "https://example.com", format: "QRCode", contentType: "url" }]),
    );
    mockEvaluateQrSafety.mockImplementation(() => "safe");

    const attachments = makeCollection([["att-1", makeAttachment()]]);
    const message = makeMessage({ attachments });

    await instance.run(message);

    expect(mockDownloadAttachment).toBeCalledWith("https://cdn.discord.com/attachment.png");
    expect(mockScanImage).toBeCalledWith(imageBuffer);
    expect(mockEvaluateQrSafety).toBeCalled();
  });

  it("does nothing when image has no QR codes", async () => {
    const settings = makeSettings();
    const instance = createListenerInstance(settings);

    mockDownloadAttachment.mockImplementation(() => Promise.resolve(Buffer.from("img")));
    mockScanImage.mockImplementation(() => Promise.resolve([]));

    const attachments = makeCollection([["att-1", makeAttachment()]]);
    const message = makeMessage({ attachments });

    await instance.run(message);

    expect(mockEvaluateQrSafety).not.toBeCalled();
  });

  it("processes multiple image attachments", async () => {
    const settings = makeSettings();
    const instance = createListenerInstance(settings);

    mockDownloadAttachment.mockImplementation(() => Promise.resolve(Buffer.from("img")));
    mockScanImage.mockImplementation(() =>
      Promise.resolve([{ raw: "https://safe.com", format: "QRCode", contentType: "url" }]),
    );
    mockEvaluateQrSafety.mockImplementation(() => "safe");

    const attachments = makeCollection([
      ["att-1", makeAttachment({ id: "att-1" })],
      ["att-2", makeAttachment({ id: "att-2", url: "https://cdn.discord.com/other.png" })],
    ]);
    const message = makeMessage({ attachments });

    await instance.run(message);

    // Both attachments should be downloaded
    expect(mockDownloadAttachment).toBeCalledTimes(2);
  });

  it("skips a failed download and continues with others", async () => {
    const settings = makeSettings();
    const instance = createListenerInstance(settings);

    let callCount = 0;
    mockDownloadAttachment.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(null); // first fails
      return Promise.resolve(Buffer.from("img"));
    });
    mockScanImage.mockImplementation(() =>
      Promise.resolve([{ raw: "https://example.com", format: "QRCode", contentType: "url" }]),
    );
    mockEvaluateQrSafety.mockImplementation(() => "safe");

    const attachments = makeCollection([
      ["att-1", makeAttachment({ id: "att-1" })],
      ["att-2", makeAttachment({ id: "att-2", url: "https://cdn.discord.com/other.png" })],
    ]);
    const message = makeMessage({ attachments });

    await instance.run(message);

    // First download returned null → scan not called for it
    // Second download succeeded → scan called once
    expect(mockScanImage).toBeCalledTimes(1);
  });
});

describe("ScanQrCodesListener – action routing", () => {
  it("deletes message on unsafe QR when deleteMessage is enabled", async () => {
    const settings = makeSettings({
      unsafeAction: { enabled: true, deleteMessage: true, channelId: "alert-ch" },
    });
    const instance = createListenerInstance(settings);

    mockDownloadAttachment.mockImplementation(() => Promise.resolve(Buffer.from("img")));
    mockScanImage.mockImplementation(() =>
      Promise.resolve([{ raw: "https://evil.com", format: "QRCode", contentType: "url" }]),
    );
    mockEvaluateQrSafety.mockImplementation(() => "unsafe");
    mockParseQrData.mockImplementation((raw: string, contentType: string) => ({ raw, contentType }));

    const deleteMock = mock(() => Promise.resolve());
    const attachments = makeCollection([["att-1", makeAttachment()]]);
    const message = makeMessage({ attachments, delete: deleteMock });

    await instance.run(message);

    expect(deleteMock).toBeCalled();
  });

  it("does not delete message when unsafeAction.deleteMessage is false", async () => {
    const settings = makeSettings({
      unsafeAction: { enabled: true, deleteMessage: false, channelId: "alert-ch" },
    });
    const instance = createListenerInstance(settings);

    mockDownloadAttachment.mockImplementation(() => Promise.resolve(Buffer.from("img")));
    mockScanImage.mockImplementation(() =>
      Promise.resolve([{ raw: "https://evil.com", format: "QRCode", contentType: "url" }]),
    );
    mockEvaluateQrSafety.mockImplementation(() => "unsafe");
    mockParseQrData.mockImplementation((raw: string, contentType: string) => ({ raw, contentType }));

    const deleteMock = mock(() => Promise.resolve());
    const attachments = makeCollection([["att-1", makeAttachment()]]);
    const message = makeMessage({ attachments, delete: deleteMock });

    await instance.run(message);

    expect(deleteMock).not.toBeCalled();
  });

  it("does not delete message when unsafeAction is disabled", async () => {
    const settings = makeSettings({
      unsafeAction: { enabled: false, deleteMessage: true },
    });
    const instance = createListenerInstance(settings);

    mockDownloadAttachment.mockImplementation(() => Promise.resolve(Buffer.from("img")));
    mockScanImage.mockImplementation(() =>
      Promise.resolve([{ raw: "https://evil.com", format: "QRCode", contentType: "url" }]),
    );
    mockEvaluateQrSafety.mockImplementation(() => "unsafe");

    const deleteMock = mock(() => Promise.resolve());
    const attachments = makeCollection([["att-1", makeAttachment()]]);
    const message = makeMessage({ attachments, delete: deleteMock });

    await instance.run(message);

    expect(deleteMock).not.toBeCalled();
  });

  it("sends notification on safe QR when safeAction is enabled", async () => {
    const sendMock = mock(() => Promise.resolve());
    const settings = makeSettings({
      safeAction: { enabled: true, channelId: "safe-ch" },
    });
    const instance = createListenerInstance(settings);

    mockDownloadAttachment.mockImplementation(() => Promise.resolve(Buffer.from("img")));
    mockScanImage.mockImplementation(() =>
      Promise.resolve([{ raw: "https://safe.com", format: "QRCode", contentType: "url" }]),
    );
    mockEvaluateQrSafety.mockImplementation(() => "safe");
    mockParseQrData.mockImplementation((raw: string, contentType: string) => ({ raw, contentType }));

    const channels = new Map([["safe-ch", { send: sendMock }]]);
    const attachments = makeCollection([["att-1", makeAttachment()]]);
    const message = makeMessage({
      attachments,
      client: { channels: { cache: { get: (id: string) => channels.get(id) } } },
    });

    await instance.run(message);

    expect(sendMock).toBeCalled();
  });

  it("does not send safe alert when safe action is disabled", async () => {
    const sendMock = mock(() => Promise.resolve());
    const settings = makeSettings({ safeAction: { enabled: false } });
    const instance = createListenerInstance(settings);

    mockDownloadAttachment.mockImplementation(() => Promise.resolve(Buffer.from("img")));
    mockScanImage.mockImplementation(() =>
      Promise.resolve([{ raw: "https://example.com", format: "QRCode", contentType: "url" }]),
    );
    mockEvaluateQrSafety.mockImplementation(() => "safe");

    const channels = new Map([["ch-1", { send: sendMock }]]);
    const attachments = makeCollection([["att-1", makeAttachment()]]);
    const message = makeMessage({
      attachments,
      client: { channels: { cache: { get: (_id: string) => channels.get(_id) } } },
    });

    await instance.run(message);

    expect(sendMock).not.toBeCalled();
  });
});
