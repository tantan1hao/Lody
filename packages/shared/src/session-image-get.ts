import { z } from 'zod';
import { SESSION_IMAGE_ALLOWED_MIME_TYPES } from './ai';
import { SessionIdSchema, SessionImagePayloadSchema } from './message-schemas';
import { SESSION_IMAGE_SEND_MAX_DATA_CHARS } from './session-image-send';

/**
 * Read a session image that already lives on the execution machine.
 *
 * Official downloads go to `/api/workspaces/.../session-images/...`.
 * Local and self-hosted have no such service; the transcript therefore
 * fetches the bytes over Machine RPC from the local image blob store.
 */
export const SESSION_IMAGE_GET_METHOD = 'session/image-get' as const;

export const SessionImageGetRequestSchema = z
  .object({
    sessionId: SessionIdSchema,
    imageId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._-]+$/, 'Invalid imageId'),
  })
  .strict();
export type SessionImageGetRequest = z.infer<typeof SessionImageGetRequestSchema>;

export const SESSION_IMAGE_GET_ERROR_CODES = [
  'not_found',
  'session_not_found',
  'session_archived',
  'unsupported_type',
  'transient_io',
] as const;
export type SessionImageGetErrorCode = (typeof SESSION_IMAGE_GET_ERROR_CODES)[number];

export const SessionImageGetErrorCodeSchema = z.enum(SESSION_IMAGE_GET_ERROR_CODES);

export const SessionImageGetOkSchema = z
  .object({
    status: z.literal('ok'),
    image: SessionImagePayloadSchema,
    mimeType: z.enum(SESSION_IMAGE_ALLOWED_MIME_TYPES),
    data: z.string().min(1).max(SESSION_IMAGE_SEND_MAX_DATA_CHARS),
  })
  .strict();

export const SessionImageGetErrorSchema = z
  .object({
    status: z.literal('error'),
    code: SessionImageGetErrorCodeSchema,
    message: z.string().trim().min(1),
    retryable: z.boolean().optional(),
  })
  .strict();

export const SessionImageGetResponseSchema = z.discriminatedUnion('status', [
  SessionImageGetOkSchema,
  SessionImageGetErrorSchema,
]);
export type SessionImageGetOk = z.infer<typeof SessionImageGetOkSchema>;
export type SessionImageGetError = z.infer<typeof SessionImageGetErrorSchema>;
export type SessionImageGetResponse = z.infer<typeof SessionImageGetResponseSchema>;

export function sessionImageGetError(
  code: SessionImageGetErrorCode,
  args: { message: string; retryable?: boolean }
): SessionImageGetError {
  return {
    status: 'error',
    code,
    message: args.message,
    ...(args.retryable === undefined ? {} : { retryable: args.retryable }),
  };
}
