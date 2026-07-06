# PaddleOCR Local OCR Provider v0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local PaddleOCR-backed OCR provider inside `ocr-gateway` while preserving the existing frontend mock/real OCR flow and keeping all PaddleOCR-specific logic out of `app/src`.

**Architecture:** The frontend continues to call the existing remote OCR client and receives unified `OcrEssayResult` objects. `ocr-gateway` adds `OCR_PROVIDER=paddle_local`, a `PaddleLocalOcrProvider`, and a safe `child_process.spawn` runner that invokes `scripts/paddle_ocr_runner.py` through a fixed argument protocol. Automated tests use fake runners and mocked process spawning; real PaddleOCR installation is only for optional local smoke testing.

**Tech Stack:** React 19, Vite 8, TypeScript, Vitest, React Testing Library, Node/Express, multer memory storage, Node `fs/promises`, `os.tmpdir`, `child_process.spawn`, Python, PaddleOCR.

---

## File Structure

- Modify: `ocr-gateway/src/types.ts`
  Adds `paddle_local` to `GatewayProviderName`.

- Modify: `ocr-gateway/src/normalizeOcrResult.ts`
  Treats `paddle_page_failed` warnings as page failures so partial page failures produce `partial` or `failed` instead of `success`.

- Modify: `ocr-gateway/src/normalizeOcrResult.test.ts`
  Covers `paddle_page_failed` status behavior.

- Create: `ocr-gateway/src/providers/paddleRunner.ts`
  Defines `PaddleRunner`, `PaddleRunnerError`, and `NodePaddleRunner`. Uses `spawn`, never `exec`, never shell string composition, and kills the Python process on timeout.

- Create: `ocr-gateway/src/providers/paddleRunner.test.ts`
  Tests spawn arguments, `shell: false`, timeout kill, and environment error mapping without running real Python.

- Create: `ocr-gateway/src/providers/paddleLocalOcrProvider.ts`
  Writes request pages to a `fs.mkdtemp(os.tmpdir())` temp directory, writes manifest/output paths, calls the runner, parses output JSON, normalizes pages, maps errors to safe Chinese messages, and removes the temp directory in `finally`.

- Create: `ocr-gateway/src/providers/paddleLocalOcrProvider.test.ts`
  Uses fake runners to test success, input-order merge, partial page failure, empty text, invalid JSON, environment failure, generic failure, and cleanup.

- Modify: `ocr-gateway/src/providers/index.ts`
  Selects `PaddleLocalOcrProvider` when `OCR_PROVIDER=paddle_local`; keeps `mock` and `mock_failure`.

- Create: `ocr-gateway/src/providers/index.test.ts`
  Tests provider selection without invoking real PaddleOCR.

- Create: `ocr-gateway/scripts/paddle_ocr_runner.py`
  Reads `--manifest`, writes structured JSON to `--output`, receives `--lang`, sends ordinary logs to stderr, and supports page-level failure warnings.

- Create: `ocr-gateway/requirements.txt`
  Records local PaddleOCR dependencies for optional smoke testing.

- Modify: `ocr-gateway/.env.example`
  Documents `OCR_PROVIDER=paddle_local`, `PADDLE_OCR_PYTHON`, `PADDLE_OCR_LANG`, and `PADDLE_OCR_TIMEOUT_MS`.

- Create: `docs/ocr_provider_evaluation_paddle_v02.md`
  Provides a sample evaluation record only; no product UI, dashboard, chart, or feature.

- Modify: `docs/current_development_status.md`
  Adds a top status entry after implementation and verification.

---

### Task 1: Normalize Paddle Page Failures

**Files:**
- Modify: `ocr-gateway/src/normalizeOcrResult.test.ts`
- Modify: `ocr-gateway/src/normalizeOcrResult.ts`

- [ ] **Step 1: Add failing tests for `paddle_page_failed`**

Add these tests inside the existing `describe('normalizeProviderResult', ...)` block in `ocr-gateway/src/normalizeOcrResult.test.ts`:

```ts
  it('returns partial when one requested page has a paddle page failure warning', () => {
    const result = normalizeProviderResult({
      input: inputWithPages(['page-1', 'page-2']),
      providerPages: [
        { pageId: 'page-1', text: '', warnings: ['paddle_page_failed'] },
        { pageId: 'page-2', text: 'Recognized second page' },
      ],
    })

    expect(result.status).toBe('partial')
    expect(result.text).toBe('Recognized second page')
    expect(result.pages[0].warnings).toEqual(['paddle_page_failed', 'empty_text'])
    expect(result.error).toBeUndefined()
  })

  it('returns failed when every requested page has a paddle page failure warning', () => {
    const result = normalizeProviderResult({
      input: inputWithPages(['page-1', 'page-2']),
      providerPages: [
        { pageId: 'page-1', text: '', warnings: ['paddle_page_failed'] },
        { pageId: 'page-2', text: '', warnings: ['paddle_page_failed'] },
      ],
    })

    expect(result.status).toBe('failed')
    expect(result.text).toBe('')
    expect(result.error).toBe('OCR 识别失败，请使用 mock 草稿或手动输入。')
  })
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test -- src/normalizeOcrResult.test.ts
```

