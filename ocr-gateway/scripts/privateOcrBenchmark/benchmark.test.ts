import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PaddleLocalOcrProvider } from '../../src/providers/paddleLocalOcrProvider.js'
import type { PaddleRunner } from '../../src/providers/paddleRunner.js'
import { runPrivateBenchmark } from './benchmark.js'
import type { PrivateSampleManifest } from './types.js'

const temporaryRoots: string[] = []
const faithfulText = 'Synthetic faithful essay text'

interface RunnerManifest {
  essayGroupId: string
  pages: Array<{ pageId: string }>
}

class SyntheticRunner implements PaddleRunner {
  constructor(
    private readonly outputFor: (manifest: RunnerManifest) => unknown,
  ) {}

  async run(manifestPath: string, outputPath: string): Promise<void> {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RunnerManifest
    const output = this.outputFor(manifest)
    if (output instanceof Error) throw output
    await writeFile(outputPath, JSON.stringify(output), 'utf8')
  }
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wenjie-benchmark-synthetic-'))
  temporaryRoots.push(root)
  return root
}

async function createSample(
  root: string,
  manifest: PrivateSampleManifest,
  referenceText = faithfulText,
): Promise<string> {
  const sampleRoot = join(root, manifest.sampleId)
  await mkdir(sampleRoot, { recursive: true })
  for (const page of manifest.pages) {
    await writeFile(join(sampleRoot, page), Buffer.from('synthetic-image'))
  }
  await writeFile(join(sampleRoot, manifest.reference), referenceText, 'utf8')
  const manifestName = `${manifest.sampleId}.json`
  await writeFile(join(root, manifestName), JSON.stringify(manifest), 'utf8')
  return manifestName
}

function providerWith(
  outputFor: (manifest: RunnerManifest) => unknown,
): PaddleLocalOcrProvider {
  return new PaddleLocalOcrProvider({ runner: new SyntheticRunner(outputFor) })
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('runPrivateBenchmark', () => {
  it('runs the production provider path and emits only anonymous metrics', async () => {
    const root = await createRoot()
    const manifestName = await createSample(root, {
      sampleId: 'sample-001',
      category: 'clear',
      pages: ['page-1.png'],
      reference: 'reference.txt',
    })
    const provider = providerWith((manifest) => ({
      pages: manifest.pages.map((page) => ({ pageId: page.pageId, text: faithfulText, confidence: 0.9 })),
    }))

    const summary = await runPrivateBenchmark({ samplesRoot: root, manifests: [manifestName], provider })
    const serialized = JSON.stringify(summary)

    expect(summary.benchmarkVersion).toBe('private-ocr-benchmark-v1')
    expect(summary.samples[0]).toMatchObject({
      sampleId: 'sample-001',
      benchmarkStatus: 'completed',
      ocrStatus: 'success',
      averageConfidence: 0.9,
      metricsVersion: 'ocr-text-metrics-v1',
    })
    expect(serialized).not.toContain(faithfulText)
    expect(serialized).not.toContain(root)
  })

  it('treats partial as completed and passes through only manually confirmed missing lines', async () => {
    const root = await createRoot()
    const manifestName = await createSample(root, {
      sampleId: 'sample-002',
      category: 'multi_page',
      pages: ['page-1.png', 'page-2.png'],
      reference: 'reference.txt',
      confirmedMissingLineCount: 1,
    })
    const provider = providerWith((manifest) => ({
      pages: [
        { pageId: manifest.pages[0].pageId, text: faithfulText },
        { pageId: manifest.pages[1].pageId, text: '', warnings: ['paddle_page_failed'] },
      ],
    }))

    const summary = await runPrivateBenchmark({ samplesRoot: root, manifests: [manifestName], provider })

    expect(summary.samples[0]).toMatchObject({
      benchmarkStatus: 'completed',
      ocrStatus: 'partial',
      confirmedMissingLineCount: 1,
    })
    expect(summary.samples[0].warningCodes).toEqual(expect.arrayContaining(['paddle_page_failed']))
  })

  it('records provider failure and continues with later samples', async () => {
    const root = await createRoot()
    const first = await createSample(root, {
      sampleId: 'sample-003',
      category: 'dark',
      pages: ['page-1.png'],
      reference: 'reference.txt',
    })
    const second = await createSample(root, {
      sampleId: 'sample-004',
      category: 'clear',
      pages: ['page-1.png'],
      reference: 'reference.txt',
    })
    const provider = providerWith((manifest) =>
      manifest.essayGroupId === 'sample-003'
        ? new Error('synthetic runner failure')
        : { pages: manifest.pages.map((page) => ({ pageId: page.pageId, text: faithfulText })) },
    )

    const summary = await runPrivateBenchmark({ samplesRoot: root, manifests: [first, second], provider })

    expect(summary.failedSampleCount).toBe(1)
    expect(summary.completedSampleCount).toBe(1)
    expect(summary.samples.map((sample) => sample.benchmarkStatus)).toEqual(['failed', 'completed'])
    expect(summary.samples[0].invalidReason).toBe('provider_failed')
  })

  it('rejects invalid IDs and returns null metrics for an empty reference', async () => {
    const root = await createRoot()
    await writeFile(
      join(root, 'invalid.json'),
      JSON.stringify({ sampleId: 'student-name', category: 'clear', pages: ['page.png'], reference: 'reference.txt' }),
      'utf8',
    )
    const emptyReference = await createSample(
      root,
      {
        sampleId: 'sample-005',
        category: 'clear',
        pages: ['page-1.png'],
        reference: 'reference.txt',
      },
      '',
    )
    const provider = providerWith((manifest) => ({
      pages: manifest.pages.map((page) => ({ pageId: page.pageId, text: faithfulText })),
    }))

    const summary = await runPrivateBenchmark({
      samplesRoot: root,
      manifests: ['invalid.json', emptyReference],
      provider,
    })

    expect(summary.samples[0]).toMatchObject({ sampleId: 'sample-000', invalidReason: 'invalid_manifest' })
    expect(summary.samples[1]).toMatchObject({ cer: null, wer: null, invalidReason: 'empty_reference' })
    expect(summary.samples[1]).not.toHaveProperty('confirmedMissingLineCount')
  })

  it.each([
    ['page path', ['../outside.png'], 'reference.txt'],
    ['reference path', ['page-1.png'], '../outside.txt'],
  ])('rejects %s traversal without exposing the path', async (_label, pages, reference) => {
    const root = await createRoot()
    const manifest = { sampleId: 'sample-006', category: 'clear', pages, reference }
    await writeFile(join(root, 'sample-006.json'), JSON.stringify(manifest), 'utf8')
    const sampleRoot = join(root, 'sample-006')
    await mkdir(sampleRoot)
    if (pages[0] === 'page-1.png') await writeFile(join(sampleRoot, 'page-1.png'), 'image')
    if (reference === 'reference.txt') await writeFile(join(sampleRoot, reference), faithfulText)

    const summary = await runPrivateBenchmark({
      samplesRoot: root,
      manifests: ['sample-006.json'],
      provider: providerWith(() => ({ pages: [] })),
    })
    const serialized = JSON.stringify(summary)

    expect(summary.samples[0].invalidReason).toBe('invalid_manifest')
    expect(serialized).not.toContain('outside')
    expect(serialized).not.toContain(root)
  })
})
