import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadSelfHostedConfig,
  resolveSelfHostedControlOrigin,
  type SelfHostedConfig,
} from '@lody/platform';
import { getLodyDataDir } from '@lody/shared/node/installation-profile';
import type { Logger } from '@/utils/logger';

const SELF_HOSTED_CONFIG_FILE = 'self-hosted-config.json';

export function getCliSelfHostedConfigPath(): string {
  return path.join(getLodyDataDir('self-hosted'), SELF_HOSTED_CONFIG_FILE);
}

async function persistConfig(filePath: string, raw: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${raw}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
  if (process.platform !== 'win32') await fs.chmod(filePath, 0o600);
}

export async function loadCliSelfHostedConfig(
  logger: Logger,
  options: {
    controlOrigin?: string;
    filePath?: string;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<SelfHostedConfig> {
  const controlOrigin = resolveSelfHostedControlOrigin(
    options.controlOrigin ?? process.env.LODY_OSS_CONTROL_URL
  );
  const filePath = options.filePath ?? getCliSelfHostedConfigPath();
  let cachedRaw: string | null = null;
  try {
    cachedRaw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(`[platform] Could not read cached self-hosted config: ${String(error)}`);
    }
  }
  let networkRaw: string | null = null;
  const loaded = await loadSelfHostedConfig({
    controlOrigin,
    fetchImpl: options.fetchImpl,
    storage: {
      getItem: () => cachedRaw,
      setItem: (_key, value) => {
        networkRaw = value;
      },
    },
  });
  if (networkRaw) await persistConfig(filePath, networkRaw);
  logger.info(
    `[platform] Loaded self-hosted config from ${loaded.source}; workspace=${loaded.config.workspace.id}`
  );
  return loaded.config;
}
