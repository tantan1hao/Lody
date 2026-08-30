import type { JsonObject, RemoteCursorStore } from '@loro-dev/streams-crdt';
import {
  CODE_COLLAB_FILE_INDEX_FLOCK_TTL_MS,
  getLoroMetaStreamId,
  getLoroStreamIdForDocId,
  getLoroStreamsShardUrls,
  isCodeCollabFileIndexFlockDocId,
  isCodeCollabFileIndexSignalFlockDocId,
  LORO_STREAMS_BUCKET_ID,
  streamsSnapshotCodec,
  type WorkspaceId,
} from '@lody/shared';
import { StreamsTransportAdapter } from 'loro-repo/transport/streams';
import type { Logger } from '@/utils/logger';
import type { LoroStreamsTokenProvider } from '@lody/platform';
import { getCliPlatformKind } from '@/lib/cli-platform';
import { prepareCliStreamsGatewayBaseUrl } from './streams-access';
import { readTimeoutEnv } from './timeout-utils';

export type CliStreamsTransport = {
  adapter: StreamsTransportAdapter;
  gatewayBaseUrl: string;
  tokenProvider: LoroStreamsTokenProvider;
};

export async function createCliStreamsTransport(args: {
  workspaceId: WorkspaceId;
  tokenProvider: LoroStreamsTokenProvider;
  remoteCursorStore: RemoteCursorStore<JsonObject>;
  logger: Logger;
  onPersistDoc: () => Promise<void>;
  onPersistMeta: () => Promise<void>;
  onPersistFlockDoc: () => Promise<void>;
}): Promise<CliStreamsTransport> {
  const tokenProvider = args.tokenProvider;
  const gatewayBaseUrl = await prepareCliStreamsGatewayBaseUrl(tokenProvider);

  return {
    gatewayBaseUrl,
    tokenProvider,
    adapter: new StreamsTransportAdapter({
      bucketId: LORO_STREAMS_BUCKET_ID,
      metaStreamId: getLoroMetaStreamId(args.workspaceId),
      docStreamId: (docId) => getLoroStreamIdForDocId(args.workspaceId, docId),
      flockDocStreamId: (flockDocId) => flockDocId,
      flockDocStreamTtlMs: (flockDocId) =>
        isCodeCollabFileIndexFlockDocId(flockDocId) ||
        isCodeCollabFileIndexSignalFlockDocId(flockDocId)
          ? CODE_COLLAB_FILE_INDEX_FLOCK_TTL_MS
          : undefined,
      auth: tokenProvider.createAuthCallback(),
      remoteCursorStore: args.remoteCursorStore,
      snapshotCodec: streamsSnapshotCodec,
      baseUrl: gatewayBaseUrl,
      shardUrls: getLoroStreamsShardUrls(gatewayBaseUrl, tokenProvider.getShardHostSuffix()),
      reconnectConfig:
        getCliPlatformKind() === 'self-hosted'
          ? {
              connectTimeoutMs: readTimeoutEnv(
                'LODY_LORO_STREAMS_CONNECT_TIMEOUT_MS',
                120_000
              ),
            }
          : undefined,
      snapshotUpload: {
        canUpload: async () => true,
        debounceMs: 5_000,
      },
      onPersistDoc: args.onPersistDoc,
      onPersistMeta: args.onPersistMeta,
      onPersistFlockDoc: args.onPersistFlockDoc,
    }),
  };
}