Expected: the two new tests fail because `paddle_page_failed` is not counted as a failed page yet.

- [ ] **Step 3: Update normalization logic**

In `ocr-gateway/src/normalizeOcrResult.ts`, replace the status calculation with:

```ts
function hasPageFailure(page: OcrPageResult) {
  return page.warnings?.some((warning) => warning === 'page_not_recognized' || warning === 'paddle_page_failed') ?? false
}

export function normalizeProviderResult({ input, providerPages }: NormalizeProviderResultInput): OcrEssayResult {
  const pagesById = new Map(providerPages.map((page) => [page.pageId, page]))

  const pages = input.pages.map((requestPage): OcrPageResult => {
    const providerPage = pagesById.get(requestPage.pageId)
    const text = normalizeText(providerPage?.text)
    const warnings = [...(providerPage?.warnings ?? [])]

    if (!providerPage) warnings.push('page_not_recognized')
    if (text.length === 0) warnings.push('empty_text')

    return {
      pageId: requestPage.pageId,
      text,
      confidence: providerPage?.confidence,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  })

  const failedPageCount = pages.filter(hasPageFailure).length
  const status = failedPageCount === 0 ? 'success' : failedPageCount === pages.length ? 'failed' : 'partial'

  return {
    essayGroupId: input.essayGroupId,
    text: pages.map((page) => page.text).filter(Boolean).join('\n\n'),
    pages,
    provider: 'remote',
    status,
    error: status === 'failed' ? 'OCR 识别失败，请使用 mock 草稿或手动输入。' : undefined,
  }
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test -- src/normalizeOcrResult.test.ts
```

Expected: all `normalizeProviderResult` tests pass.

- [ ] **Step 5: Commit Task 1**

```powershell
git add ocr-gateway/src/normalizeOcrResult.ts ocr-gateway/src/normalizeOcrResult.test.ts
git commit -m "test: normalize paddle page failures"
```

---

### Task 2: Add Safe Paddle Runner Boundary

**Files:**
- Create: `ocr-gateway/src/providers/paddleRunner.ts`
- Create: `ocr-gateway/src/providers/paddleRunner.test.ts`

- [ ] **Step 1: Write failing runner tests**

Create `ocr-gateway/src/providers/paddleRunner.test.ts`:

```ts
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NodePaddleRunner, PaddleRunnerError, type SpawnPythonProcess } from './paddleRunner.js'

function createFakeProcess() {
  const child = new EventEmitter() as SpawnPythonProcess
  child.stderr = Readable.from(['runner log'])
  child.kill = vi.fn(() => true)
  return child
}

describe('NodePaddleRunner', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('spawns python with fixed args, output file protocol, and shell disabled', async () => {
    const child = createFakeProcess()
    const spawnProcess = vi.fn(() => child)
    const runner = new NodePaddleRunner({
      pythonCommand: 'C:\\Python\\python.exe',
      scriptPath: 'D:\\wenjie-writewise-ai\\ocr-gateway\\scripts\\paddle_ocr_runner.py',
      lang: 'en',
      spawnProcess,
    })

    const promise = runner.run('D:\\tmp\\manifest.json', 'D:\\tmp\\output.json', 60000)
    child.emit('close', 0)
    await promise

    expect(spawnProcess).toHaveBeenCalledWith(
      'C:\\Python\\python.exe',
      [
        'D:\\wenjie-writewise-ai\\ocr-gateway\\scripts\\paddle_ocr_runner.py',
        '--manifest',
        'D:\\tmp\\manifest.json',
        '--output',
        'D:\\tmp\\output.json',
        '--lang',
        'en',
      ],
      { shell: false, stdio: ['ignore', 'ignore', 'pipe'] },
    )
  })

  it('maps missing python command to an environment error', async () => {
    const child = createFakeProcess()
    const spawnProcess = vi.fn(() => child)
    const runner = new NodePaddleRunner({ spawnProcess })

    const promise = runner.run('manifest.json', 'output.json', 60000)
    child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))

    await expect(promise).rejects.toMatchObject({
      kind: 'environment',
      message: 'Python command is not available.',
    } satisfies Partial<PaddleRunnerError>)
  })

  it('kills the python process on timeout', async () => {
    vi.useFakeTimers()
    const child = createFakeProcess()
    const spawnProcess = vi.fn(() => child)
    const runner = new NodePaddleRunner({ spawnProcess })

    const promise = runner.run('manifest.json', 'output.json', 50)
    await vi.advanceTimersByTimeAsync(51)
    child.emit('close', null)

    await expect(promise).rejects.toMatchObject({ kind: 'timeout' })
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('maps nonzero runner exit to an execution error', async () => {
    const child = createFakeProcess()
    const spawnProcess = vi.fn(() => child)
    const runner = new NodePaddleRunner({ spawnProcess })

    const promise = runner.run('manifest.json', 'output.json', 60000)
    child.emit('close', 1)

    await expect(promise).rejects.toMatchObject({ kind: 'execution' })
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test -- src/providers/paddleRunner.test.ts
```

