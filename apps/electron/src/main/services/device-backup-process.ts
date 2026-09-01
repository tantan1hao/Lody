import { spawn, type ChildProcess } from 'node:child_process'

const MAX_COMMAND_OUTPUT = 16 * 1024

function appendBounded(current: string, chunk: Buffer): string {
  const next = `${current}${chunk.toString('utf8')}`
  return next.length <= MAX_COMMAND_OUTPUT ? next : next.slice(-MAX_COMMAND_OUTPUT)
}

/** Survives Electron quit so Command+Q is not blocked on SFTP snapshot time. */
export function spawnDetachedBackupProcess(command: string, args: string[]): ChildProcess {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  return child
}

export async function waitForBackupProcess(
  child: ChildProcess,
  timeoutMs: number,
  forceKillAfterMs = 1_000
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = ''
    let forceTimer: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        // The timeout error is the actionable failure.
      }
      forceTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // Best-effort escalation.
        }
      }, forceKillAfterMs)
      forceTimer.unref?.()
      reject(new Error(`Restic backup timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const finish = (error?: Error): void => {
      clearTimeout(timer)
      if (forceTimer) clearTimeout(forceTimer)
      if (error) reject(error)
      else resolve()
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      output = appendBounded(output, chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output = appendBounded(output, chunk)
    })
    child.once('error', (error) => finish(error))
    child.once('close', (code) => {
      if (code === 0) finish()
      else finish(new Error(`Restic exited with code ${code ?? 'unknown'}: ${output.trim()}`))
    })
  })
}
