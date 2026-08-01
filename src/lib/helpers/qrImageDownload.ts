const ALLOWED_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_SIZE_BYTES = 8 * 1024 * 1024; // 8MB
const DOWNLOAD_TIMEOUT_MS = 10_000;

/**
 * Downloads an image from a Discord attachment URL and returns it as a Buffer.
 * Returns `null` on any failure (timeout, network error, invalid content type,
 * or oversized payload) so callers can handle it gracefully.
 */
export async function downloadAttachment(url: string): Promise<Buffer | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => { controller.abort(); }, DOWNLOAD_TIMEOUT_MS);

	try {
		const response = await fetch(url, { signal: controller.signal });

		if (!response.ok) return null;

		const contentLength = response.headers.get("content-length");
		if (contentLength && Number(contentLength) > MAX_SIZE_BYTES) return null;

		const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
		if (!ALLOWED_CONTENT_TYPES.includes(contentType)) return null;

		const arrayBuffer = await response.arrayBuffer();

		if (arrayBuffer.byteLength > MAX_SIZE_BYTES) return null;

		return Buffer.from(arrayBuffer);
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}
