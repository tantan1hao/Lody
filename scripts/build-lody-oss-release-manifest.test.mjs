import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildReleaseManifest } from './build-lody-oss-release-manifest.mjs';

void test('builds the two-platform release manifest and rejects Squirrel Mac metadata', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lody-release-manifest-'));
  try {
    const version = '0.89.0';
    for (const [name, body] of [
      [`LodyOSS-${version}-arm64.dmg`, 'dmg'],
      [`LodyOSS-${version}-x64-setup.exe`, 'exe'],
      [`LodyOSS-${version}-x64-setup.exe.blockmap`, 'blockmap'],
      ['latest.yml', 'version: 0.89.0'],
    ]) {
      await writeFile(path.join(directory, name), body);
    }
    const manifest = await buildReleaseManifest({
      directory,
      version,
      baseUrl: 'https://updates.example.test/lody-oss/',
    });
    assert.equal(manifest.version, version);
    assert.match(manifest.downloads.macArm64.url, /arm64\.dmg$/u);
    assert.match(manifest.downloads.windowsX64.sha512, /^[A-Za-z0-9+/]{86}==$/u);

    await writeFile(path.join(directory, 'latest-mac.yml'), 'forbidden');
    await assert.rejects(
      buildReleaseManifest({
        directory,
        version,
        baseUrl: 'https://updates.example.test/lody-oss/',
      }),
      /must not include/u
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
