import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { getLodyDataDir } from '@lody/shared/node/installation-profile'
import { mainPlatformKind } from '../platform'
import { formatUnknownError } from '../utils'
import {
  buildResticBackupArgs,
  parseDeviceBackupConfig,
  type DeviceBackupConfig
} from './device-backup-core'
import { spawnDetachedBackupProcess, waitForBackupProcess } from './device-backup-process'

const BACKUP_TIMEOUT_MS = 90_000
const NTFY_NOTIFY_TIMEOUT_MS = 2_000
const BACKUP_CONFIG_PATH = join(getLodyDataDir(mainPlatformKind), 'backup-config.json')
const BACKUP_STATE_ITEMS = [
  'workspace-catalog.json',
  'local-identity.json',
  'machine-id',
  'loro-repo',
  'chats',
  'orchestration',
  'session-files',
  'electron-settings.json'
] as const

export type DeviceBackupResult =
  | { status: 'skipped'; reason: 'disabled' | 'not_configured' | 'no_state' }
  | { status: 'started' }
  | { status: 'completed' }
  | { status: 'failed'; error: string }

type PreparedBackup = {
  config: DeviceBackupConfig
  command: string
  args: string[]
  machineId: string
  itemCount: number
}

export class DeviceBackupService {
  private readonly options: { enabled: boolean; timeoutMs?: number }

  constructor(options: { enabled: boolean; timeoutMs?: number }) {
    this.options = options
  }

  /**
   * Start the post-CLI snapshot without waiting. Quit must not sit behind
   * restic/SFTP of a large `loro-repo`.
   */
  startDetachedBackupAfterCliShutdown(): DeviceBackupResult {
    const prepared = this.prepare()
    if (!('command' in prepared)) return prepared
    try {
      spawnDetachedBackupProcess(prepared.command, prepared.args)
      console.info('[DeviceBackup] Detached restic backup started', {
        machineId: prepared.machineId,
        itemCount: prepared.itemCount
      })
      return { status: 'started' }
    } catch (error) {
      console.error('[DeviceBackup] Failed to start detached backup', formatUnknownError(error))
      return { status: 'failed', error: formatUnknownError(error) }
    }
  }

  async backupAfterCliShutdown(): Promise<DeviceBackupResult> {
    const prepared = this.prepare()
    if (!('command' in prepared)) {
      if (prepared.status === 'failed') return await this.fail(null, prepared.error)
      return prepared
    }

    try {
      const child = spawn(prepared.command, prepared.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
      await waitForBackupProcess(child, this.options.timeoutMs ?? BACKUP_TIMEOUT_MS)
      console.info('[DeviceBackup] Restic backup completed', {
        machineId: prepared.machineId,
        itemCount: prepared.itemCount
      })
      return { status: 'completed' }
    } catch (error) {
      return await this.fail(prepared.config, formatUnknownError(error))
    }
  }

  private prepare(): PreparedBackup | DeviceBackupResult {
    if (!this.options.enabled) return { status: 'skipped', reason: 'disabled' }
    if (!existsSync(BACKUP_CONFIG_PATH)) return { status: 'skipped', reason: 'not_configured' }

    let config: DeviceBackupConfig
    try {
      config = parseDeviceBackupConfig(JSON.parse(readFileSync(BACKUP_CONFIG_PATH, 'utf8')))
    } catch (error) {
      return { status: 'failed', error: `Invalid backup config: ${formatUnknownError(error)}` }
    }

    const dataDir = getLodyDataDir(mainPlatformKind)
    const statePaths = BACKUP_STATE_ITEMS.map((item) => join(dataDir, item)).filter((item) =>
      existsSync(item)
    )
    if (statePaths.length === 0) return { status: 'skipped', reason: 'no_state' }
    const machineIdPath = join(dataDir, 'machine-id')
    const machineId = existsSync(machineIdPath)
      ? readFileSync(machineIdPath, 'utf8').trim()
      : 'unknown-machine'
    return {
      config,
      command: config.resticPath,
      args: buildResticBackupArgs({
        config,
        machineId: machineId || 'unknown-machine',
        host: hostname(),
        statePaths
      }),
      machineId: machineId || 'unknown-machine',
      itemCount: statePaths.length
    }
  }

  private async fail(
    config: DeviceBackupConfig | null,
    error: string
  ): Promise<DeviceBackupResult> {
    console.error('[DeviceBackup] Backup failed', error)
    if (config?.ntfyUrl) {
      try {
        await fetch(config.ntfyUrl, {
          method: 'POST',
          headers: { Title: 'Lody OSS', Tags: 'warning' },
          body: `${hostname()} · backup failed`,
          signal: AbortSignal.timeout(NTFY_NOTIFY_TIMEOUT_MS)
        })
      } catch {
        // The original backup error remains the actionable failure.
      }
    }
    return { status: 'failed', error }
  }
}
