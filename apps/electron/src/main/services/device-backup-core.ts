import { isAbsolute } from 'node:path'

export type DeviceBackupConfig = {
  version: 1
  repository: string
  resticPath: string
  passwordCommand: string
  sftpCommand?: string
  ntfyUrl?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseDeviceBackupConfig(value: unknown): DeviceBackupConfig {
  if (!isRecord(value) || value.version !== 1) throw new Error('Unsupported backup config')
  const repository = typeof value.repository === 'string' ? value.repository.trim() : ''
  const resticPath = typeof value.resticPath === 'string' ? value.resticPath.trim() : ''
  const passwordCommand =
    typeof value.passwordCommand === 'string' ? value.passwordCommand.trim() : ''
  if (!repository || !resticPath || !isAbsolute(resticPath) || !passwordCommand) {
    throw new Error('Backup config requires repository, absolute resticPath, and passwordCommand')
  }
  const sftpCommand = typeof value.sftpCommand === 'string' ? value.sftpCommand.trim() : ''
  const ntfyUrl = typeof value.ntfyUrl === 'string' ? value.ntfyUrl.trim() : ''
  if (ntfyUrl) {
    const parsedUrl = new URL(ntfyUrl)
    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
      throw new Error('Backup ntfyUrl must use credential-free HTTPS')
    }
  }
  return {
    version: 1,
    repository,
    resticPath,
    passwordCommand,
    ...(sftpCommand ? { sftpCommand } : {}),
    ...(ntfyUrl ? { ntfyUrl } : {})
  }
}

export function buildResticBackupArgs(options: {
  config: DeviceBackupConfig
  machineId: string
  host: string
  statePaths: string[]
}): string[] {
  const args = [
    '-r',
    options.config.repository,
    '--password-command',
    options.config.passwordCommand
  ]
  if (options.config.sftpCommand) args.push('-o', `sftp.command=${options.config.sftpCommand}`)
  args.push(
    'backup',
    '--host',
    options.host,
    '--tag',
    'lody-oss',
    '--tag',
    `machine:${options.machineId}`,
    ...options.statePaths
  )
  return args
}
