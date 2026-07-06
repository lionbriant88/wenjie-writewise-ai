import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import { NodePaddleRunner, PaddleRunnerError, type SpawnPythonProcess } from './paddleRunner.js'

class FakeChildProcess extends EventEmitter implements SpawnPythonProcess {
  readonly stderr = new EventEmitter()
  readonly kill = vi.fn()
}

describe('NodePaddleRunner', () => {
  it('spawns python with the fixed runner protocol and shell disabled', async () => {
    const child = new FakeChildProcess()
    const spawnProcess = vi.fn(() => child)
    const runner = new NodePaddleRunner({
      pythonCommand: 'python3',
      scriptPath: 'scripts/paddle_ocr_runner.py',
      lang: 'ch',
      spawnProcess,
    })

    const runPromise = runner.run('input manifest.json', 'output file.json', 1000)
    child.emit('close', 0, null)

    await expect(runPromise).resolves.toBeUndefined()
    expect(spawnProcess).toHaveBeenCalledWith(
      'python3',
      [
        'scripts/paddle_ocr_runner.py',
        '--manifest',
        'input manifest.json',
        '--output',
        'output file.json',
        '--lang',
        'ch',
      ],
      { shell: false, stdio: ['ignore', 'ignore', 'pipe'] },
    )
  })

  it('maps missing python command to an environment error', async () => {
    const child = new FakeChildProcess()
    const spawnProcess = vi.fn(() => child)
    const runner = new NodePaddleRunner({ spawnProcess })

    const runPromise = runner.run('manifest.json', 'output.json', 1000)
    const enoent = Object.assign(
      new Error('spawn C:\\secret\\python.exe ENOENT --manifest SECRET'),
      { code: 'ENOENT' },
    )
    child.emit('error', enoent)

    await expect(runPromise).rejects.toMatchObject({
      kind: 'environment',
      message: 'Python command is not available.',
    })
    await expect(runPromise).rejects.not.toHaveProperty('message', expect.stringContaining('C:\\secret\\python.exe'))
    await expect(runPromise).rejects.not.toHaveProperty('message', expect.stringContaining('--manifest'))
    await expect(runPromise).rejects.not.toHaveProperty('message', expect.stringContaining('SECRET'))
    await expect(runPromise).rejects.toBeInstanceOf(PaddleRunnerError)
  })

  it('maps spawn startup failures to a generic execution error', async () => {
    const spawnProcess = vi.fn(() => {
      throw new Error('spawn C:\\secret\\python.exe EACCES --manifest SECRET')
    })
    const runner = new NodePaddleRunner({ spawnProcess })

    const runPromise = runner.run('manifest.json', 'output.json', 1000)

    await expect(runPromise).rejects.toMatchObject({
      kind: 'execution',
      message: 'Python runner failed to start.',
    })
    await expect(runPromise).rejects.not.toHaveProperty('message', expect.stringContaining('C:\\secret\\python.exe'))
    await expect(runPromise).rejects.not.toHaveProperty('message', expect.stringContaining('--manifest'))
    await expect(runPromise).rejects.not.toHaveProperty('message', expect.stringContaining('SECRET'))
  })

  it('kills python with SIGTERM and rejects with a timeout error', async () => {
    vi.useFakeTimers()
    try {
      const child = new FakeChildProcess()
      const spawnProcess = vi.fn(() => child)
      const runner = new NodePaddleRunner({ spawnProcess })

      const runPromise = runner.run('manifest.json', 'output.json', 50)
      vi.advanceTimersByTime(50)

      await expect(runPromise).rejects.toMatchObject({
        kind: 'timeout',
        message: 'Python runner timed out.',
      })
      expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    } finally {
      vi.useRealTimers()
    }
  })

  it('maps nonzero close to a generic execution error without leaking stderr', async () => {
    const child = new FakeChildProcess()
    const spawnProcess = vi.fn(() => child)
    const runner = new NodePaddleRunner({ spawnProcess })

    const runPromise = runner.run('manifest.json', 'output.json', 1000)
    child.stderr.emit('data', Buffer.from('Traceback /secret/input.png --manifest private args'))
    child.emit('close', 7, null)

    await expect(runPromise).rejects.toMatchObject({
      kind: 'execution',
      message: 'Python runner exited with a nonzero status.',
    })
    await expect(runPromise).rejects.not.toHaveProperty('message', expect.stringContaining('Traceback'))
    await expect(runPromise).rejects.not.toHaveProperty('message', expect.stringContaining('/secret/input.png'))
    await expect(runPromise).rejects.not.toHaveProperty('message', expect.stringContaining('--manifest'))
  })
})
