import assert from 'node:assert/strict'
import test from 'node:test'
import { compareReleaseVersions, readMacReleaseManifest } from './app-updater-manifest.ts'

void test('compares stable and prerelease versions', () => {
  assert.equal(compareReleaseVersions('0.89.0', '0.88.9'), 1)
  assert.equal(compareReleaseVersions('0.89.0', '0.89.0'), 0)
  assert.equal(compareReleaseVersions('0.89.0-beta.2', '0.89.0-beta.1'), 1)
  assert.equal(compareReleaseVersions('0.89.0', '0.89.0-beta.2'), 1)
})

void test('validates the manifest and returns the arm64 DMG only for a newer release', async () => {
  const manifest = {
    version: '0.89.0',
    publishedAt: '2026-08-30T00:00:00.000Z',
    downloads: {
      macArm64: {
        url: 'https://updates.example.test/LodyOSS-0.89.0-arm64.dmg',
        size: 123,
        sha512: `${'A'.repeat(86)}==`
      },
      windowsX64: {
        url: 'https://updates.example.test/LodyOSS-0.89.0-x64-setup.exe',
        size: 456,
        sha512: `${'B'.repeat(86)}==`
      }
    },
    notes: { zh_CN: '更新内容' }
  }
  const fetchImpl = async () => new Response(JSON.stringify(manifest), { status: 200 })

  assert.deepEqual(
    await readMacReleaseManifest({
      manifestUrl: 'https://updates.example.test/release.json',
      currentVersion: '0.88.0',
      fetchImpl
    }),
    {
      available: true,
      version: '0.89.0',
      publishedAt: manifest.publishedAt,
      downloadUrl: manifest.downloads.macArm64.url,
      notes: manifest.notes
    }
  )
  assert.deepEqual(
    await readMacReleaseManifest({
      manifestUrl: 'https://updates.example.test/release.json',
      currentVersion: '0.89.0',
      fetchImpl
    }),
    { available: false, publishedAt: manifest.publishedAt }
  )
})
