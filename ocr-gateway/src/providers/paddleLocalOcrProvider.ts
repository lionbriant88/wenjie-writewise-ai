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

interface PaddleLocalOcrProviderOptions {
  readonly runner?: PaddleRunner
  readonly timeoutMs?: number
}

interface PaddleOutput {
  readonly pages?: OcrPageResult[]
}

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

function parsePages(output: string): OcrPageResult[] {
  const parsed = JSON.parse(output) as PaddleOutput | OcrPageResult[]
  if (Array.isArray(parsed)) {
    return parsed
  }
  if (Array.isArray(parsed.pages)) {
    return parsed.pages
  }
  throw new Error('Paddle output JSON did not contain pages.')
}

export class PaddleLocalOcrProvider implements OcrProvider {
  private readonly runner: PaddleRunner
  private readonly timeoutMs: number

  constructor(options: PaddleLocalOcrProviderOptions = {}) {
    this.runner = options.runner ?? new NodePaddleRunner()
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs
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
      const providerPages = parsePages(await readFile(outputPath, 'utf8'))

      return normalizeProviderResult({ input, providerPages })
    } catch (error) {
      if (error instanceof PaddleRunnerError && error.kind === 'environment') {
        return failedResult(input, environmentError)
      }

      return failedResult(input, genericError)
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true })
      }
    }
  }
}
