import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveUpdatePublish, shouldEmbedWindowsUpdateFeed } from './package-electron.mjs'

test('generic update feed is optional and HTTPS-only', () => {
  assert.equal(resolveUpdatePublish(''), undefined)
  assert.deepEqual(resolveUpdatePublish('https://updates.example.com/lody-oss'), [
    { provider: 'generic', url: 'https://updates.example.com/lody-oss' }
  ])

  for (const value of [
    'not-a-url',
    'http://updates.example.com/lody-oss',
    'https://user:pass@updates.example.com/lody-oss',
    'https://updates.example.com/lody-oss?channel=latest',
    'https://updates.example.com/lody-oss#latest'
  ]) {
    assert.throws(() => resolveUpdatePublish(value), /LODY_OSS_UPDATE_URL/u)
  }
})

test('only Windows packages embed the generic updater feed', () => {
  assert.equal(shouldEmbedWindowsUpdateFeed(['--win', '--x64'], 'linux'), true)
  assert.equal(shouldEmbedWindowsUpdateFeed(['--mac', '--arm64'], 'darwin'), false)
  assert.equal(shouldEmbedWindowsUpdateFeed([], 'win32'), true)
  assert.equal(shouldEmbedWindowsUpdateFeed([], 'darwin'), false)
})
