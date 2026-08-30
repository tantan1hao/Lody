const MAX_RELEASE_MANIFEST_BYTES = 256 * 1024
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u
const SHA512_PATTERN = /^[A-Za-z0-9+/]{86}==$/u

type ReleaseFile = { url: string; size: number; sha512: string }
type ReleaseManifest = {
  version: string
  publishedAt: string
  downloads: { macArm64: ReleaseFile; windowsX64: ReleaseFile }
  notes?: { en?: string; zh_CN?: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertExactKeys(record: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) throw new Error(`${label} contains unknown fields: ${unknown.join(', ')}`)
}

function parseReleaseFile(value: unknown, label: string): ReleaseFile {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  assertExactKeys(value, ['url', 'size', 'sha512'], label)
  const url = typeof value.url === 'string' ? new URL(value.url) : null
  if (!url || url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`${label}.url must use credential-free HTTPS`)
  }
  if (typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size <= 0) {
    throw new Error(`${label}.size must be a positive integer`)
  }
  if (typeof value.sha512 !== 'string' || !SHA512_PATTERN.test(value.sha512)) {
    throw new Error(`${label}.sha512 must be a base64 SHA-512 digest`)
  }
  return { url: url.href, size: value.size, sha512: value.sha512 }
}

function parseReleaseManifest(value: unknown): ReleaseManifest {
  if (!isRecord(value)) throw new Error('Release manifest must be an object')
  assertExactKeys(value, ['version', 'publishedAt', 'downloads', 'notes'], 'Release manifest')
  if (typeof value.version !== 'string' || !VERSION_PATTERN.test(value.version)) {
    throw new Error('Release manifest version is invalid')
  }
  if (
    typeof value.publishedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T/u.test(value.publishedAt) ||
    !Number.isFinite(Date.parse(value.publishedAt))
  ) {
    throw new Error('Release manifest publishedAt is invalid')
  }
  if (!isRecord(value.downloads)) throw new Error('Release manifest downloads is invalid')
  assertExactKeys(value.downloads, ['macArm64', 'windowsX64'], 'Release downloads')
  let notes: ReleaseManifest['notes']
  if (value.notes !== undefined) {
    if (!isRecord(value.notes)) throw new Error('Release notes must be an object')
    assertExactKeys(value.notes, ['en', 'zh_CN'], 'Release notes')
    notes = {}
    for (const locale of ['en', 'zh_CN'] as const) {
      const note = value.notes[locale]
      if (note === undefined) continue
      if (typeof note !== 'string' || note.length > 64 * 1024) {
        throw new Error(`Release note ${locale} is invalid`)
      }
      notes[locale] = note
    }
  }
  return {
    version: value.version,
    publishedAt: value.publishedAt,
    downloads: {
      macArm64: parseReleaseFile(value.downloads.macArm64, 'downloads.macArm64'),
      windowsX64: parseReleaseFile(value.downloads.windowsX64, 'downloads.windowsX64')
    },
    ...(notes ? { notes } : {})
  }
}

type ParsedVersion = {
  core: [number, number, number]
  prerelease: string[]
}

function parseVersion(version: string): ParsedVersion {
  const [coreText, prereleaseText] = version.trim().replace(/^v/u, '').split('-', 2)
  const coreParts = coreText?.split('.').map((part) => Number(part)) ?? []
  if (coreParts.length !== 3 || coreParts.some((part) => !Number.isSafeInteger(part) || part < 0)) {
    throw new Error(`Invalid release version: ${version}`)
  }
  return {
    core: coreParts as [number, number, number],
    prerelease: prereleaseText ? prereleaseText.split('.') : []
  }
}

export function compareReleaseVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < a.core.length; index += 1) {
    const difference = a.core[index] - b.core[index]
    if (difference !== 0) return Math.sign(difference)
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1
  }
  const count = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < count; index += 1) {
    const aPart = a.prerelease[index]
    const bPart = b.prerelease[index]
    if (aPart === undefined || bPart === undefined) return aPart === undefined ? -1 : 1
    if (aPart === bPart) continue
    const aNumber = /^\d+$/u.test(aPart) ? Number(aPart) : null
    const bNumber = /^\d+$/u.test(bPart) ? Number(bPart) : null
    if (aNumber !== null && bNumber !== null) return Math.sign(aNumber - bNumber)
    if (aNumber !== null || bNumber !== null) return aNumber !== null ? -1 : 1
    return aPart.localeCompare(bPart)
  }
  return 0
}

export async function readMacReleaseManifest(options: {
  manifestUrl: string
  currentVersion: string
  fetchImpl?: typeof fetch
}): Promise<
  | { available: false; publishedAt: string }
  | {
      available: true
      version: string
      publishedAt: string
      downloadUrl: string
      notes?: { en?: string; zh_CN?: string }
    }
> {
  const endpoint = new URL(options.manifestUrl)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new Error('Release manifest URL must use credential-free HTTPS')
  }
  const response = await (options.fetchImpl ?? fetch)(endpoint, {
    cache: 'no-store',
    credentials: 'omit',
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) throw new Error(`Release manifest returned HTTP ${response.status}`)
  const raw = await response.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_RELEASE_MANIFEST_BYTES) {
    throw new Error('Release manifest is too large')
  }
  const manifest = parseReleaseManifest(JSON.parse(raw))
  if (compareReleaseVersions(manifest.version, options.currentVersion) <= 0) {
    return { available: false, publishedAt: manifest.publishedAt }
  }
  return {
    available: true,
    version: manifest.version,
    publishedAt: manifest.publishedAt,
    downloadUrl: manifest.downloads.macArm64.url,
    ...(manifest.notes ? { notes: manifest.notes } : {})
  }
}