Expected: fails because `paddleRunner.ts` does not exist.

- [ ] **Step 3: Implement the safe runner**

Create `ocr-gateway/src/providers/paddleRunner.ts`:

```ts
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Readable } from 'node:stream'

export type PaddleRunnerErrorKind = 'environment' | 'timeout' | 'execution'

export class PaddleRunnerError extends Error {
  constructor(
    readonly kind: PaddleRunnerErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'PaddleRunnerError'
  }
}

export interface PaddleRunner {
  run(manifestPath: string, outputPath: string, timeoutMs: number): Promise<void>
}

export interface SpawnPythonProcess {
  stderr: Readable | null
  kill(signal?: NodeJS.Signals): boolean
  on(event: 'close', listener: (code: number | null) => void): this
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): this
}

type SpawnProcess = (
  command: string,
  args: string[],
  options: { shell: false; stdio: ['ignore', 'ignore', 'pipe'] },
) => SpawnPythonProcess

interface NodePaddleRunnerOptions {
  pythonCommand?: string
  scriptPath?: string
  lang?: string
  spawnProcess?: SpawnProcess
}

const currentDir = dirname(fileURLToPath(import.meta.url))
const defaultScriptPath = resolve(currentDir, '../../scripts/paddle_ocr_runner.py')

export class NodePaddleRunner implements PaddleRunner {
  private readonly pythonCommand: string
  private readonly scriptPath: string
  private readonly lang: string
  private readonly spawnProcess: SpawnProcess

  constructor(options: NodePaddleRunnerOptions = {}) {
    this.pythonCommand = options.pythonCommand ?? process.env.PADDLE_OCR_PYTHON ?? 'python'
    this.scriptPath = options.scriptPath ?? defaultScriptPath
    this.lang = options.lang ?? process.env.PADDLE_OCR_LANG ?? 'en'
    this.spawnProcess = options.spawnProcess ?? (spawn as SpawnProcess)
  }

  run(manifestPath: string, outputPath: string, timeoutMs: number): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = this.spawnProcess(
        this.pythonCommand,
        [this.scriptPath, '--manifest', manifestPath, '--output', outputPath, '--lang', this.lang],
        { shell: false, stdio: ['ignore', 'ignore', 'pipe'] },
      )
      let settled = false
      let timedOut = false

      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
      }, timeoutMs)

      const settle = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) rejectPromise(error)
        else resolvePromise()
      }

      child.on('error', (error) => {
        const kind = error.code === 'ENOENT' ? 'environment' : 'execution'
        settle(new PaddleRunnerError(kind, kind === 'environment' ? 'Python command is not available.' : 'Python runner failed.'))
      })

      child.on('close', (code) => {
        if (timedOut) {
          settle(new PaddleRunnerError('timeout', 'Python runner timed out.'))
          return
        }

        if (code === 0) {
          settle()
          return
        }

        settle(new PaddleRunnerError('execution', 'Python runner exited with a nonzero status.'))
      })
    })
  }
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test -- src/providers/paddleRunner.test.ts
```

Expected: all runner tests pass.

- [ ] **Step 5: Commit Task 2**

```powershell
git add ocr-gateway/src/providers/paddleRunner.ts ocr-gateway/src/providers/paddleRunner.test.ts
git commit -m "feat: add safe paddle runner boundary"
```

---

### Task 3: Add Paddle Local Provider with Fake Runner Tests

**Files:**
- Create: `ocr-gateway/src/providers/paddleLocalOcrProvider.ts`
- Create: `ocr-gateway/src/providers/paddleLocalOcrProvider.test.ts`

- [ ] **Step 1: Write failing provider tests**

Create `ocr-gateway/src/providers/paddleLocalOcrProvider.test.ts`:

