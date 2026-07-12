import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PaddleLocalOcrProvider } from '../../src/providers/paddleLocalOcrProvider.js'
import { NodePaddleRunner } from '../../src/providers/paddleRunner.js'
import { runPrivateBenchmark } from './benchmark.js'
import {
  BENCHMARK_EXIT_FATAL,
  BENCHMARK_EXIT_SAMPLE_FAILURE,
  BENCHMARK_EXIT_SUCCESS,
  type AnonymousBenchmarkSummary,
  type BenchmarkExitCode,
} from './types.js'

export interface CliDependencies {
  samplesRoot: string
  resultsRoot: string
  listManifests: () => Promise<string[]>
  runBenchmark: () => Promise<AnonymousBenchmarkSummary>
  writeSummary: (summary: AnonymousBenchmarkSummary) => Promise<void>
  log: (message: string) => void
}

export async function runCli(deps: CliDependencies): Promise<BenchmarkExitCode> {
  try {
    const manifests = await deps.listManifests()
    if (manifests.length === 0) return BENCHMARK_EXIT_FATAL
    const summary = await deps.runBenchmark()
    await deps.writeSummary(summary)
    for (const sample of summary.samples) {
      deps.log(
        `sampleId=${sample.sampleId} status=${sample.benchmarkStatus} cer=${sample.cer ?? 'null'} wer=${sample.wer ?? 'null'}`,
      )
    }
    return summary.failedSampleCount > 0 ? BENCHMARK_EXIT_SAMPLE_FAILURE : BENCHMARK_EXIT_SUCCESS
  } catch {
    deps.log('benchmark_status=fatal')
    return BENCHMARK_EXIT_FATAL
  }
}

export async function writeAnonymousSummary(
  resultsRoot: string,
  summary: AnonymousBenchmarkSummary,
): Promise<void> {
  await mkdir(resultsRoot, { recursive: true })
  await writeFile(resolve(resultsRoot, 'benchmark-summary.json'), JSON.stringify(summary, null, 2), 'utf8')
}

const gatewayRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const samplesRoot = resolve(gatewayRoot, 'local-private-samples')
const resultsRoot = resolve(gatewayRoot, 'local-private-results')

async function main(): Promise<BenchmarkExitCode> {
  const runner = new NodePaddleRunner()
  const provider = new PaddleLocalOcrProvider({ runner })
  const manifests = async () => (await readdir(samplesRoot)).filter((name) => name.endsWith('.json')).sort()

  return runCli({
    samplesRoot,
    resultsRoot,
    listManifests: manifests,
    runBenchmark: async () => runPrivateBenchmark({ samplesRoot, manifests: await manifests(), provider }),
    writeSummary: async (summary) => writeAnonymousSummary(resultsRoot, summary),
    log: (message) => process.stderr.write(`${message}\n`),
  })
}

export function isMainModule(importMetaUrl: string, argvEntry: string | undefined): boolean {
  return argvEntry !== undefined && importMetaUrl === pathToFileURL(resolve(argvEntry)).href
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await main()
}
