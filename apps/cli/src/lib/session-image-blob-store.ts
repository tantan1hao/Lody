import os from 'os';
import fs from 'fs';
import path from 'path';
import { getLodyDataDir } from '@lody/shared/node/installation-profile';

/**
 * Local blob store for composer images that never go through official cloud
 * `/session-images/upload`. Layout:
 * `<data>/session-images/<workspaceId>/<sessionId>/<imageId>`
 * plus `<imageId>.meta.json` for mime/fileName/size.
 */

const SESSION_IMAGES_DIR_NAME = 'session-images';

export type SessionImageBlobRecord = {
  bytes: Buffer;
  mimeType: string;
  fileName?: string;
  sizeBytes: number;
};

type SessionImageBlobMeta = {
  mimeType: string;
  fileName?: string;
  sizeBytes: number;
};

const isSafeId = (value: string): boolean =>
  value.length > 0 &&
  !value.includes('/') &&
  !value.includes('\\') &&
  value !== '.' &&
  value !== '..';

export const getSessionImagesRoot = (homeDir: string = os.homedir()): string =>
  path.join(getLodyDataDir(undefined, homeDir), SESSION_IMAGES_DIR_NAME);

export const getSessionImageBlobDir = (args: {
  workspaceId: string;
  sessionId: string;
  homeDir?: string;
}): string => {
  if (!isSafeId(args.workspaceId) || !isSafeId(args.sessionId)) {
    throw new Error('Invalid workspaceId or sessionId for image blob store');
  }
  return path.join(getSessionImagesRoot(args.homeDir), args.workspaceId, args.sessionId);
};

export const getSessionImageBlobPath = (args: {
  workspaceId: string;
  sessionId: string;
  imageId: string;
  homeDir?: string;
}): string => {
  if (!isSafeId(args.imageId)) {
    throw new Error('Invalid imageId for image blob store');
  }
  return path.join(getSessionImageBlobDir(args), args.imageId);
};

const getSessionImageBlobMetaPath = (args: {
  workspaceId: string;
  sessionId: string;
  imageId: string;
  homeDir?: string;
}): string => `${getSessionImageBlobPath(args)}.meta.json`;

const mkdirPrivate = async (dir: string): Promise<void> => {
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(dir, 0o700).catch(() => undefined);
};

const parseMeta = (raw: string): SessionImageBlobMeta | null => {
  try {
    const parsed = JSON.parse(raw) as Partial<SessionImageBlobMeta>;
    if (typeof parsed.mimeType !== 'string' || parsed.mimeType.trim().length === 0) {
      return null;
    }
    if (typeof parsed.sizeBytes !== 'number' || !Number.isFinite(parsed.sizeBytes)) {
      return null;
    }
    return {
      mimeType: parsed.mimeType,
      sizeBytes: parsed.sizeBytes,
      ...(typeof parsed.fileName === 'string' && parsed.fileName.trim()
        ? { fileName: parsed.fileName }
        : {}),
    };
  } catch {
    return null;
  }
};

export const writeSessionImageBlob = async (args: {
  workspaceId: string;
  sessionId: string;
  imageId: string;
  bytes: Buffer;
  mimeType: string;
  fileName?: string;
  homeDir?: string;
}): Promise<void> => {
  const dir = getSessionImageBlobDir(args);
  await mkdirPrivate(getSessionImagesRoot(args.homeDir));
  await mkdirPrivate(dir);
  const destPath = getSessionImageBlobPath(args);
  const metaPath = getSessionImageBlobMetaPath(args);
  const tempPath = `${destPath}.${process.pid}.part`;
  const tempMetaPath = `${metaPath}.${process.pid}.part`;
  const meta: SessionImageBlobMeta = {
    mimeType: args.mimeType,
    sizeBytes: args.bytes.byteLength,
    ...(args.fileName ? { fileName: args.fileName } : {}),
  };
  try {
    await fs.promises.writeFile(tempPath, args.bytes, { flag: 'wx', mode: 0o600 });
    await fs.promises.writeFile(tempMetaPath, `${JSON.stringify(meta)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    await fs.promises.rename(tempPath, destPath);
    await fs.promises.rename(tempMetaPath, metaPath);
  } catch (error) {
    await fs.promises.unlink(tempPath).catch(() => undefined);
    await fs.promises.unlink(tempMetaPath).catch(() => undefined);
    throw error;
  }
};

export const readSessionImageBlob = async (args: {
  workspaceId: string;
  sessionId: string;
  imageId: string;
  homeDir?: string;
}): Promise<SessionImageBlobRecord | null> => {
  try {
    const destPath = getSessionImageBlobPath(args);
    const metaPath = getSessionImageBlobMetaPath(args);
    const [bytes, metaRaw] = await Promise.all([
      fs.promises.readFile(destPath),
      fs.promises.readFile(metaPath, 'utf8'),
    ]);
    const meta = parseMeta(metaRaw);
    if (!meta) {
      return null;
    }
    return {
      bytes,
      mimeType: meta.mimeType,
      sizeBytes: bytes.byteLength,
      ...(meta.fileName ? { fileName: meta.fileName } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
};
