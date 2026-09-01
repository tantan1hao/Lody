import {
  SESSION_FILE_GET_MAX_CHUNK_BYTES,
  SESSION_FILE_MAX_SIZE_BYTES,
  SESSION_FILE_PREVIEW_FETCH_BYTES,
  type SessionFileGetRequest,
  type SessionFileGetResponse,
  type SessionId,
  type WorkspaceId,
} from '@lody/shared';
import { buildSessionFileDownloadUrl, buildSessionFilePreviewUrl } from './session-file-upload';
import { isNativeAppShell } from './native-platform';
import { saveSessionFileToNativeShareSheet } from './session-file-native-save';

type FileFetchArgs = {
  workspaceId: WorkspaceId;
  sessionId: SessionId;
  fileId: string;
  token: string;
  /** Official cloud uses HTTP; local/self-hosted walk Machine RPC chunks. */
  source?: 'official' | 'machine';
};

export type SessionFileGetLoader = (request: SessionFileGetRequest) => Promise<SessionFileGetResponse>;

let sessionFileGetLoader: SessionFileGetLoader | null = null;

export const setSessionFileGetLoader = (loader: SessionFileGetLoader | null): void => {
  sessionFileGetLoader = loader;
};

const decodeBase64Bytes = (data: string): Uint8Array => {
  const binary = atob(data.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const concatBytes = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

const fetchSessionFileChunksFromMachine = async (args: {
  sessionId: SessionId;
  fileId: string;
  maxTotalBytes?: number;
}): Promise<{
  bytes: Uint8Array;
  mimeType: string;
  fileName?: string;
  sizeBytes: number;
  eof: boolean;
}> => {
  if (!sessionFileGetLoader) {
    throw new Error('Session file machine loader is not available');
  }
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let mimeType = 'application/octet-stream';
  let fileName: string | undefined;
  let sizeBytes = 0;
  let eof = false;
  const limit = args.maxTotalBytes;
  const maxChunks =
    Math.ceil(SESSION_FILE_MAX_SIZE_BYTES / Math.max(1, SESSION_FILE_GET_MAX_CHUNK_BYTES)) + 1;
  while (!eof && (limit === undefined || offset < limit)) {
    if (chunks.length >= maxChunks) {
      throw new Error('Session file get exceeded the chunk budget');
    }
    const remaining = limit === undefined ? SESSION_FILE_GET_MAX_CHUNK_BYTES : limit - offset;
    const maxBytes = Math.min(SESSION_FILE_GET_MAX_CHUNK_BYTES, remaining);
    if (maxBytes <= 0) {
      break;
    }
    const response = await sessionFileGetLoader({
      sessionId: args.sessionId,
      fileId: args.fileId,
      offset,
      maxBytes,
    });
    if (response.status !== 'ok') {
      throw new Error(response.message);
    }
    mimeType = response.mimeType;
    fileName = response.fileName ?? fileName;
    sizeBytes = response.sizeBytes;
    if (response.byteLength > 0) {
      chunks.push(decodeBase64Bytes(response.data));
    }
    eof = response.eof;
    const nextOffset = response.offset + response.byteLength;
    if (nextOffset <= offset && !eof) {
      throw new Error('Session file get did not advance');
    }
    offset = nextOffset;
  }
  return { bytes: concatBytes(chunks), mimeType, fileName, sizeBytes, eof };
};

const triggerBrowserDownload = (blob: Blob, fileName: string): void => {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
};

const downloadSessionFileFromMachine = async (
  args: FileFetchArgs & { fileName: string; mimeType?: string }
): Promise<void> => {
  const result = await fetchSessionFileChunksFromMachine({
    sessionId: args.sessionId,
    fileId: args.fileId,
  });
  const blob = new Blob([Uint8Array.from(result.bytes)], {
    type: result.mimeType || args.mimeType || '',
  });
  triggerBrowserDownload(blob, args.fileName || result.fileName || args.fileId);
};

/**
 * Save/export a file's bytes for the user.
 *
 * Platform branches (Decision #7 in plans/session-files-implementation.md):
 * - **Native (Capacitor mobile)**: a browser-style `<a download>` is unreliable
 *   inside the iOS WKWebView shell, so we stream the bytes to the app cache via
 *   the Filesystem plugin (chunked, base64) and hand the resulting file URI to
 *   the OS share sheet (which exposes Save-to-Files / AirDrop / etc.). Bytes are
 *   never buffered whole — see `session-file-native-save.ts`.
 * - **Web / Electron**: bearer fetch → blob → synthetic `<a download>`. The
 *   server sets `Content-Disposition: attachment` + `nosniff`, so this never
 *   navigates the browser to user-controlled bytes.
 */
const downloadSessionFileInBrowser = async (
  args: FileFetchArgs & { fileName: string }
): Promise<void> => {
  const { workspaceId, sessionId, fileId, token, fileName } = args;
  const response = await fetch(buildSessionFileDownloadUrl(workspaceId, sessionId, fileId), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to download file (${response.status})`);
  }
  const blob = await response.blob();
  triggerBrowserDownload(blob, fileName || fileId);
};

export const downloadSessionFile = async (
  args: FileFetchArgs & { fileName: string; mimeType?: string }
): Promise<void> => {
  if (args.source === 'machine') {
    await downloadSessionFileFromMachine(args);
    return;
  }
  if (isNativeAppShell()) {
    await saveSessionFileToNativeShareSheet(args);
    return;
  }
  await downloadSessionFileInBrowser(args);
};

export type SessionFilePreviewResult = {
  /** Raw source text of the fetched prefix (always the unmodified bytes). */
  text: string;
  /** True when only a bounded prefix was fetched and more bytes remain. */
  truncated: boolean;
  /** Bytes actually fetched for the preview. */
  fetchedBytes: number;
};

/**
 * Read at most `maxBytes` from a response body, cancelling the stream once the
 * cap is reached so an unbounded (Range-ignoring) response is never fully
 * buffered. Falls back to `arrayBuffer()` only when the body isn't a stream.
 */
const readBoundedBytes = async (response: Response, maxBytes: number): Promise<Uint8Array> => {
  const body = response.body;
  if (!body) {
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer).subarray(0, maxBytes);
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - total;
      const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      chunks.push(slice);
      total += slice.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

/**
 * Fetch a bounded text prefix of a file's preview endpoint via an HTTP Range
 * request (`bytes=0-(N-1)`). The endpoint serves `text/plain`; we decode the
 * returned bytes as UTF-8 and report truncation so the UI can offer a full
 * download. 4xx surfaces as a thrown error the card degrades on.
 */
export const fetchSessionFilePreview = async (
  args: FileFetchArgs & { sizeBytes: number; signal?: AbortSignal }
): Promise<SessionFilePreviewResult> => {
  if (args.source === 'machine') {
    const maxBytes = SESSION_FILE_PREVIEW_FETCH_BYTES;
    const result = await fetchSessionFileChunksFromMachine({
      sessionId: args.sessionId,
      fileId: args.fileId,
      maxTotalBytes: maxBytes,
    });
    const fetchedBytes = result.bytes.byteLength;
    const text = new TextDecoder('utf-8').decode(result.bytes);
    const truncated =
      args.sizeBytes > 0 ? args.sizeBytes > fetchedBytes : fetchedBytes >= maxBytes || !result.eof;
    return { text, truncated, fetchedBytes };
  }
  const { workspaceId, sessionId, fileId, token, sizeBytes, signal } = args;
  const maxBytes = SESSION_FILE_PREVIEW_FETCH_BYTES;
  const response = await fetch(buildSessionFilePreviewUrl(workspaceId, sessionId, fileId), {
    headers: {
      Authorization: `Bearer ${token}`,
      Range: `bytes=0-${maxBytes - 1}`,
    },
    signal,
  });
  // 200 (server ignored Range) and 206 (partial) are both success here.
  if (!response.ok && response.status !== 206) {
    throw new Error(`Preview unavailable (${response.status})`);
  }
  // Bound the read ourselves: if the server ignores Range and returns 200 with
  // the whole (up to 100MB) file, arrayBuffer() would buffer all of it. Read at
  // most maxBytes from the stream, then cancel.
  const bytes = await readBoundedBytes(response, maxBytes);
  const fetchedBytes = bytes.byteLength;
  const text = new TextDecoder('utf-8').decode(bytes);
  // When the total size is known, truncation means we hold fewer bytes than the
  // file has (a file of exactly maxBytes is complete, not truncated). Only when
  // the size is unknown do we infer truncation from hitting the fetch window.
  const truncated = sizeBytes > 0 ? sizeBytes > fetchedBytes : fetchedBytes >= maxBytes;
  return { text, truncated, fetchedBytes };
};
