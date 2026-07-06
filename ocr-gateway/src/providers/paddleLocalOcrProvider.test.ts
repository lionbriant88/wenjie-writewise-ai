import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'

import { PaddleLocalOcrProvider } from './paddleLocalOcrProvider.js'
import { PaddleRunnerError, type PaddleRunner } from './paddleRunner.js'
import type { GatewayRecognizeInput, OcrPageResult } from '../types.js'

class FakePaddleRunner implements PaddleRunner {
  readonly run = vi.fn<(manifestPath: string, outputPath: string, timeoutMs: number) => Promise<void>>()
}

function inputWithPages(pages: Array<{ pageId: string; originalName: string; buffer?: Buffer }>): GatewayRecognizeInput {
  return {
    essayGroupId: 'essay-1',
    pages: pages.map((page) => ({
      pageId: page.pageId,
      originalName: page.originalName,
      mimeType: 'image/png',
      size: page.buffer?.length ?? 10,
      buffer: page.buffer ?? Buffer.from(`image-${page.pageId}`),
    })),
  }
}

function firstRunPaths(runner: FakePaddleRunner) {
  const manifestPath = runner.run.mock.calls[0][0]
  return {
    manifestPath,
    outputPath: runner.run.mock.calls[0][1],
    timeoutMs: runner.run.mock.calls[0][2],
    tempDir: dirname(manifestPath),
  }
}

describe('PaddleLocalOcrProvider', () => {
  it('writes a manifest, runs paddle, normalizes output in request page order, and cleans temp files', async () => {
    const runner = new FakePaddleRunner()
    let observedManifest:
      | {
          pages: Array<{ pageId: string; originalName: string; imagePath: string }>
        }
      | undefined
    runner.run.mockImplementation(async (manifestPath, outputPath) => {
      observedManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as typeof observedManifest
      await writeFile(
        outputPath,
        JSON.stringify({
          pages: [
            { pageId: 'page-2', text: ' Second page ', confidence: 0.91 },
            { pageId: 'page-1', text: ' First page ', confidence: 0.82 },
          ],
        }),
        'utf8',
      )
    })
    const input = inputWithPages([
      { pageId: 'page-1', originalName: 'first scan.png' },
      { pageId: 'page-2', originalName: 'second scan.png' },
    ])
    const provider = new PaddleLocalOcrProvider({ runner, timeoutMs: 1234 })

    const result = await provider.recognize(input)
    const { tempDir, outputPath, timeoutMs } = firstRunPaths(runner)

    expect(result.status).toBe('success')
    expect(result.text).toBe('First page\n\nSecond page')
    expect(result.pages).toEqual([
      { pageId: 'page-1', text: 'First page', confidence: 0.82 },
      { pageId: 'page-2', text: 'Second page', confidence: 0.91 },
    ] satisfies OcrPageResult[])
    expect(basename(tempDir)).toMatch(/^wenjie-paddle-ocr-/)
    expect(dirname(tempDir)).toBe(tmpdir())
    expect(timeoutMs).toBe(1234)
    expect(observedManifest?.pages.map((page) => page.originalName)).toEqual(['first scan.png', 'second scan.png'])
    expect(observedManifest?.pages.map((page) => page.pageId)).toEqual(['page-1', 'page-2'])
    expect(observedManifest?.pages.every((page) => dirname(page.imagePath) === tempDir)).toBe(true)
    expect(outputPath.startsWith(tempDir)).toBe(true)
    expect(existsSync(tempDir)).toBe(false)
  })

  it('returns partial output when paddle reports one failed page', async () => {
    const runner = new FakePaddleRunner()
    runner.run.mockImplementation(async (_manifestPath, outputPath) => {
      await writeFile(
        outputPath,
        JSON.stringify({
          pages: [
            { pageId: 'page-1', text: '', warnings: ['paddle_page_failed'] },
            { pageId: 'page-2', text: 'Recognized page' },
          ],
        }),
        'utf8',
      )
    })
    const provider = new PaddleLocalOcrProvider({ runner })

    const result = await provider.recognize(
      inputWithPages([
        { pageId: 'page-1', originalName: 'failed.png' },
        { pageId: 'page-2', originalName: 'ok.png' },
      ]),
    )

    expect(result.status).toBe('partial')
    expect(result.text).toBe('Recognized page')
    expect(result.pages[0].warnings).toEqual(['paddle_page_failed', 'empty_text'])
  })

  it('maps environment runner failures to the local setup message', async () => {
    const runner = new FakePaddleRunner()
    runner.run.mockRejectedValue(new PaddleRunnerError('environment', 'Traceback C:\\secret --manifest SECRET'))
    const provider = new PaddleLocalOcrProvider({ runner })

    const result = await provider.recognize(inputWithPages([{ pageId: 'page-1', originalName: 'page.png' }]))

    expect(result.status).toBe('failed')
    expect(result.error).toBe('PaddleOCR 本地环境未就绪，请检查 Python 依赖，或使用 mock 草稿 / 手动输入。')
  })

  it('returns a generic failed result and cleans the temp directory when output JSON is invalid', async () => {
    const runner = new FakePaddleRunner()
    runner.run.mockImplementation(async (_manifestPath, outputPath) => {
      await writeFile(outputPath, '{not json', 'utf8')
    })
    const provider = new PaddleLocalOcrProvider({ runner })

    const result = await provider.recognize(inputWithPages([{ pageId: 'page-1', originalName: 'page.png' }]))
    const tempDir = dirname(runner.run.mock.calls[0][0])

    expect(result.status).toBe('failed')
    expect(result.error).toBe('PaddleOCR 识别失败，请使用 mock 草稿或手动输入。')
    expect(existsSync(tempDir)).toBe(false)
  })

  it('returns a generic failed result and cleans the temp directory on timeout', async () => {
    const runner = new FakePaddleRunner()
    runner.run.mockRejectedValue(new PaddleRunnerError('timeout', 'Python runner timed out.'))
    const provider = new PaddleLocalOcrProvider({ runner })

    const result = await provider.recognize(inputWithPages([{ pageId: 'page-1', originalName: 'page.png' }]))
    const tempDir = dirname(runner.run.mock.calls[0][0])

    expect(result.status).toBe('failed')
    expect(result.error).toBe('PaddleOCR 识别失败，请使用 mock 草稿或手动输入。')
    expect(existsSync(tempDir)).toBe(false)
  })

  it('sanitizes raw thrown errors from returned output', async () => {
    const runner = new FakePaddleRunner()
    runner.run.mockRejectedValue(new Error('Traceback D:\\tmp\\wenjie-paddle-ocr-SECRET --manifest SECRET'))
    const provider = new PaddleLocalOcrProvider({ runner })

    const result = await provider.recognize(inputWithPages([{ pageId: 'page-1', originalName: 'page.png' }]))

    expect(result.status).toBe('failed')
    expect(result.error).toBe('PaddleOCR 识别失败，请使用 mock 草稿或手动输入。')
    expect(result.error).not.toContain('Traceback')
    expect(result.error).not.toContain('--manifest')
    expect(result.error).not.toContain('SECRET')
    expect(result.error).not.toContain('wenjie-paddle-ocr')
  })
})
