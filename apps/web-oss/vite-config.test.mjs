import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

void test('web OSS build is pinned to the self-hosted platform without official endpoints', async () => {
  const source = await readFile(new URL('./vite.config.ts', import.meta.url), 'utf8');
  assert.match(source, /VITE_LODY_PLATFORM[^\n]+self-hosted/);
  assert.doesNotMatch(source, /lody\.ai|api\.lody/);
});
