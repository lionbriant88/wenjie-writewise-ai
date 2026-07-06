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
    const enoent = Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT' })
    child.emit('error', enoent)

    await expect(runPromise).rejects.toMatchObject({
      kind: 'environment',
    })
    await expect(runPromise).rejects.toBeInstanceOf(PaddleRunnerError)
  })

  it('kills python with SIGTERM and rejects with a timeout error', async () => {
    vi.useFakeTimers()
    try {
      const child = new FakeChildProcess()
      const spawnProcess = vi.fn(() => child)
      const runner = new NodePaddleRunner({ spawnProcess })

      const runPromise = runner.run('manifest.json', 'output.json', 50)
      vi.advanceTimersByTime(50)

      await expect(Promise.race([runPromise, Promise.resolve('pending')])).resolves.toBe('pending')
      expect(child.kill).toHaveBeenCalledWith('SIGTERM')

      child.emit('close', null, 'SIGTERM')

      await expect(runPromise).rejects.toMatchObject({
        kind: 'timeout',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('maps nonzero close to an execution error', async () => {
    const child = new FakeChildProcess()
    const spawnProcess = vi.fn(() => child)
    const runner = new NodePaddleRunner({ spawnProcess })

    const runPromise = runner.run('manifest.json', 'output.json', 1000)
    child.stderr.emit('data', Buffer.from('traceback text'))
    child.emit('close', 7, null)

    await expect(runPromise).rejects.toMatchObject({
      kind: 'execution',
      message: expect.stringContaining('traceback text'),
    })
  })
})
