import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

function parseArguments(argv) {
  const values = new Map(
    argv.map((argument) => {
      const separator = argument.indexOf('=');
      return separator === -1
        ? [argument, '']
        : [argument.slice(0, separator), argument.slice(separator + 1)];
    })
  );
  const directory = values.get('--dir');
  const version = values.get('--version')?.replace(/^v/u, '');
  const baseUrl = values.get('--base-url');
  if (!directory || !version || !baseUrl || !VERSION_PATTERN.test(version)) {
    throw new Error(
      'Usage: node scripts/build-lody-oss-release-manifest.mjs --dir=<dir> --version=<semver> --base-url=<https-url>'
    );
  }
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('--base-url must be a credential-free HTTPS URL');
  }
  return { directory: path.resolve(directory), version, baseUrl: url.href };
}

async function sha512Base64(filePath) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('base64');
}

async function describeFile(directory, fileName, baseUrl) {
  const filePath = path.join(directory, fileName);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size <= 0) throw new Error(`${fileName} is empty or missing`);
  return {
    url: new URL(encodeURIComponent(fileName), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
      .href,
    size: fileStat.size,
    sha512: await sha512Base64(filePath),
  };
}

export async function buildReleaseManifest(options) {
  const names = await readdir(options.directory);
  const macFile = `LodyOSS-${options.version}-arm64.dmg`;
  const windowsFile = `LodyOSS-${options.version}-x64-setup.exe`;
  const required = [macFile, windowsFile, `${windowsFile}.blockmap`, 'latest.yml'];
  for (const fileName of required) {
    if (!names.includes(fileName)) throw new Error(`Missing release artifact: ${fileName}`);
  }
  if (names.some((name) => name === 'latest-mac.yml' || name.endsWith('.zip'))) {
    throw new Error('Unsigned macOS releases must not include latest-mac.yml or ZIP artifacts');
  }
  return {
    version: options.version,
    publishedAt: new Date().toISOString(),
    downloads: {
      macArm64: await describeFile(options.directory, macFile, options.baseUrl),
      windowsX64: await describeFile(options.directory, windowsFile, options.baseUrl),
    },
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifest = await buildReleaseManifest(options);
  await writeFile(
    path.join(options.directory, 'release.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  await main();
}