```ts
import { access, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { GatewayRecognizeInput } from '../types.js'
import { PaddleLocalOcrProvider } from './paddleLocalOcrProvider.js'
import { PaddleRunnerError, type PaddleRunner } from './paddleRunner.js'

function inputWithPages(pageIds: string[]): GatewayRecognizeInput {
  return {
    essayGroupId: 'group-1',
    pages: pageIds.map((pageId, index) => ({
      pageId,
      originalName: `${pageId}.png`,
      mimeType: 'image/png',
      size: 16,
      buffer: Buffer.from(`image-${index}`),
    })),
  }
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

describe('PaddleLocalOcrProvider', () => {
  it('normalizes successful runner output and preserves input page order', async () => {
    const seen: { tempDir?: string; manifest?: unknown } = {}
    const runner: PaddleRunner = {
      async run(manifestPath, outputPath) {
        seen.tempDir = dirname(manifestPath)
        seen.manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
        await writeFile(
          outputPath,
          JSON.stringify({
            pages: [
              { pageId: 'page-2', text: 'Second page', confidence: 0.7 },
              { pageId: 'page-1', text: 'First page', confidence: 0.9 },
            ],
          }),
          'utf8',
        )
      },
    }

    const result = await new PaddleLocalOcrProvider(runner).recognize(inputWithPages(['page-1', 'page-2']))

    expect(result).toMatchObject({
      essayGroupId: 'group-1',
      text: 'First page\n\nSecond page',
      provider: 'remote',
      status: 'success',
    })
    expect(result.pages.map((page) => page.confidence)).toEqual([0.9, 0.7])
    expect(JSON.stringify(seen.manifest)).toContain('page-1.png')
    expect(seen.tempDir).toContain('wenjie-paddle-ocr-')
    expect(await exists(seen.tempDir as string)).toBe(false)
  })

  it('keeps page-level paddle failures as partial results', async () => {
    const runner: PaddleRunner = {
      async run(_manifestPath, outputPath) {
        await writeFile(
          outputPath,
          JSON.stringify({
            pages: [
              { pageId: 'page-1', text: '', warnings: ['paddle_page_failed'] },
              { pageId: 'page-2', text: 'Readable page' },
            ],
          }),
          'utf8',
        )
      },
    }

    const result = await new PaddleLocalOcrProvider(runner).recognize(inputWithPages(['page-1', 'page-2']))

    expect(result.status).toBe('partial')
    expect(result.text).toBe('Readable page')
    expect(result.pages[0].warnings).toEqual(['paddle_page_failed', 'empty_text'])
  })

  it('returns an environment message when the runner reports local setup failure', async () => {
    const runner: PaddleRunner = {
      async run() {
        throw new PaddleRunnerError('environment', 'Python command is not available.')
      },
    }

    const result = await new PaddleLocalOcrProvider(runner).recognize(inputWithPages(['page-1']))

    expect(result).toMatchObject({
      status: 'failed',
      text: '',
      pages: [],
      error: 'PaddleOCR 本地环境未就绪，请检查 Python 依赖，或使用 mock 草稿 / 手动输入。',
    })
  })

  it('returns a safe failed result for invalid runner JSON and cleans temp files', async () => {
    let tempDir = ''
    const runner: PaddleRunner = {
      async run(manifestPath, outputPath) {
        tempDir = dirname(manifestPath)
        await writeFile(outputPath, '{invalid-json', 'utf8')
      },
    }

    const result = await new PaddleLocalOcrProvider(runner).recognize(inputWithPages(['page-1']))

    expect(result).toMatchObject({
      status: 'failed',
      error: 'PaddleOCR 识别失败，请使用 mock 草稿或手动输入。',
    })
    expect(await exists(tempDir)).toBe(false)
  })

  it('returns a safe failed result and cleans temp files when the runner times out', async () => {
    let tempDir = ''
    const runner: PaddleRunner = {
      async run(manifestPath) {
        tempDir = dirname(manifestPath)
        throw new PaddleRunnerError('timeout', 'Python runner timed out.')
      },
    }

    const result = await new PaddleLocalOcrProvider(runner).recognize(inputWithPages(['page-1']))

    expect(result).toMatchObject({
      status: 'failed',
      error: 'PaddleOCR 识别失败，请使用 mock 草稿或手动输入。',
    })
    expect(await exists(tempDir)).toBe(false)
  })

  it('does not expose paths, traceback, command args, or environment data in errors', async () => {
    const runner: PaddleRunner = {
      async run() {
        throw new Error('Traceback at C:\\secret\\python.exe --manifest C:\\tmp\\manifest.json SECRET=abc')
      },
    }

    const result = await new PaddleLocalOcrProvider(runner).recognize(inputWithPages(['page-1']))

    expect(result.error).toBe('PaddleOCR 识别失败，请使用 mock 草稿或手动输入。')
    expect(JSON.stringify(result)).not.toContain('Traceback')
    expect(JSON.stringify(result)).not.toContain('C:\\secret')
    expect(JSON.stringify(result)).not.toContain('--manifest')
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test -- src/providers/paddleLocalOcrProvider.test.ts
```

Expected: fails because `paddleLocalOcrProvider.ts` does not exist.

- [ ] **Step 3: Implement `PaddleLocalOcrProvider`**

