import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { normalizeProviderResult } from '../normalizeOcrResult.js'
import type { GatewayPageInput, GatewayRecognizeInput, OcrEssayResult, OcrPageResult } from '../types.js'
import { NodePaddleRunner, PaddleRunnerError, type PaddleRunner } from './paddleRunner.js'
import type { OcrProvider } from './providerTypes.js'

const defaultTimeoutMs = 30_000
const environmentError = 'PaddleOCR 本地环境未就绪，请检查 Python 依赖，或使用 mock 草稿 / 手动输入。'
const genericError = 'PaddleOCR 识别失败，请使用 mock 草稿或手动输入。'

type CleanupDir = (tempDir: string) => Promise<void>

interface PaddleLocalOcrProviderOptions {
  readonly runner?: PaddleRunner
  readonly timeoutMs?: number
  readonly cleanupDir?: CleanupDir
}

interface PaddleOutput {
  readonly pages?: unknown
  readonly error?: unknown
  readonly errorCode?: unknown
}

type ParsedPaddleOutput =
  | { kind: 'pages'; pages: OcrPageResult[] }
  | { kind: 'error'; message: string }

function extensionForPage(page: GatewayPageInput): string {
  if (page.mimeType === 'image/jpeg') {
    return '.jpg'
  }
  if (page.mimeType === 'image/webp') {
    return '.webp'
  }
  return '.png'
}

function failedResult(input: GatewayRecognizeInput, error: string): OcrEssayResult {
  const result = normalizeProviderResult({
    input,
    providerPages: input.pages.map((page) => ({
      pageId: page.pageId,
      text: '',
      warnings: ['paddle_page_failed'],
    })),
  })

  return {
    ...result,
    error,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizePage(rawPage: unknown): OcrPageResult | undefined {
  if (!isObject(rawPage) || typeof rawPage.pageId !== 'string') {
    return undefined
  }

  const page: OcrPageResult = {
    pageId: rawPage.pageId,
    text: typeof rawPage.text === 'string' ? rawPage.text : '',
  }

  if (typeof rawPage.confidence === 'number') {
    page.confidence = rawPage.confidence
  }

  if (Array.isArray(rawPage.warnings) && rawPage.warnings.every((warning) => typeof warning === 'string')) {
    page.warnings = rawPage.warnings
  }

  return page
}

function outputPages(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed
  }
  if (isObject(parsed) && Array.isArray((parsed as PaddleOutput).pages)) {
    return (parsed as { pages: unknown[] }).pages
  }
  throw new Error('Paddle output JSON did not contain pages.')
}

function parseOutput(output: string): ParsedPaddleOutput {
  const parsed = JSON.parse(output)
  if (isObject(parsed) && typeof parsed.error === 'string') {
    return {
      kind: 'error',
      message: parsed.errorCode === 'paddle_environment' ? environmentError : genericError,
    }
  }

  return {
    kind: 'pages',
    pages: outputPages(parsed).map(normalizePage).filter((page): page is OcrPageResult => page !== undefined),
  }
}

async function defaultCleanupDir(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true })
}

export class PaddleLocalOcrProvider implements OcrProvider {
  private readonly runner: PaddleRunner
  private readonly timeoutMs: number
  private readonly cleanupDir: CleanupDir

  constructor(options: PaddleLocalOcrProviderOptions = {}) {
    this.runner = options.runner ?? new NodePaddleRunner()
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs
    this.cleanupDir = options.cleanupDir ?? defaultCleanupDir
  }

  async recognize(input: GatewayRecognizeInput): Promise<OcrEssayResult> {
    let tempDir: string | undefined

    try {
      tempDir = await mkdtemp(join(tmpdir(), 'wenjie-paddle-ocr-'))
      const workingDir = tempDir
      const outputPath = join(workingDir, 'output.json')
      const manifestPath = join(workingDir, 'manifest.json')
      const manifestPages = await Promise.all(
        input.pages.map(async (page, index) => {
          const imagePath = join(workingDir, `page-${index + 1}${extensionForPage(page)}`)
          await writeFile(imagePath, page.buffer)

          return {
            pageId: page.pageId,
            originalName: page.originalName,
            mimeType: page.mimeType,
            size: page.size,
            imagePath,
          }
        }),
      )

      await writeFile(
        manifestPath,
        JSON.stringify(
          {
            essayGroupId: input.essayGroupId,
            pages: manifestPages,
          },
          null,
          2,
        ),
        'utf8',
      )

      await this.runner.run(manifestPath, outputPath, this.timeoutMs)
      const parsedOutput = parseOutput(await readFile(outputPath, 'utf8'))
      if (parsedOutput.kind === 'error') {
        return failedResult(input, parsedOutput.message)
      }

      return normalizeProviderResult({ input, providerPages: parsedOutput.pages })
    } catch (error) {
      if (error instanceof PaddleRunnerError && error.kind === 'environment') {
        return failedResult(input, environmentError)
      }

      return failedResult(input, genericError)
    } finally {
      if (tempDir) {
        try {
          await this.cleanupDir(tempDir)
        } catch {
          // Cleanup is best-effort and must not replace the OCR result or sanitized error.
        }
      }
    }
  }
}
