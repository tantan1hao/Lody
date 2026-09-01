import { z } from 'zod';
import { SESSION_FILE_MAX_SIZE_BYTES } from './ai';
import { SessionIdSchema } from './message-schemas';

/**
 * Read a session file that already lives on the execution machine.
 *
 * Official downloads go to `/api/workspaces/.../session-files/...`.
 * Local and self-hosted have no such service; the transcript therefore
 * fetches bytes over Machine RPC from the local file blob store.
 *
 * One response stays inside the proven File Preview binary budget (~5 MiB
 * base64). Callers assemble a full download by walking `offset` until `eof`.
 */
export const SESSION_FILE_GET_METHOD = 'session/file-get' as const;

/** Raw bytes per chunk. Base64 of 3 MiB stays under the 5 MiB preview budget. */
export const SESSION_FILE_GET_MAX_CHUNK_BYTES = 3 * 1024 * 1024;

/** Base64 of a 3 MiB chunk is 4 MiB; keep a little headroom for padding. */
export const SESSION_FILE_GET_MAX_DATA_CHARS = 4 * 1024 * 1024;

export const SessionFileGetRequestSchema = z
  .object({
    sessionId: SessionIdSchema,
    fileId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._-]+$/, 'Invalid fileId'),
    offset: z.number().int().nonnegative().max(SESSION_FILE_MAX_SIZE_BYTES).optional(),
    maxBytes: z.number().int().positive().max(SESSION_FILE_GET_MAX_CHUNK_BYTES).optional(),
  })
  .strict();
export type SessionFileGetRequest = z.infer<typeof SessionFileGetRequestSchema>;

export const SESSION_FILE_GET_ERROR_CODES = [
  'not_found',
  'session_not_found',
  'unsupported_type',
  'transient_io',
] as const;
export type SessionFileGetErrorCode = (typeof SESSION_FILE_GET_ERROR_CODES)[number];

export const SessionFileGetErrorCodeSchema = z.enum(SESSION_FILE_GET_ERROR_CODES);

export const SessionFileGetOkSchema = z
  .object({
    status: z.literal('ok'),
    fileId: z.string().trim().min(1),
    mimeType: z.string().trim().min(1),
    fileName: z.string().trim().min(1).optional(),
    sizeBytes: z.number().int().nonnegative().max(SESSION_FILE_MAX_SIZE_BYTES),
    offset: z.number().int().nonnegative().max(SESSION_FILE_MAX_SIZE_BYTES),
    byteLength: z.number().int().nonnegative().max(SESSION_FILE_GET_MAX_CHUNK_BYTES),
    eof: z.boolean(),
    data: z.string().max(SESSION_FILE_GET_MAX_DATA_CHARS),
  })
  .strict();

export const SessionFileGetErrorSchema = z
  .object({
    status: z.literal('error'),
    code: SessionFileGetErrorCodeSchema,
    message: z.string().trim().min(1),
    retryable: z.boolean().optional(),
  })
  .strict();

export const SessionFileGetResponseSchema = z.discriminatedUnion('status', [
  SessionFileGetOkSchema,
  SessionFileGetErrorSchema,
]);
export type SessionFileGetOk = z.infer<typeof SessionFileGetOkSchema>;
export type SessionFileGetError = z.infer<typeof SessionFileGetErrorSchema>;
export type SessionFileGetResponse = z.infer<typeof SessionFileGetResponseSchema>;

export function sessionFileGetError(
  code: SessionFileGetErrorCode,
  args: { message: string; retryable?: boolean }
): SessionFileGetError {
  return {
    status: 'error',
    code,
    message: args.message,
    ...(args.retryable === undefined ? {} : { retryable: args.retryable }),
  };
}