Create `ocr-gateway/src/providers/paddleLocalOcrProvider.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { normalizeProviderResult } from '../normalizeOcrResult.js'
import type { GatewayPageInput, GatewayRecognizeInput, OcrEssayResult, OcrPageResult } from '../types.js'
import type { OcrProvider } from './providerTypes.js'
import { NodePaddleRunner, PaddleRunnerError, type PaddleRunner } from './paddleRunner.js'

interface PaddleRunnerPageOutput {
  pageId?: unknown
  text?: unknown
  confidence?: unknown
  warnings?: unknown
}

interface PaddleRunnerOutput {
  pages?: unknown
  error?: unknown
  errorCode?: unknown
}

interface PaddleManifestPage {
  pageId: string
  path: string
  originalName: string
  mimeType: string
}

interface PaddleManifest {
  essayGroupId: string
  pages: PaddleManifestPage[]
}

const GENERAL_ERROR = 'PaddleOCR 识别失败，请使用 mock 草稿或手动输入。'
const ENVIRONMENT_ERROR = 'PaddleOCR 本地环境未就绪，请检查 Python 依赖，或使用 mock 草稿 / 手动输入。'

function failedResult(essayGroupId: string, error: string): OcrEssayResult {
  return {
    essayGroupId,
    text: '',
    pages: [],
    provider: 'remote',
    status: 'failed',
    error,
  }
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  return '.png'
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48) || 'page'
}

async function writeManifest(tempDir: string, input: GatewayRecognizeInput): Promise<{ manifestPath: string; outputPath: string }> {
  const manifestPages: PaddleManifestPage[] = []

  for (const [index, page] of input.pages.entries()) {
    const imagePath = join(tempDir, `${index + 1}-${safeSegment(page.pageId)}${extensionForMimeType(page.mimeType)}`)
    await writeFile(imagePath, page.buffer)
    manifestPages.push({
      pageId: page.pageId,
      path: imagePath,
      originalName: basename(page.originalName),
      mimeType: page.mimeType,
    })
  }

  const manifest: PaddleManifest = {
    essayGroupId: input.essayGroupId,
    pages: manifestPages,
  }
  const manifestPath = join(tempDir, 'manifest.json')
  const outputPath = join(tempDir, 'output.json')
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  return { manifestPath, outputPath }
}

function parseWarnings(rawWarnings: unknown) {
  return Array.isArray(rawWarnings) ? rawWarnings.filter((warning): warning is string => typeof warning === 'string') : undefined
}

function parsePageOutput(page: PaddleRunnerPageOutput): OcrPageResult | null {
  if (typeof page.pageId !== 'string') return null

  return {
    pageId: page.pageId,
    text: typeof page.text === 'string' ? page.text : '',
    confidence: typeof page.confidence === 'number' ? page.confidence : undefined,
    warnings: parseWarnings(page.warnings),
  }
}

function parseRunnerOutput(rawText: string): PaddleRunnerOutput {
  return JSON.parse(rawText) as PaddleRunnerOutput
}

function errorMessageForRunnerError(error: unknown) {
  if (error instanceof PaddleRunnerError && error.kind === 'environment') return ENVIRONMENT_ERROR
  return GENERAL_ERROR
}

function isEnvironmentOutput(output: PaddleRunnerOutput) {
  return output.errorCode === 'paddle_environment'
}

export class PaddleLocalOcrProvider implements OcrProvider {
  constructor(
    private readonly runner: PaddleRunner = new NodePaddleRunner(),
    private readonly timeoutMs = Number(process.env.PADDLE_OCR_TIMEOUT_MS ?? 60000),
  ) {}

  async recognize(input: GatewayRecognizeInput): Promise<OcrEssayResult> {
    const tempDir = await mkdtemp(join(tmpdir(), 'wenjie-paddle-ocr-'))

    try {
      const { manifestPath, outputPath } = await writeManifest(tempDir, input)
      await this.runner.run(manifestPath, outputPath, this.timeoutMs)

      const output = parseRunnerOutput(await readFile(outputPath, 'utf8'))
      if (output.error) {
        return failedResult(input.essayGroupId, isEnvironmentOutput(output) ? ENVIRONMENT_ERROR : GENERAL_ERROR)
      }

      const pages = Array.isArray(output.pages)
        ? output.pages.map((page) => parsePageOutput(page as PaddleRunnerPageOutput)).filter((page): page is OcrPageResult => page !== null)
        : []

      return normalizeProviderResult({ input, providerPages: pages })
    } catch (error) {
      return failedResult(input.essayGroupId, errorMessageForRunnerError(error))
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test -- src/providers/paddleLocalOcrProvider.test.ts
```

Expected: all Paddle local provider tests pass.

- [ ] **Step 5: Commit Task 3**

```powershell
git add ocr-gateway/src/providers/paddleLocalOcrProvider.ts ocr-gateway/src/providers/paddleLocalOcrProvider.test.ts
git commit -m "feat: add paddle local ocr provider"
```

---

### Task 4: Wire Provider Selection

**Files:**
- Modify: `ocr-gateway/src/types.ts`
- Modify: `ocr-gateway/src/providers/index.ts`
- Create: `ocr-gateway/src/providers/index.test.ts`

- [ ] **Step 1: Write failing provider selection tests**

