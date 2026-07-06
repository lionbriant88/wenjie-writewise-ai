import { spawn, type SpawnOptions } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type PaddleRunnerErrorKind = 'environment' | 'timeout' | 'execution'

export class PaddleRunnerError extends Error {
  readonly kind: PaddleRunnerErrorKind

  constructor(kind: PaddleRunnerErrorKind, message: string) {
    super(message)
    this.name = 'PaddleRunnerError'
    this.kind = kind
  }
}

export interface PaddleRunner {
  run(manifestPath: string, outputPath: string, timeoutMs: number): Promise<void>
}

export interface SpawnPythonProcess {
  readonly stderr: {
    on(event: 'data', listener: (chunk: Buffer | string) => void): unknown
  }
  kill(signal: NodeJS.Signals): unknown
  once(event: 'error', listener: (error: NodeJS.ErrnoException) => void): this
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
}

type SpawnPython = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => SpawnPythonProcess

export interface NodePaddleRunnerOptions {
  readonly pythonCommand?: string
  readonly scriptPath?: string
  readonly lang?: string
  readonly spawnProcess?: SpawnPython
}

const defaultScriptPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../scripts/paddle_ocr_runner.py',
)
const stderrBufferLimit = 4096

export class NodePaddleRunner implements PaddleRunner {
  private readonly pythonCommand: string
  private readonly scriptPath: string
  private readonly lang: string
  private readonly spawnProcess: SpawnPython

  constructor(options: NodePaddleRunnerOptions = {}) {
    this.pythonCommand = options.pythonCommand ?? process.env.PADDLE_OCR_PYTHON ?? 'python'
    this.scriptPath = options.scriptPath ?? defaultScriptPath
    this.lang = options.lang ?? process.env.PADDLE_OCR_LANG ?? 'en'
    this.spawnProcess =
      options.spawnProcess ??
      ((command, args, spawnOptions) => spawn(command, args, spawnOptions) as SpawnPythonProcess)
  }

  run(manifestPath: string, outputPath: string, timeoutMs: number): Promise<void> {
    const args = [
      this.scriptPath,
      '--manifest',
      manifestPath,
      '--output',
      outputPath,
      '--lang',
      this.lang,
    ]

    return new Promise((resolveRun, rejectRun) => {
      let settled = false
      let stderr = ''
      let timeout: NodeJS.Timeout | undefined

      const settle = (callback: () => void): void => {
        if (settled) {
          return
        }
        settled = true
        if (timeout) {
          clearTimeout(timeout)
        }
        callback()
      }

      let child: SpawnPythonProcess
      try {
        child = this.spawnProcess(this.pythonCommand, args, {
          shell: false,
          stdio: ['ignore', 'ignore', 'pipe'],
        })
      } catch (error) {
        const spawnError = error as NodeJS.ErrnoException
        const kind: PaddleRunnerErrorKind = spawnError.code === 'ENOENT' ? 'environment' : 'execution'
        settle(() => rejectRun(new PaddleRunnerError(kind, spawnError.message)))
        return
      }

      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-stderrBufferLimit)
      })

      child.once('error', (error) => {
        const kind: PaddleRunnerErrorKind = error.code === 'ENOENT' ? 'environment' : 'execution'
        settle(() => rejectRun(new PaddleRunnerError(kind, error.message)))
      })

      child.once('close', (code, signal) => {
        if (code === 0) {
          settle(resolveRun)
          return
        }

        void stderr
        void signal
        settle(() => rejectRun(new PaddleRunnerError('execution', 'Python runner exited with a nonzero status.')))
      })

      timeout = setTimeout(() => {
        child.kill('SIGTERM')
        settle(() => rejectRun(new PaddleRunnerError('timeout', 'Python runner timed out.')))
      }, timeoutMs)
      timeout.unref()
    })
  }
}
