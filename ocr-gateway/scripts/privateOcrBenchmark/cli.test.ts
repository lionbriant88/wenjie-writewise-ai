import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli, writeAnonymousSummary } from './cli.js'
import type { AnonymousBenchmarkSummary } from './types.js'

const temporaryRoots: string[] = []

function summary(failedSampleCount = 0): AnonymousBenchmarkSummary {
  return {
    benchmarkVersion: 'private-ocr-benchmark-v1',
    completedSampleCount: failedSampleCount === 0 ? 1 : 0,
    failedSampleCount,
    samples: [
      {
        sampleId: 'sample-001',
        category: 'clear',
        pageCount: 1,
        benchmarkStatus: failedSampleCount === 0 ? 'completed' : 'failed',
        ocrStatus: failedSampleCount === 0 ? 'success' : 'failed',
        warningCodes: [],
        cer: 0,
        wer: 0,
        durationMs: 1,
        metricsVersion: 'ocr-text-metrics-v1',
      },
    ],
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('private benchmark CLI', () => {
  it('has no HTTP server entrypoint or listener dependency', async () => {
    const source = await readFile(new URL('./cli.ts', import.meta.url), 'utf8')

    expect(source).not.toMatch(/src\/index|express|\.listen\s*\(/)
  })

  it('uses fixed exit codes for success, fatal failure, and sample failure', async () => {
    const logs: string[] = []
    const base = {
      samplesRoot: 'synthetic-samples',
      resultsRoot: 'synthetic-results',
      listManifests: async () => ['sample-001.json'],
      writeSummary: async () => undefined,
      log: (message: string) => logs.push(message),
    }

    expect(await runCli({ ...base, runBenchmark: async () => summary() })).toBe(0)
    expect(await runCli({ ...base, listManifests: async () => { throw new Error('fatal') }, runBenchmark: async () => summary() })).toBe(1)
    expect(await runCli({ ...base, runBenchmark: async () => summary(1) })).toBe(2)
  })

  it('writes anonymous output only below the injected results directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wenjie-cli-synthetic-'))
    temporaryRoots.push(root)
    const resultsRoot = join(root, 'local-private-results')
    await writeAnonymousSummary(resultsRoot, summary())

    const output = await readFile(join(resultsRoot, 'benchmark-summary.json'), 'utf8')
    expect(output).toContain('sample-001')
    expect(output).not.toContain('Synthetic faithful essay text')
    expect(output).not.toContain(root)
  })

  it('logs only anonymous sample metrics and sanitizes fatal errors', async () => {
    const logs: string[] = []
    const exitCode = await runCli({
      samplesRoot: 'C:\\private\\samples',
      resultsRoot: 'C:\\private\\results',
      listManifests: async () => ['sample-001.json'],
      runBenchmark: async () => summary(),
      writeSummary: async () => undefined,
      log: (message) => logs.push(message),
    })

    expect(exitCode).toBe(0)
    expect(logs).toEqual(['sampleId=sample-001 status=completed cer=0 wer=0'])
    expect(logs.join(' ')).not.toContain('C:\\private')
    expect(logs.join(' ')).not.toContain('Synthetic faithful essay text')

    const fatalLogs: string[] = []
    await runCli({
      samplesRoot: 'C:\\private\\samples',
      resultsRoot: 'C:\\private\\results',
      listManifests: async () => { throw new Error('traceback C:\\private\\samples') },
      runBenchmark: async () => summary(),
      writeSummary: async () => undefined,
      log: (message) => fatalLogs.push(message),
    })
    expect(fatalLogs).toEqual(['benchmark_status=fatal'])
  })
})