Create `ocr-gateway/src/providers/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FailureOcrProvider } from './failureOcrProvider.js'
import { getProvider } from './index.js'
import { MockOcrProvider } from './mockOcrProvider.js'
import { PaddleLocalOcrProvider } from './paddleLocalOcrProvider.js'

describe('getProvider', () => {
  it('defaults to the mock provider', () => {
    expect(getProvider(undefined)).toBeInstanceOf(MockOcrProvider)
  })

  it('selects the controlled failure provider', () => {
    expect(getProvider('mock_failure')).toBeInstanceOf(FailureOcrProvider)
  })

  it('selects the local PaddleOCR provider', () => {
    expect(getProvider('paddle_local')).toBeInstanceOf(PaddleLocalOcrProvider)
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test -- src/providers/index.test.ts
```

Expected: fails because `paddle_local` is not wired.

- [ ] **Step 3: Extend provider type**

In `ocr-gateway/src/types.ts`, change:

```ts
export type GatewayProviderName = 'mock' | 'mock_failure'
```

to:

```ts
export type GatewayProviderName = 'mock' | 'mock_failure' | 'paddle_local'
```

- [ ] **Step 4: Wire `paddle_local` in `getProvider`**

In `ocr-gateway/src/providers/index.ts`, use this implementation:

```ts
import type { GatewayProviderName } from '../types.js'
import { FailureOcrProvider } from './failureOcrProvider.js'
import { MockOcrProvider } from './mockOcrProvider.js'
import { PaddleLocalOcrProvider } from './paddleLocalOcrProvider.js'
import type { OcrProvider } from './providerTypes.js'

export function getProvider(name: string | undefined = process.env.OCR_PROVIDER): OcrProvider {
  const providerName = (name ?? 'mock') as GatewayProviderName

  if (providerName === 'mock_failure') {
    return new FailureOcrProvider()
  }

  if (providerName === 'paddle_local') {
    return new PaddleLocalOcrProvider()
  }

  return new MockOcrProvider()
}
```

- [ ] **Step 5: Run provider tests and server regression tests**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test -- src/providers/index.test.ts src/server.test.ts
```

Expected: provider selection tests pass; existing mock and mock_failure server tests still pass.

- [ ] **Step 6: Commit Task 4**

```powershell
git add ocr-gateway/src/types.ts ocr-gateway/src/providers/index.ts ocr-gateway/src/providers/index.test.ts
git commit -m "feat: wire paddle local provider selection"
```

---

### Task 5: Add Python Runner Script

**Files:**
- Create: `ocr-gateway/scripts/paddle_ocr_runner.py`
- Create: `ocr-gateway/requirements.txt`

- [ ] **Step 1: Add the Python runner script**

Create `ocr-gateway/scripts/paddle_ocr_runner.py`:

```python
import argparse
import json
import sys
from pathlib import Path


def write_json(path, payload):
    Path(path).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def page_failure(page_id):
    return {
        "pageId": page_id,
        "text": "",
        "warnings": ["paddle_page_failed"],
    }


def average_confidence(values):
    numeric = [value for value in values if isinstance(value, (int, float))]
    if not numeric:
        return None
    return sum(numeric) / len(numeric)


def extract_lines(raw_result):
    lines = []
    confidences = []

    if not raw_result:
        return "", None

    for block in raw_result:
        if not isinstance(block, list):
            continue
        for item in block:
            if not isinstance(item, list) or len(item) < 2:
                continue
            text_confidence = item[1]
            if not isinstance(text_confidence, (list, tuple)) or len(text_confidence) < 1:
                continue
            text = text_confidence[0]
            confidence = text_confidence[1] if len(text_confidence) > 1 else None
            if isinstance(text, str) and text.strip():
                lines.append(text.strip())
            if isinstance(confidence, (int, float)):
                confidences.append(float(confidence))

    confidence = average_confidence(confidences)
    return "\n".join(lines), confidence


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--lang", default="en")
    args = parser.parse_args()

    try:
        manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"Failed to read manifest: {exc}", file=sys.stderr)
        write_json(args.output, {"error": "Invalid manifest"})
        return 0

    try:
        from paddleocr import PaddleOCR
    except Exception as exc:
        print(f"PaddleOCR import failed: {exc}", file=sys.stderr)
        write_json(args.output, {"error": "PaddleOCR failed or not installed", "errorCode": "paddle_environment"})
        return 0

    try:
        ocr = PaddleOCR(use_angle_cls=True, lang=args.lang)
    except Exception as exc:
        print(f"PaddleOCR model load failed: {exc}", file=sys.stderr)
        write_json(args.output, {"error": "PaddleOCR failed or not installed", "errorCode": "paddle_environment"})
        return 0

    pages = []
    for page in manifest.get("pages", []):
        page_id = page.get("pageId")
        image_path = page.get("path")
        if not isinstance(page_id, str) or not isinstance(image_path, str):
            continue

        try:
            raw_result = ocr.ocr(image_path, cls=True)
            text, confidence = extract_lines(raw_result)
            page_result = {
                "pageId": page_id,
                "text": text,
                "warnings": [],
            }
            if confidence is not None:
                page_result["confidence"] = confidence
            pages.append(page_result)
        except Exception as exc:
            print(f"PaddleOCR page failed for {page_id}: {exc}", file=sys.stderr)
            pages.append(page_failure(page_id))

    write_json(args.output, {"pages": pages})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Add local Python dependency file**

