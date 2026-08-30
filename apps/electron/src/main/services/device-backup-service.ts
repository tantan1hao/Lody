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

const BACKUP_TIMEOUT_MS = 90_000
const MAX_COMMAND_OUTPUT = 16 * 1024
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
  | { status: 'completed' }
  | { status: 'failed'; error: string }

function appendBounded(current: string, chunk: Buffer): string {
  const next = `${current}${chunk.toString('utf8')}`
  return next.length <= MAX_COMMAND_OUTPUT ? next : next.slice(-MAX_COMMAND_OUTPUT)
}

export class DeviceBackupService {
  private readonly options: { enabled: boolean; timeoutMs?: number }

  constructor(options: { enabled: boolean; timeoutMs?: number }) {
    this.options = options
  }

  async backupAfterCliShutdown(): Promise<DeviceBackupResult> {
    if (!this.options.enabled) return { status: 'skipped', reason: 'disabled' }
    if (!existsSync(BACKUP_CONFIG_PATH)) return { status: 'skipped', reason: 'not_configured' }

    let config: DeviceBackupConfig
    try {
      config = parseDeviceBackupConfig(JSON.parse(readFileSync(BACKUP_CONFIG_PATH, 'utf8')))
    } catch (error) {
      return await this.fail(null, `Invalid backup config: ${formatUnknownError(error)}`)
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
    const args = buildResticBackupArgs({
      config,
      machineId: machineId || 'unknown-machine',
      host: hostname(),
      statePaths
    })

    try {
      await this.run(config.resticPath, args)
      console.info('[DeviceBackup] Restic backup completed', {
        machineId,
        itemCount: statePaths.length
      })
      return { status: 'completed' }
    } catch (error) {
      return await this.fail(config, formatUnknownError(error))
    }
  }

  private async run(command: string, args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      let output = ''
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(
          new Error(
            `Restic backup timed out after ${this.options.timeoutMs ?? BACKUP_TIMEOUT_MS}ms`
          )
        )
      }, this.options.timeoutMs ?? BACKUP_TIMEOUT_MS)
      child.stdout?.on('data', (chunk: Buffer) => {
        output = appendBounded(output, chunk)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        output = appendBounded(output, chunk)
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(`Restic exited with code ${code ?? 'unknown'}: ${output.trim()}`))
      })
    })
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
          body: `${hostname()} · backup failed`
        })
      } catch {
        // The original backup error remains the actionable failure.
      }
    }
    return { status: 'failed', error }
  }
}
