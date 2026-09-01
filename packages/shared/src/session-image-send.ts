import { z } from 'zod';
import { SESSION_IMAGE_ALLOWED_MIME_TYPES, SESSION_IMAGE_MAX_SIZE_BYTES } from './ai';
import { SessionIdSchema, SessionImagePayloadSchema } from './message-schemas';

/**
 * Put a composer image onto the execution machine so the agent can see it.
 *
 * Official cloud uploads go to `/api/workspaces/.../session-images/upload`.
 * Local and self-hosted have no such service; the web album path therefore
 * sends the bytes to the session's machine over Machine RPC. The daemon stores
 * them in the local image blob store and returns a normal `SessionImagePayload`.
 * New-chat drafts may send before the session document exists; the bytes are
 * keyed by that draft id so later create/prepare can see them.
 */
export const SESSION_IMAGE_SEND_METHOD = 'session/image-send' as const;

/** Base64 of a 5 MiB image is ~6.7 MiB; keep a little headroom for padding. */
export const SESSION_IMAGE_SEND_MAX_DATA_CHARS = 8 * 1024 * 1024;

export const SessionImageSendRequestSchema = z
  .object({
    sessionId: SessionIdSchema,
    fileName: z.string().trim().min(1).max(240),
    mimeType: z.enum(SESSION_IMAGE_ALLOWED_MIME_TYPES),
    data: z.string().min(1).max(SESSION_IMAGE_SEND_MAX_DATA_CHARS),
  })
  .strict();
export type SessionImageSendRequest = z.infer<typeof SessionImageSendRequestSchema>;

export const SESSION_IMAGE_SEND_ERROR_CODES = [
  'invalid_file',
  'too_large',
  'unsupported_type',
  'session_not_found',
  'session_archived',
  'transient_io',
] as const;
export type SessionImageSendErrorCode = (typeof SESSION_IMAGE_SEND_ERROR_CODES)[number];

export const SessionImageSendErrorCodeSchema = z.enum(SESSION_IMAGE_SEND_ERROR_CODES);

export const SessionImageSendOkSchema = z
  .object({
    status: z.literal('ok'),
    image: SessionImagePayloadSchema,
  })
  .strict();

export const SessionImageSendErrorSchema = z
  .object({
    status: z.literal('error'),
    code: SessionImageSendErrorCodeSchema,
    message: z.string().trim().min(1),
    retryable: z.boolean().optional(),
  })
  .strict();

export const SessionImageSendResponseSchema = z.discriminatedUnion('status', [
  SessionImageSendOkSchema,
  SessionImageSendErrorSchema,
]);
export type SessionImageSendOk = z.infer<typeof SessionImageSendOkSchema>;
export type SessionImageSendError = z.infer<typeof SessionImageSendErrorSchema>;
export type SessionImageSendResponse = z.infer<typeof SessionImageSendResponseSchema>;

export function sessionImageSendError(
  code: SessionImageSendErrorCode,
  args: { message: string; retryable?: boolean }
): SessionImageSendError {
  return {
    status: 'error',
    code,
    message: args.message,
    ...(args.retryable === undefined ? {} : { retryable: args.retryable }),
  };
}

export const SESSION_IMAGE_MAX_UPLOAD_BYTES = SESSION_IMAGE_MAX_SIZE_BYTES;