Create `ocr-gateway/requirements.txt`:

```text
paddleocr>=2.8.1
paddlepaddle>=2.6.0
```

- [ ] **Step 3: Run TypeScript verification**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd run typecheck
```

Expected: TypeScript still compiles. The Python script is not executed by `npm.cmd run typecheck`.

- [ ] **Step 4: Commit Task 5**

```powershell
git add ocr-gateway/scripts/paddle_ocr_runner.py ocr-gateway/requirements.txt
git commit -m "feat: add paddle ocr python runner"
```

---

### Task 6: Update Gateway Configuration and Evaluation Docs

**Files:**
- Modify: `ocr-gateway/.env.example`
- Create: `docs/ocr_provider_evaluation_paddle_v02.md`
- Modify: `docs/current_development_status.md`

- [ ] **Step 1: Update `.env.example`**

Replace `ocr-gateway/.env.example` with:

```env
# Local OCR Gateway configuration.
PORT=8787
OCR_PROVIDER=mock
OCR_TIMEOUT_MS=30000

# Use this for controlled failure testing:
# OCR_PROVIDER=mock_failure

# PaddleOCR local provider.
# This provider is local-only and does not require cloud OCR secrets.
# OCR_PROVIDER=paddle_local
# PADDLE_OCR_PYTHON=python
# PADDLE_OCR_LANG=en
# PADDLE_OCR_TIMEOUT_MS=60000

# Future real provider secrets belong in this Gateway env only.
# Never place provider secrets in app/.env or any VITE_* variable.
# OCR_SECRET_ID=
# OCR_SECRET_KEY=
```

- [ ] **Step 2: Add the PaddleOCR evaluation document**

Create `docs/ocr_provider_evaluation_paddle_v02.md`:

```md
# PaddleOCR 本地 OCR Provider 样本评测 v0.2

## 评测目的

记录 PaddleOCR 对真实学生英语作文图片的识别效果，用于判断它是否适合作为开发期本地 provider，以及是否需要引入云 OCR 或视觉大模型进行对比。

本文件只做评测记录，不做评测页面、dashboard、图表或产品功能。

## 样本范围

计划样本数量：20 - 40 张真实作文图片。

样本分类：

- 清晰字迹
- 一般字迹
- 潦草字迹
- 拍照歪斜
- 光线较暗
- 有涂改
- 多页作文

## 评测维度

- 是否漏行
- 是否乱序
- 单词识别是否可用
- 段落是否保留
- 标点和大小写是否保留
- 潦草字迹表现
- 涂改表现
- 老师需要修改程度
- 是否适合进入后续 AI 批改

## 记录表

| 图片编号 | 字迹类型 | OCR 输出是否完整 | 漏行情况 | 乱序情况 | 明显错词数量 | 是否需要大量人工修改 | 是否可进入 AI 批改 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sample-001 | 清晰字迹 | 未评测 | 未评测 | 未评测 | 未评测 | 未评测 | 未评测 | 待加入样本 |

## 初步结论记录

- PaddleOCR 是否足以作为开发期 provider：未评测。
- 是否需要引入腾讯云 / 百度 / 视觉大模型对比：未评测。
- 是否需要继续优化图片预处理：未评测。
```

- [ ] **Step 3: Update current development status**

Near the top of `docs/current_development_status.md`, after `最后更新：2026-07-04`, update the date to `2026-07-06` and insert:

```md
## 本次新增进展：PaddleOCR 本地真实 OCR Provider 接入 v0.2

- OCR Gateway 新增 `paddle_local` provider，真实 OCR 不再只能走 Gateway mock provider，可通过本地 PaddleOCR runner 尝试识别真实作文图片。
- PaddleOCR provider 仅存在于 Gateway 内部；前端仍然只知道 mock / real OCR，不出现 PaddleOCR、`paddle_local`、`PADDLE_OCR` 或 Python runner 逻辑。
- Node 侧使用 `child_process.spawn` 调用 `scripts/paddle_ocr_runner.py --manifest <manifestPath> --output <outputPath> --lang <lang>`，不使用 `exec`、不拼接 shell 字符串、不使用 `shell: true`。
- PaddleOCR 临时图片、manifest 和 output JSON 都写入 `fs.mkdtemp(os.tmpdir())` 创建的 `wenjie-paddle-ocr-*` 临时目录，并在 `finally` 中清理。
- runner 超时会 kill Python 子进程；Python 命令不存在、PaddleOCR 未安装或模型加载失败时，返回统一环境错误文案，不向前端暴露 traceback、系统路径、命令行参数或环境变量。
- PaddleOCR 结果会转换为统一 `OcrEssayResult`，成功后回填现有 OCR 草稿区；部分页失败时保留 `paddle_page_failed` warning 并由 normalize 决定 partial / failed / success。
- OCR 失败时仍支持 mock 草稿、手动输入和重试。
- 新增 `docs/ocr_provider_evaluation_paddle_v02.md` 作为样本评测记录；本轮不做评测页面、dashboard、图表或产品功能。
- 本轮不做真实 AI 批改，不做 OCR 坐标，不做原卷图片高亮，不做 PDF / Word / 文件夹解析，不接扫描仪、摄像头或希沃展台。
```

- [ ] **Step 4: Commit Task 6**

```powershell
git add ocr-gateway/.env.example docs/ocr_provider_evaluation_paddle_v02.md docs/current_development_status.md
git commit -m "docs: document paddle local ocr evaluation"
```

---

### Task 7: Verification and Safety Scan

**Files:**
- Verify only; no planned source edits.

- [ ] **Step 1: Run Gateway tests**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test
npm.cmd run typecheck
```

Expected:

- All Gateway tests pass.
- TypeScript typecheck passes.
- No test requires real PaddleOCR installation.

- [ ] **Step 2: Run frontend OCR regression tests**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/services/ocr
npm.cmd test -- src/pages/UploadPage.test.tsx
```

Expected:

- Existing frontend OCR service tests pass.
- UploadPage real OCR success/failure/fallback tests pass.
- No PaddleOCR-specific UI appears.

- [ ] **Step 3: Run full frontend verification**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected:

- Full frontend test suite passes.
- Lint passes.
- Build passes.

- [ ] **Step 4: Run provider-specific frontend safety scan**

Run:

```powershell
cd D:\wenjie-writewise-ai
rg "PaddleOCR|paddle_local|PADDLE_OCR|Python runner|paddle_ocr_runner|OCR_SECRET|OCR_API_KEY|OPENAI_API_KEY|TENCENT|BAIDU" app/src --glob "!**/*.test.*"
```

Expected: no output. `app/src` production code must not contain PaddleOCR, `paddle_local`, `PADDLE_OCR`, Python runner details, or cloud OCR secrets.

- [ ] **Step 5: Run Gateway implementation safety scan**

Run:

```powershell
cd D:\wenjie-writewise-ai
rg "exec\\(|shell:\\s*true|from 'node:child_process'|from \"node:child_process\"" ocr-gateway/src
```

Expected:

- No `exec(` output.
- No `shell: true` output.
- `child_process` import appears only in `ocr-gateway/src/providers/paddleRunner.ts`.

- [ ] **Step 6: Inspect git status**

Run:

```powershell
cd D:\wenjie-writewise-ai
git status --short --branch
```

Expected: only intentional committed work; no `.env`, `node_modules`, temporary OCR files, or `app/dist` are staged or untracked.

---

### Task 8: Optional Local PaddleOCR Smoke Test

**Files:**
- Verify only; no planned source edits.

This task is optional and depends on local Python/PaddleOCR availability. It is not required for `npm.cmd test`.

- [ ] **Step 1: Install Python dependencies only if local smoke testing is desired**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
python -m pip install -r requirements.txt
```

Expected: PaddleOCR dependencies install in the active Python environment. If installation fails, skip this optional smoke test and keep automated verification as the source of truth.

- [ ] **Step 2: Start Gateway in Paddle mode**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
$env:OCR_PROVIDER='paddle_local'
$env:PADDLE_OCR_PYTHON='python'
$env:PADDLE_OCR_LANG='en'
npm.cmd run dev
```

Expected: Gateway starts at `http://localhost:8787`.

- [ ] **Step 3: Start frontend in real OCR mode**

Run in another terminal:

```powershell
cd D:\wenjie-writewise-ai\app
$env:VITE_OCR_MODE='real'
$env:VITE_OCR_API_BASE='http://localhost:8787'
npm.cmd run dev
```

Expected: Vite starts, usually at `http://localhost:5173`.

- [ ] **Step 4: Manually verify the user flow**

Open `/tasks/task-1/upload` and verify:

- Upload one real English essay image.
- Organize the essay group.
- Select real OCR.
- Start OCR recognition.
- On success, OCR draft is filled with PaddleOCR text and remains editable.
- On local environment failure, the UI shows the safe error and still offers mock draft or manual input.
- Confirm OCR text sends the essay into the existing progress queue.

---

## Final Handoff Checklist

- [ ] `ocr-gateway` tests pass.
- [ ] `ocr-gateway` typecheck passes.
- [ ] frontend OCR service tests pass.
- [ ] `UploadPage` tests pass.
- [ ] frontend full tests pass.
- [ ] frontend lint passes.
- [ ] frontend build passes.
- [ ] Safety scan confirms provider-specific logic is absent from `app/src` production code.
- [ ] Safety scan confirms no `exec(` or `shell: true` in `ocr-gateway/src`.
- [ ] `docs/ocr_provider_evaluation_paddle_v02.md` exists and is documentation only.
- [ ] `docs/current_development_status.md` reflects PaddleOCR v0.2.
- [ ] No `.env`, `node_modules`, temp OCR files, or build output are staged.
