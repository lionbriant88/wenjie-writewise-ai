# 真实 OCR Gateway 接入 v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe real-OCR-shaped loop where UploadPage can call a local OCR Gateway, receive unified OCR JSON, fill editable OCR drafts, and fall back to mock/manual input on failure.

**Architecture:** Keep OCR concerns out of `UploadPage` by adding a focused frontend OCR service layer. Add a separate minimal `ocr-gateway` Node/Express service with memory-only multipart handling, `mock` and `mock_failure` providers, input limits, and unified responses. Preserve the existing upload grouping, editable OCR drafts, and confirm-to-progress queue flow.

**Tech Stack:** React 19, Vite 8, TypeScript, Vitest, React Testing Library, Node/Express, multer memory storage, supertest.

---

## Scope Guard

This plan implements the v0.1 contract only:

- Real OCR mode calls Gateway, but Gateway initially uses `mock` provider.
- UI and docs must describe this as “real OCR 链路测试，当前 Gateway 使用 mock provider”, not as a real vendor OCR integration.
- Gateway has `mock_failure` provider for stable failure tests.
- No real Tencent/Baidu/OpenAI/PaddleOCR/vision LLM adapter is created in v0.1.
- No provider SDK or provider-specific request/response mapping appears under `app/src`.
- No file persistence, database writes, object storage, PDF parsing, scanner/camera/Seewo, OCR coordinates, or real AI grading.

## File Structure

### Frontend

- Create `app/src/services/ocr/types.ts`
  Defines `OcrMode`, `OcrRunStatus`, request/response types, and the `OcrClient` interface.

- Create `app/src/services/ocr/mockOcrClient.ts`
  Generates unified OCR results from current essay groups and page order.

- Create `app/src/services/ocr/normalizeOcrResult.ts`
  Normalizes OCR page results, preserves request order, detects empty text, and produces draft strings.

- Create `app/src/services/ocr/remoteOcrClient.ts`
  Calls `VITE_OCR_API_BASE` with `FormData`, translates network/config errors into unified failed results.

- Create `app/src/services/ocr/ocrClient.ts`
  Picks mock or remote client using non-secret `VITE_OCR_MODE` and explicit page UI mode.

- Create tests under `app/src/services/ocr/*.test.ts`.

- Modify `app/src/pages/UploadPage.tsx`
  Replaces local mock-only OCR state with OCR mode/status/error/draft state, adds real/mock controls, failure fallback, empty-text warning, and keeps confirm flow unchanged.

- Modify `app/src/pages/UploadPage.test.tsx`
  Adds real OCR link-test success/failure/empty text tests while preserving current mock OCR tests.

### Gateway

- Create `ocr-gateway/package.json`
  Separate minimal package for the local Gateway.

- Create `ocr-gateway/tsconfig.json`
  TypeScript config for Node service and tests.

- Create `ocr-gateway/src/types.ts`
  Shared Gateway request/result types and constants.

- Create `ocr-gateway/src/normalizeOcrResult.ts`
  Gateway-side normalization for provider results.

- Create `ocr-gateway/src/providers/providerTypes.ts`
  Defines the provider adapter interface.

- Create `ocr-gateway/src/providers/mockOcrProvider.ts`
  Returns deterministic OCR text for uploaded pages.

- Create `ocr-gateway/src/providers/failureOcrProvider.ts`
  Returns controlled failed results.

- Create `ocr-gateway/src/providers/index.ts`
  Selects `mock` or `mock_failure` provider from `OCR_PROVIDER`.

- Create `ocr-gateway/src/server.ts`
  Express app with `GET /health` and `POST /ocr/recognize`, multer memory storage, MIME/size/page limits, and unified error responses.

- Create `ocr-gateway/src/index.ts`
  Starts the server.

- Create Gateway tests under `ocr-gateway/src/**/*.test.ts`.

## Implementation Tasks

### Task 1: Create Gateway Package Skeleton

**Files:**
- Create: `ocr-gateway/package.json`
- Create: `ocr-gateway/tsconfig.json`
- Create: `ocr-gateway/src/types.ts`
- Create: `ocr-gateway/src/server.ts`
- Create: `ocr-gateway/src/index.ts`
- Test: `ocr-gateway/src/server.test.ts`

- [ ] **Step 1: Create the Gateway package manifest**

Create `ocr-gateway/package.json`:

```json
{
  "name": "ocr-gateway",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "multer": "^1.4.5-lts.1"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/multer": "^1.4.12",
    "@types/node": "^24.13.2",
    "@types/supertest": "^6.0.3",
    "supertest": "^7.0.0",
    "tsx": "^4.19.2",
    "typescript": "~6.0.2",
    "vitest": "^4.1.9"
  }
}
```

- [ ] **Step 2: Install Gateway dependencies**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd install
```

Expected:

- `ocr-gateway/node_modules` exists locally.
- `ocr-gateway/package-lock.json` is created.
- No dependency is added to `app/package.json`.

- [ ] **Step 3: Create TypeScript config**

Create `ocr-gateway/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "types": ["node", "vitest"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Define initial Gateway types and constants**

Create `ocr-gateway/src/types.ts`:

```ts
export const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024
export const MAX_PAGES_PER_REQUEST = 10

export const allowedImageMimeTypes = ['image/png', 'image/jpeg', 'image/webp'] as const

export type AllowedImageMimeType = (typeof allowedImageMimeTypes)[number]
export type GatewayProviderName = 'mock' | 'mock_failure'
export type OcrProviderName = 'mock' | 'remote'
export type OcrStatus = 'success' | 'partial' | 'failed'

export interface GatewayPageInput {
  pageId: string
  originalName: string
  mimeType: string
  size: number
  buffer: Buffer
}

export interface GatewayRecognizeInput {
  essayGroupId: string
  pages: GatewayPageInput[]
}

export interface OcrPageResult {
  pageId: string
  text: string
  confidence?: number
  warnings?: string[]
}

export interface OcrEssayResult {
  essayGroupId: string
  text: string
  pages: OcrPageResult[]
  provider: OcrProviderName
  status: OcrStatus
  error?: string
}

export interface OcrGatewayResponse {
  results: OcrEssayResult[]
}
```

- [ ] **Step 5: Write failing health-check test**

Create `ocr-gateway/src/server.test.ts`:

```ts
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createServer } from './server.js'

describe('ocr gateway server', () => {
  it('responds to health checks', async () => {
    const app = createServer()

    const response = await request(app).get('/health').expect(200)

    expect(response.body).toEqual({ ok: true, service: 'ocr-gateway' })
  })
})
```

- [ ] **Step 6: Run Gateway test to verify it fails**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test -- src/server.test.ts
```

Expected:

- FAIL because `ocr-gateway/src/server.ts` does not export `createServer`.

- [ ] **Step 7: Implement minimal server and entrypoint**

Create `ocr-gateway/src/server.ts`:

```ts
import cors from 'cors'
import express from 'express'

export function createServer() {
  const app = express()

  app.use(cors())

  app.get('/health', (_request, response) => {
    response.json({ ok: true, service: 'ocr-gateway' })
  })

  return app
}
```

Create `ocr-gateway/src/index.ts`:

```ts
import { createServer } from './server.js'

const port = Number(process.env.PORT ?? 8787)
const app = createServer()

app.listen(port, () => {
  console.log(`OCR Gateway listening on http://localhost:${port}`)
})
```

- [ ] **Step 8: Verify Gateway skeleton**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test -- src/server.test.ts
npm.cmd run typecheck
```

Expected:

- Health-check test passes.
- Typecheck passes.

- [ ] **Step 9: Commit Gateway skeleton**

Run:

```powershell
cd D:\wenjie-writewise-ai
git add ocr-gateway
git commit -m "feat: add ocr gateway skeleton"
```

Expected:

- Commit includes only `ocr-gateway/package.json`, `ocr-gateway/package-lock.json`, `ocr-gateway/tsconfig.json`, and the initial `src` files.

### Task 2: Add Gateway Providers, Normalization, and Input Limits

**Files:**
- Create: `ocr-gateway/src/providers/providerTypes.ts`
- Create: `ocr-gateway/src/providers/mockOcrProvider.ts`
- Create: `ocr-gateway/src/providers/failureOcrProvider.ts`
- Create: `ocr-gateway/src/providers/index.ts`
- Create: `ocr-gateway/src/normalizeOcrResult.ts`
- Modify: `ocr-gateway/src/server.ts`
- Test: `ocr-gateway/src/normalizeOcrResult.test.ts`
- Test: `ocr-gateway/src/server.test.ts`

- [ ] **Step 1: Add failing normalization tests**

Create `ocr-gateway/src/normalizeOcrResult.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalizeProviderResult } from './normalizeOcrResult.js'
import type { GatewayRecognizeInput, OcrPageResult } from './types.js'

function inputWithPages(pageIds: string[]): GatewayRecognizeInput {
  return {
    essayGroupId: 'group-1',
    pages: pageIds.map((pageId) => ({
      pageId,
      originalName: `${pageId}.png`,
      mimeType: 'image/png',
      size: 12,
      buffer: Buffer.from('fake-image'),
    })),
  }
}

describe('normalizeProviderResult', () => {
  it('merges text by request page order instead of provider result order', () => {
    const result = normalizeProviderResult({
      input: inputWithPages(['page-b', 'page-a']),
      providerPages: [
        { pageId: 'page-a', text: 'Second page text' },
        { pageId: 'page-b', text: 'First page text' },
      ],
    })

    expect(result.text).toBe('First page text\n\nSecond page text')
    expect(result.pages.map((page) => page.pageId)).toEqual(['page-b', 'page-a'])
  })

  it('adds an empty-text warning without failing the whole result', () => {
    const result = normalizeProviderResult({
      input: inputWithPages(['page-1']),
      providerPages: [{ pageId: 'page-1', text: '   ' }],
    })

    expect(result.status).toBe('success')
    expect(result.text).toBe('')
    expect(result.pages[0].warnings).toContain('empty_text')
  })

  it('returns partial when one requested page is missing', () => {
    const result = normalizeProviderResult({
      input: inputWithPages(['page-1', 'page-2']),
      providerPages: [{ pageId: 'page-1', text: 'Recognized text' }],
    })

    expect(result.status).toBe('partial')
    expect(result.pages[1]).toEqual({
      pageId: 'page-2',
      text: '',
      warnings: ['page_not_recognized', 'empty_text'],
    } satisfies OcrPageResult)
  })
})
```

- [ ] **Step 2: Run normalization tests to verify they fail**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test -- src/normalizeOcrResult.test.ts
```

Expected:

- FAIL because `normalizeOcrResult.ts` does not exist.

- [ ] **Step 3: Implement Gateway normalization**

Create `ocr-gateway/src/normalizeOcrResult.ts`:

```ts
import type { GatewayRecognizeInput, OcrEssayResult, OcrPageResult } from './types.js'

interface NormalizeProviderResultInput {
  input: GatewayRecognizeInput
  providerPages: OcrPageResult[]
}

function normalizeText(text: string | undefined) {
  return (text ?? '').trim()
}

export function normalizeProviderResult({
  input,
  providerPages,
}: NormalizeProviderResultInput): OcrEssayResult {
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

  const missingPageCount = pages.filter((page) => page.warnings?.includes('page_not_recognized')).length
  const status = missingPageCount === 0 ? 'success' : missingPageCount === pages.length ? 'failed' : 'partial'

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

- [ ] **Step 4: Add provider interface and mock/failure providers**

Create `ocr-gateway/src/providers/providerTypes.ts`:

```ts
import type { GatewayRecognizeInput, OcrEssayResult } from '../types.js'

export interface OcrProvider {
  recognize(input: GatewayRecognizeInput): Promise<OcrEssayResult>
}
```

Create `ocr-gateway/src/providers/mockOcrProvider.ts`:

```ts
import { normalizeProviderResult } from '../normalizeOcrResult.js'
import type { GatewayRecognizeInput } from '../types.js'
import type { OcrProvider } from './providerTypes.js'

export class MockOcrProvider implements OcrProvider {
  async recognize(input: GatewayRecognizeInput) {
    return normalizeProviderResult({
      input,
      providerPages: input.pages.map((page, index) => ({
        pageId: page.pageId,
        text: [
          `作文图片 ${index + 1}：${page.originalName}`,
          'Dear Sir or Madam,',
          'I am writing to share my suggestion for this activity.',
          'I believe it will help students improve their English writing.',
        ].join('\n'),
        confidence: 0.88,
      })),
    })
  }
}
```

Create `ocr-gateway/src/providers/failureOcrProvider.ts`:

```ts
import type { GatewayRecognizeInput, OcrEssayResult } from '../types.js'
import type { OcrProvider } from './providerTypes.js'

export class FailureOcrProvider implements OcrProvider {
  async recognize(input: GatewayRecognizeInput): Promise<OcrEssayResult> {
    return {
      essayGroupId: input.essayGroupId,
      text: '',
      pages: input.pages.map((page) => ({
        pageId: page.pageId,
        text: '',
        warnings: ['mock_failure'],
      })),
      provider: 'remote',
      status: 'failed',
      error: 'OCR Gateway mock failure: 请使用 mock 草稿或手动输入。',
    }
  }
}
```

Create `ocr-gateway/src/providers/index.ts`:

```ts
import type { GatewayProviderName } from '../types.js'
import { FailureOcrProvider } from './failureOcrProvider.js'
import { MockOcrProvider } from './mockOcrProvider.js'
import type { OcrProvider } from './providerTypes.js'

export function getProvider(name: string | undefined = process.env.OCR_PROVIDER): OcrProvider {
  const providerName = (name ?? 'mock') as GatewayProviderName

  if (providerName === 'mock_failure') {
    return new FailureOcrProvider()
  }

  return new MockOcrProvider()
}
```

- [ ] **Step 5: Verify provider and normalization tests**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test -- src/normalizeOcrResult.test.ts
```

Expected:

- All normalization tests pass.

- [ ] **Step 6: Extend server tests for OCR success, failure, and limits**

Replace `ocr-gateway/src/server.test.ts` with:

```ts
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_SIZE_BYTES } from './types.js'
import { createServer } from './server.js'

function imageBuffer(size = 16) {
  return Buffer.alloc(size, 1)
}

describe('ocr gateway server', () => {
  it('responds to health checks', async () => {
    const app = createServer()

    const response = await request(app).get('/health').expect(200)

    expect(response.body).toEqual({ ok: true, service: 'ocr-gateway' })
  })

  it('recognizes images with the mock provider', async () => {
    const app = createServer({ providerName: 'mock' })

    const response = await request(app)
      .post('/ocr/recognize')
      .field('essayGroupId', 'group-1')
      .field('pageIds', JSON.stringify(['page-1']))
      .attach('pages', imageBuffer(), { filename: 'essay.png', contentType: 'image/png' })
      .expect(200)

    expect(response.body.results[0].status).toBe('success')
    expect(response.body.results[0].text).toContain('作文图片 1：essay.png')
  })

  it('returns a controlled failure with the failure provider', async () => {
    const app = createServer({ providerName: 'mock_failure' })

    const response = await request(app)
      .post('/ocr/recognize')
      .field('essayGroupId', 'group-1')
      .field('pageIds', JSON.stringify(['page-1']))
      .attach('pages', imageBuffer(), { filename: 'essay.png', contentType: 'image/png' })
      .expect(200)

    expect(response.body.results[0]).toMatchObject({
      essayGroupId: 'group-1',
      status: 'failed',
      error: 'OCR Gateway mock failure: 请使用 mock 草稿或手动输入。',
    })
  })

  it('rejects unsupported file types with a unified failed result', async () => {
    const app = createServer()

    const response = await request(app)
      .post('/ocr/recognize')
      .field('essayGroupId', 'group-1')
      .field('pageIds', JSON.stringify(['page-1']))
      .attach('pages', Buffer.from('pdf'), { filename: 'essay.pdf', contentType: 'application/pdf' })
      .expect(400)

    expect(response.body.results[0]).toMatchObject({
      essayGroupId: 'group-1',
      status: 'failed',
      error: '仅支持 PNG、JPEG 或 WebP 图片。',
    })
  })

  it('rejects oversized images with a unified failed result', async () => {
    const app = createServer()

    const response = await request(app)
      .post('/ocr/recognize')
      .field('essayGroupId', 'group-1')
      .field('pageIds', JSON.stringify(['page-1']))
      .attach('pages', imageBuffer(MAX_IMAGE_SIZE_BYTES + 1), {
        filename: 'large.png',
        contentType: 'image/png',
      })
      .expect(400)

    expect(response.body.results[0].error).toBe('单张图片不能超过 8MB。')
  })

  it('rejects requests that exceed the page limit', async () => {
    const app = createServer()
    const requestBuilder = request(app)
      .post('/ocr/recognize')
      .field('essayGroupId', 'group-1')
      .field('pageIds', JSON.stringify(Array.from({ length: 11 }, (_, index) => `page-${index + 1}`)))

    for (let index = 0; index < 11; index += 1) {
      requestBuilder.attach('pages', imageBuffer(), { filename: `essay-${index}.png`, contentType: 'image/png' })
    }

    const response = await requestBuilder.expect(400)

    expect(response.body.results[0].error).toBe('单次 OCR 最多支持 10 页图片。')
  })

  it('returns a unified failed result when the provider throws', async () => {
    const app = createServer({ providerName: 'throws_for_test' })

    const response = await request(app)
      .post('/ocr/recognize')
      .field('essayGroupId', 'group-1')
      .field('pageIds', JSON.stringify(['page-1']))
      .attach('pages', imageBuffer(), { filename: 'essay.png', contentType: 'image/png' })
      .expect(200)

    expect(response.body.results[0]).toMatchObject({
      essayGroupId: 'group-1',
      status: 'failed',
      error: 'OCR 识别服务暂时不可用，请使用 mock 草稿或手动输入。',
    })
    expect(JSON.stringify(response.body)).not.toContain('SECRET')
    expect(JSON.stringify(response.body)).not.toContain('stack')
  })
})
```

- [ ] **Step 7: Run server tests to verify they fail before router implementation**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test -- src/server.test.ts
```

Expected:

- Health test passes.
- OCR endpoint tests fail because `/ocr/recognize` is not implemented.

- [ ] **Step 8: Implement Gateway OCR route**

Replace `ocr-gateway/src/server.ts` with:

```ts
import cors from 'cors'
import express from 'express'
import multer from 'multer'
import { getProvider } from './providers/index.js'
import {
  allowedImageMimeTypes,
  MAX_IMAGE_SIZE_BYTES,
  MAX_PAGES_PER_REQUEST,
  type GatewayPageInput,
  type OcrEssayResult,
} from './types.js'

interface CreateServerOptions {
  providerName?: string
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_SIZE_BYTES + 1,
    files: MAX_PAGES_PER_REQUEST + 1,
  },
})

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

function getMulterErrorMessage(error: multer.MulterError) {
  if (error.code === 'LIMIT_FILE_SIZE') return '单张图片不能超过 8MB。'
  if (error.code === 'LIMIT_FILE_COUNT') return '单次 OCR 最多支持 10 页图片。'
  return 'OCR Gateway 请求处理失败。'
}

function parsePageIds(rawPageIds: unknown) {
  if (typeof rawPageIds !== 'string') return []

  try {
    const parsed = JSON.parse(rawPageIds) as unknown
    return Array.isArray(parsed) ? parsed.filter((pageId): pageId is string => typeof pageId === 'string') : []
  } catch {
    return []
  }
}

function validateFiles(files: Express.Multer.File[], essayGroupId: string): OcrEssayResult | null {
  if (files.length > MAX_PAGES_PER_REQUEST) {
    return failedResult(essayGroupId, '单次 OCR 最多支持 10 页图片。')
  }

  const unsupportedFile = files.find((file) => !allowedImageMimeTypes.includes(file.mimetype as never))
  if (unsupportedFile) {
    return failedResult(essayGroupId, '仅支持 PNG、JPEG 或 WebP 图片。')
  }

  const oversizedFile = files.find((file) => file.size > MAX_IMAGE_SIZE_BYTES)
  if (oversizedFile) {
    return failedResult(essayGroupId, '单张图片不能超过 8MB。')
  }

  return null
}

export function createServer(options: CreateServerOptions = {}) {
  const app = express()

  app.use(cors())

  app.get('/health', (_request, response) => {
    response.json({ ok: true, service: 'ocr-gateway' })
  })

  app.post('/ocr/recognize', upload.array('pages', MAX_PAGES_PER_REQUEST + 1), async (request, response) => {
    const essayGroupId = typeof request.body.essayGroupId === 'string' ? request.body.essayGroupId : 'unknown-group'
    const files = (request.files ?? []) as Express.Multer.File[]
    const pageIds = parsePageIds(request.body.pageIds)

    const validationError = validateFiles(files, essayGroupId)
    if (validationError) {
      response.status(400).json({ results: [validationError] })
      return
    }

    if (files.length === 0 || files.length !== pageIds.length) {
      response.status(400).json({ results: [failedResult(essayGroupId, '图片数量与页面 ID 数量不一致。')] })
      return
    }

    const pages: GatewayPageInput[] = files.map((file, index) => ({
      pageId: pageIds[index],
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    }))

    try {
      const provider = getProvider(options.providerName)
      if (options.providerName === 'throws_for_test') {
        throw new Error('provider stack with SECRET_SHOULD_NOT_LEAK')
      }
      const result = await provider.recognize({ essayGroupId, pages })
      response.json({ results: [result] })
    } catch {
      response.json({
        results: [failedResult(essayGroupId, 'OCR 识别服务暂时不可用，请使用 mock 草稿或手动输入。')],
      })
    }
  })

  app.use((error: unknown, request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const essayGroupId = typeof request.body?.essayGroupId === 'string' ? request.body.essayGroupId : 'unknown-group'
    const message = error instanceof multer.MulterError ? getMulterErrorMessage(error) : 'OCR Gateway 请求处理失败。'
    response.status(400).json({ results: [failedResult(essayGroupId, message)] })
  })

  return app
}
```

- [ ] **Step 9: Verify Gateway OCR route**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test
npm.cmd run typecheck
```

Expected:

- All Gateway tests pass.
- Typecheck passes.

- [ ] **Step 10: Commit Gateway provider and route**

Run:

```powershell
cd D:\wenjie-writewise-ai
git add ocr-gateway
git commit -m "feat: add gateway mock ocr providers"
```

Expected:

- Commit contains Gateway provider, normalization, route, and tests.

### Task 3: Add Frontend OCR Service Layer

**Files:**
- Create: `app/src/services/ocr/types.ts`
- Create: `app/src/services/ocr/normalizeOcrResult.ts`
- Create: `app/src/services/ocr/mockOcrClient.ts`
- Create: `app/src/services/ocr/remoteOcrClient.ts`
- Create: `app/src/services/ocr/ocrClient.ts`
- Test: `app/src/services/ocr/normalizeOcrResult.test.ts`
- Test: `app/src/services/ocr/mockOcrClient.test.ts`
- Test: `app/src/services/ocr/remoteOcrClient.test.ts`

- [ ] **Step 1: Write failing frontend normalization tests**

Create `app/src/services/ocr/normalizeOcrResult.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildOcrDraftsFromResults, normalizeOcrResult } from './normalizeOcrResult'

describe('frontend OCR normalization', () => {
  it('keeps Gateway result text and exposes empty-text warnings', () => {
    const result = normalizeOcrResult({
      essayGroupId: 'group-1',
      text: '',
      pages: [{ pageId: 'page-1', text: '', warnings: ['empty_text'] }],
      provider: 'remote',
      status: 'success',
    })

    expect(result.text).toBe('')
    expect(result.warnings).toContain('empty_text')
  })

  it('builds editable drafts in visible group order', () => {
    const drafts = buildOcrDraftsFromResults(
      [
        { essayGroupId: 'group-2', text: 'Second visible draft', pages: [], provider: 'remote', status: 'success' },
        { essayGroupId: 'group-1', text: 'First visible draft', pages: [], provider: 'remote', status: 'success' },
      ],
      ['group-1', 'group-2'],
    )

    expect(drafts).toEqual(['First visible draft', 'Second visible draft'])
  })
})
```

- [ ] **Step 2: Run frontend normalization tests to verify they fail**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/services/ocr/normalizeOcrResult.test.ts
```

Expected:

- FAIL because service files do not exist.

- [ ] **Step 3: Add frontend OCR types**

Create `app/src/services/ocr/types.ts`:

```ts
import type { EssayPage } from '../../types'
import type { UploadEssayGroup } from '../../utils/essayGrouping'

export type OcrMode = 'mock' | 'real'
export type OcrRunStatus = 'idle' | 'running' | 'success' | 'failed'
export type OcrProviderName = 'mock' | 'remote'
export type OcrStatus = 'success' | 'partial' | 'failed'

export interface OcrPageResult {
  pageId: string
  text: string
  confidence?: number
  warnings?: string[]
}

export interface OcrEssayResult {
  essayGroupId: string
  text: string
  pages: OcrPageResult[]
  provider: OcrProviderName
  status: OcrStatus
  error?: string
  warnings?: string[]
}

export interface OcrGatewayResponse {
  results: OcrEssayResult[]
}

export interface OcrPageInput {
  page: EssayPage
  file?: File
}

export interface OcrEssayInput {
  essayGroupId: string
  pages: OcrPageInput[]
}

export interface OcrRunInput {
  groups: UploadEssayGroup[]
  getGroupPages: (group: UploadEssayGroup) => EssayPage[]
  getPageFile: (pageId: string) => File | undefined
  pageOrderIndex: Map<string, number>
}

export interface OcrClient {
  recognize(input: OcrRunInput): Promise<OcrEssayResult[]>
}
```

- [ ] **Step 4: Add frontend normalization implementation**

Create `app/src/services/ocr/normalizeOcrResult.ts`:

```ts
import type { OcrEssayResult } from './types'

export function normalizeOcrResult(result: OcrEssayResult): OcrEssayResult {
  const pageWarnings = result.pages.flatMap((page) => page.warnings ?? [])
  const warnings = [...new Set([...(result.warnings ?? []), ...pageWarnings])]

  return {
    ...result,
    text: (result.text ?? '').trim(),
    pages: result.pages.map((page) => ({
      ...page,
      text: (page.text ?? '').trim(),
    })),
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

export function buildOcrDraftsFromResults(results: OcrEssayResult[], visibleGroupIds: string[]) {
  const resultByGroupId = new Map(results.map((result) => [result.essayGroupId, normalizeOcrResult(result)]))

  return visibleGroupIds.map((groupId) => resultByGroupId.get(groupId)?.text ?? '')
}

export function hasEmptyTextWarning(results: OcrEssayResult[]) {
  return results.some((result) => normalizeOcrResult(result).warnings?.includes('empty_text'))
}
```

- [ ] **Step 5: Verify frontend normalization**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/services/ocr/normalizeOcrResult.test.ts
```

Expected:

- All normalization tests pass.

- [ ] **Step 6: Write failing mock OCR client test**

Create `app/src/services/ocr/mockOcrClient.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { EssayPage } from '../../types'
import type { UploadEssayGroup } from '../../utils/essayGrouping'
import { mockOcrClient } from './mockOcrClient'

const pages: EssayPage[] = [
  { id: 'page-2', label: 'Second.png', pageNumber: 2, quality: 'clear', accent: '#2563eb' },
  { id: 'page-1', label: 'First.png', pageNumber: 1, quality: 'clear', accent: '#2563eb' },
]

const groups: UploadEssayGroup[] = [{ id: 'group-1', pageIds: ['page-1', 'page-2'] }]

describe('mockOcrClient', () => {
  it('returns unified OCR results in group page order', async () => {
    const pageMap = new Map(pages.map((page) => [page.id, page]))
    const result = await mockOcrClient.recognize({
      groups,
      getGroupPages: (group) => group.pageIds.map((pageId) => pageMap.get(pageId)).filter((page): page is EssayPage => Boolean(page)),
      getPageFile: () => undefined,
      pageOrderIndex: new Map([
        ['page-2', 0],
        ['page-1', 1],
      ]),
    })

    expect(result[0].provider).toBe('mock')
    expect(result[0].text).toContain('作文图片 1：First.png')
    expect(result[0].text).toContain('作文图片 2：Second.png')
    expect(result[0].pages.map((page) => page.pageId)).toEqual(['page-1', 'page-2'])
  })
})
```

- [ ] **Step 7: Implement mock OCR client**

Create `app/src/services/ocr/mockOcrClient.ts`:

```ts
import type { EssayPage } from '../../types'
import type { OcrClient, OcrEssayResult } from './types'

function buildPageOcrDraft(page: EssayPage, index: number) {
  return [
    `作文图片 ${index + 1}：${page.label}`,
    'Dear Sir or Madam,',
    'I am writing to share my suggestion for this activity.',
    'I believe it will help students improve their English writing.',
  ].join('\n')
}

export const mockOcrClient: OcrClient = {
  async recognize(input) {
    return input.groups.map((group): OcrEssayResult => {
      const pages = input.getGroupPages(group)
      const pageResults = pages.map((page, index) => ({
        pageId: page.id,
        text: buildPageOcrDraft(page, index),
        confidence: 0.88,
      }))

      return {
        essayGroupId: group.id,
        text: pageResults.map((page) => page.text).join('\n\n'),
        pages: pageResults,
        provider: 'mock',
        status: 'success',
      }
    })
  },
}
```

- [ ] **Step 8: Write remote OCR client tests**

Create `app/src/services/ocr/remoteOcrClient.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EssayPage } from '../../types'
import type { UploadEssayGroup } from '../../utils/essayGrouping'
import { createRemoteOcrClient } from './remoteOcrClient'

const page: EssayPage = {
  id: 'page-1',
  label: 'essay.png',
  pageNumber: 1,
  quality: 'clear',
  accent: '#2563eb',
}

const file = new File(['image'], 'essay.png', { type: 'image/png' })
const groups: UploadEssayGroup[] = [{ id: 'group-1', pageIds: ['page-1'] }]

function input() {
  return {
    groups,
    getGroupPages: () => [page],
    getPageFile: () => file,
    pageOrderIndex: new Map([['page-1', 0]]),
  }
}

describe('remote OCR client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns normalized Gateway results on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            results: [
              {
                essayGroupId: 'group-1',
                text: 'Recognized text',
                pages: [{ pageId: 'page-1', text: 'Recognized text' }],
                provider: 'remote',
                status: 'success',
              },
            ],
          }),
      })),
    )

    const result = await createRemoteOcrClient('http://localhost:8787').recognize(input())

    expect(result[0].text).toBe('Recognized text')
    expect(fetch).toHaveBeenCalledWith('http://localhost:8787/ocr/recognize', expect.objectContaining({ method: 'POST' }))
  })

  it('returns a failed result when Gateway base URL is missing', async () => {
    const result = await createRemoteOcrClient('').recognize(input())

    expect(result[0]).toMatchObject({
      essayGroupId: 'group-1',
      status: 'failed',
      error: '当前 real OCR 未配置 Gateway。请配置 VITE_OCR_API_BASE，或使用 mock 草稿 / 手动输入。',
    })
  })

  it('returns a failed result when a page has no File object', async () => {
    const result = await createRemoteOcrClient('http://localhost:8787').recognize({
      ...input(),
      getPageFile: () => undefined,
    })

    expect(result[0].status).toBe('failed')
    expect(result[0].error).toBe('当前图片缺少可上传文件，请使用 mock 草稿或手动输入。')
  })

  it('returns a failed result when Gateway responds with non-JSON content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        text: async () => '<html>bad gateway</html>',
      })),
    )

    const result = await createRemoteOcrClient('http://localhost:8787').recognize(input())

    expect(result[0]).toMatchObject({
      essayGroupId: 'group-1',
      status: 'failed',
      error: 'OCR Gateway 返回异常响应。',
    })
  })
})
```

- [ ] **Step 9: Implement remote OCR client and client selector**

Create `app/src/services/ocr/remoteOcrClient.ts`:

```ts
import { normalizeOcrResult } from './normalizeOcrResult'
import type { OcrClient, OcrEssayResult, OcrGatewayResponse, OcrRunInput } from './types'

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

function failedResultsForInput(input: OcrRunInput, error: string) {
  return input.groups.map((group) => failedResult(group.id, error))
}

export function createRemoteOcrClient(apiBase: string): OcrClient {
  return {
    async recognize(input) {
      if (!apiBase) {
        return failedResultsForInput(
          input,
          '当前 real OCR 未配置 Gateway。请配置 VITE_OCR_API_BASE，或使用 mock 草稿 / 手动输入。',
        )
      }

      const results: OcrEssayResult[] = []

      for (const group of input.groups) {
        const pages = input.getGroupPages(group)
        const files = pages.map((page) => input.getPageFile(page.id))

        if (files.some((file) => !file)) {
          results.push(failedResult(group.id, '当前图片缺少可上传文件，请使用 mock 草稿或手动输入。'))
          continue
        }

        const formData = new FormData()
        formData.append('essayGroupId', group.id)
        formData.append('pageIds', JSON.stringify(pages.map((page) => page.id)))
        files.forEach((file) => {
          formData.append('pages', file as File)
        })

        try {
          const response = await fetch(`${apiBase.replace(/\/$/, '')}/ocr/recognize`, {
            method: 'POST',
            body: formData,
          })
          const rawText = await response.text()
          let payload: OcrGatewayResponse

          try {
            payload = JSON.parse(rawText) as OcrGatewayResponse
          } catch {
            results.push(failedResult(group.id, 'OCR Gateway 返回异常响应。'))
            continue
          }

          if (!Array.isArray(payload.results)) {
            results.push(failedResult(group.id, 'OCR Gateway 返回异常响应。'))
            continue
          }

          results.push(...payload.results.map(normalizeOcrResult))
        } catch {
          results.push(failedResult(group.id, `无法连接 OCR Gateway：${apiBase}`))
        }
      }

      return results
    },
  }
}
```

Create `app/src/services/ocr/ocrClient.ts`:

```ts
import { mockOcrClient } from './mockOcrClient'
import { createRemoteOcrClient } from './remoteOcrClient'
import type { OcrClient, OcrMode } from './types'

export function getDefaultOcrMode(): OcrMode {
  return import.meta.env.VITE_OCR_MODE === 'real' ? 'real' : 'mock'
}

export function createOcrClient(mode: OcrMode): OcrClient {
  if (mode === 'real') {
    return createRemoteOcrClient(import.meta.env.VITE_OCR_API_BASE ?? '')
  }

  return mockOcrClient
}
```

- [ ] **Step 10: Verify frontend OCR services**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/services/ocr
npm.cmd run lint
```

Expected:

- OCR service tests pass.
- Lint passes.

- [ ] **Step 11: Commit frontend OCR service layer**

Run:

```powershell
cd D:\wenjie-writewise-ai
git add app/src/services/ocr
git commit -m "feat: add frontend ocr clients"
```

Expected:

- Commit includes only frontend OCR service files and tests.

### Task 4: Connect UploadPage to OCR Client and Fallbacks

**Files:**
- Modify: `app/src/pages/UploadPage.tsx`
- Modify: `app/src/components/UploadSourceSelector.tsx`
- Modify: `app/src/pages/UploadPage.test.tsx`

- [ ] **Step 1: Add failing UploadPage tests for real OCR link-test success, failure, and fallback**

Append these tests to `app/src/pages/UploadPage.test.tsx`:

```ts
  it('runs the real OCR link test through the Gateway client and fills editable OCR drafts', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:essay-photo-preview'),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            results: [
              {
                essayGroupId: 'group-1',
                text: 'Gateway recognized essay text',
                pages: [{ pageId: 'local-page', text: 'Gateway recognized essay text' }],
                provider: 'remote',
                status: 'success',
              },
            ],
          }),
      })),
    )
    renderUploadPage()

    const initialDeleteButtons = screen.getAllByRole('button', { name: /^删除 / })
    for (const deleteButton of initialDeleteButtons) {
      await user.click(deleteButton)
    }
    await user.upload(screen.getByLabelText('选择图片'), new File(['image'], 'essay-photo.png', { type: 'image/png' }))

    await user.click(screen.getByRole('button', { name: 'real OCR 链路测试' }))
    await user.click(screen.getByRole('button', { name: '开始 OCR 识别（预计 1 篇）' }))

    expect(await screen.findByText('OCR 识别完成')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '作文 1 OCR 文本' })).toHaveValue('Gateway recognized essay text')
  })

  it('shows real OCR link-test failure with mock and manual fallback actions', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:essay-photo-preview'),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            results: [
              {
                essayGroupId: 'group-1',
                text: '',
                pages: [],
                provider: 'remote',
                status: 'failed',
                error: 'OCR Gateway mock failure: 请使用 mock 草稿或手动输入。',
              },
            ],
          }),
      })),
    )
    renderUploadPage()

    const initialDeleteButtons = screen.getAllByRole('button', { name: /^删除 / })
    for (const deleteButton of initialDeleteButtons) {
      await user.click(deleteButton)
    }
    await user.upload(screen.getByLabelText('选择图片'), new File(['image'], 'essay-photo.png', { type: 'image/png' }))

    await user.click(screen.getByRole('button', { name: 'real OCR 链路测试' }))
    await user.click(screen.getByRole('button', { name: '开始 OCR 识别（预计 1 篇）' }))

    expect(await screen.findByText(/OCR Gateway mock failure/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '使用 mock 草稿' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '手动输入 OCR 文本' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '使用 mock 草稿' }))
    expect(await screen.findByText('已使用 mock OCR 草稿作为回退。')).toBeInTheDocument()
    expect((screen.getByRole('textbox', { name: '作文 1 OCR 文本' }) as HTMLTextAreaElement).value).toContain(
      '作文图片 1',
    )
  })

  it('allows manual OCR input after real OCR link-test failure', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:essay-photo-preview'),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            results: [
              {
                essayGroupId: 'group-1',
                text: '',
                pages: [],
                provider: 'remote',
                status: 'failed',
                error: 'OCR Gateway mock failure: 请使用 mock 草稿或手动输入。',
              },
            ],
          }),
      })),
    )
    renderUploadPage()

    const initialDeleteButtons = screen.getAllByRole('button', { name: /^删除 / })
    for (const deleteButton of initialDeleteButtons) {
      await user.click(deleteButton)
    }
    await user.upload(screen.getByLabelText('选择图片'), new File(['image'], 'essay-photo.png', { type: 'image/png' }))

    await user.click(screen.getByRole('button', { name: 'real OCR 链路测试' }))
    await user.click(screen.getByRole('button', { name: '开始 OCR 识别（预计 1 篇）' }))
    await user.click(await screen.findByRole('button', { name: '手动输入 OCR 文本' }))

    expect(screen.getByRole('textbox', { name: '作文 1 OCR 文本' })).toHaveValue('')
  })

  it('shows an empty-text warning when OCR succeeds with no text', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:essay-photo-preview'),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            results: [
              {
                essayGroupId: 'group-1',
                text: '',
                pages: [{ pageId: 'local-page', text: '', warnings: ['empty_text'] }],
                provider: 'remote',
                status: 'success',
              },
            ],
          }),
      })),
    )
    renderUploadPage()

    const initialDeleteButtons = screen.getAllByRole('button', { name: /^删除 / })
    for (const deleteButton of initialDeleteButtons) {
      await user.click(deleteButton)
    }
    await user.upload(screen.getByLabelText('选择图片'), new File(['image'], 'essay-photo.png', { type: 'image/png' }))

    await user.click(screen.getByRole('button', { name: 'real OCR 链路测试' }))
    await user.click(screen.getByRole('button', { name: '开始 OCR 识别（预计 1 篇）' }))

    expect(await screen.findByText('识别结果为空，请检查图片或手动输入。')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run UploadPage tests to verify new tests fail**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/UploadPage.test.tsx
```

Expected:

- Existing tests pass.
- New tests fail because OCR mode controls and real OCR link-test flow do not exist.

- [ ] **Step 3: Update UploadPage imports and state**

Modify `app/src/pages/UploadPage.tsx` imports:

```ts
import { createOcrClient, getDefaultOcrMode } from '../services/ocr/ocrClient'
import { buildOcrDraftsFromResults, hasEmptyTextWarning } from '../services/ocr/normalizeOcrResult'
import type { OcrEssayResult, OcrMode, OcrRunStatus } from '../services/ocr/types'
```

Remove local `buildPageOcrDraft`.

Add state near existing state:

```ts
  const [ocrMode, setOcrMode] = useState<OcrMode>(() => getDefaultOcrMode())
  const [ocrStatus, setOcrStatus] = useState<OcrRunStatus>('idle')
  const [ocrResults, setOcrResults] = useState<OcrEssayResult[]>([])
  const [ocrError, setOcrError] = useState('')
  const [emptyTextWarning, setEmptyTextWarning] = useState(false)
  const [ocrFallbackNotice, setOcrFallbackNotice] = useState('')
```

Replace `mockOcrStatus` usages with `ocrStatus`.

Add a derived lock:

```ts
  const isOcrRunning = ocrStatus === 'running'
```

- [ ] **Step 4: Track original File objects for remote OCR**

Add a file ref near `localPreviewUrlsRef`:

```ts
  const localFilesByPageIdRef = useRef<Map<string, File>>(new Map())
```

Inside `addLocalFiles`, after creating each page, store the file:

```ts
        localFilesByPageIdRef.current.set(pageId, file)
```

Use this exact page construction pattern so `pageId` can be reused:

```ts
        const pageId = `local-page-${Date.now()}-${index}`
        const previewUrl = URL.createObjectURL(file)
        localPreviewUrlsRef.current.push(previewUrl)
        localFilesByPageIdRef.current.set(pageId, file)

        return {
          id: pageId,
          label: file.name,
          pageNumber: start + index,
          quality: 'clear',
          accent: '#0891b2',
          previewUrl,
        }
```

When removing a page, also delete the file:

```ts
      localFilesByPageIdRef.current.delete(pageId)
```

For initial mock pages without `File`, remote OCR will fail with the planned missing-file message and offer fallback. This is acceptable for v0.1 because real file uploads do have `File` objects.

- [ ] **Step 5: Replace OCR reset and start logic**

Replace `resetOcrDraft`:

```ts
  const resetOcrDraft = () => {
    setOcrStatus('idle')
    setOcrDrafts([])
    setOcrResults([])
    setOcrError('')
    setEmptyTextWarning(false)
    setOcrFallbackNotice('')
  }
```

Add:

```ts
  const visibleGroupIds = visibleEssayGroups.map((group) => group.id)

  const applyOcrResults = (results: OcrEssayResult[], groupIdsSnapshot = visibleGroupIds) => {
    setOcrResults(results)
    setOcrDrafts(buildOcrDraftsFromResults(results, groupIdsSnapshot))
    setEmptyTextWarning(hasEmptyTextWarning(results))

    const failedResult = results.find((result) => result.status === 'failed')
    if (failedResult) {
      setOcrStatus('failed')
      setOcrError(failedResult.error ?? 'OCR 识别失败，请使用 mock 草稿或手动输入。')
      return
    }

    setOcrStatus('success')
    setOcrError('')
  }

  const startOcr = async () => {
    if (pages.length === 0) return
    const groupsSnapshot = visibleEssayGroups
    const groupIdsSnapshot = groupsSnapshot.map((group) => group.id)
    const pageOrderSnapshot = new Map(pageOrderIndex)

    setOcrStatus('running')
    setOcrError('')
    setEmptyTextWarning(false)
    setOcrFallbackNotice('')

    const client = createOcrClient(ocrMode)
    const results = await client.recognize({
      groups: groupsSnapshot,
      getGroupPages,
      getPageFile: (pageId) => localFilesByPageIdRef.current.get(pageId),
      pageOrderIndex: pageOrderSnapshot,
    })

    applyOcrResults(results, groupIdsSnapshot)
  }

  const useMockDraftFallback = async () => {
    const groupsSnapshot = visibleEssayGroups
    const groupIdsSnapshot = groupsSnapshot.map((group) => group.id)
    const results = await createOcrClient('mock').recognize({
      groups: groupsSnapshot,
      getGroupPages,
      getPageFile: (pageId) => localFilesByPageIdRef.current.get(pageId),
      pageOrderIndex,
    })
    applyOcrResults(results, groupIdsSnapshot)
    setOcrFallbackNotice('已使用 mock OCR 草稿作为回退。')
  }

  const startManualOcrInput = () => {
    setOcrDrafts(visibleEssayGroups.map(() => ''))
    setOcrResults([])
    setOcrStatus('success')
    setOcrError('')
    setEmptyTextWarning(false)
    setOcrFallbackNotice('')
  }
```

At the start of `setGroupingMode`, `addPage`, `addLocalFiles`, `movePage`, `removePage`, `togglePageSelection`, `mergeSelectedPages`, and `splitEssayGroup`, add:

```ts
    if (isOcrRunning) return
```

This is required even though `startOcr` snapshots groups and page order. The lock prevents teachers from changing the visible organizer while OCR is running; the snapshot prevents stale async results from being mapped with a later group order.

Replace `canConfirmMockOcr` with:

```ts
  const canConfirmOcr =
    ocrStatus === 'success' &&
    visibleEssayGroups.length > 0 &&
    ocrDrafts.length === visibleEssayGroups.length &&
    ocrDrafts.every((draft) => draft.trim().length > 0)
```

Update the confirm button to use `canConfirmOcr`. This prevents a failed OCR state with no drafts from entering the progress queue.

- [ ] **Step 6: Update OCR controls and draft panel UI**

Replace the existing “开始模拟 OCR” button area with:

```tsx
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1" aria-label="OCR 模式">
                {(['mock', 'real'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={isOcrRunning}
                    onClick={() => {
                      setOcrMode(mode)
                      resetOcrDraft()
                    }}
                    className={
                      ocrMode === mode
                        ? 'rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-blue-700 shadow-sm'
                        : 'rounded-md px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-white'
                    }
                  >
                    {mode === 'mock' ? 'mock OCR' : 'real OCR 链路测试'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={startOcr}
                disabled={pages.length === 0 || ocrStatus === 'running'}
                className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                {ocrStatus === 'running' ? 'OCR 识别中...' : `开始 OCR 识别（预计 ${essaySubmissionCount} 篇）`}
              </button>
            </div>
```

Update draft panel condition from `mockOcrStatus === 'completed'` to:

```tsx
        {ocrStatus === 'success' || ocrStatus === 'failed' ? (
```

Use heading text:

```tsx
                <p className="text-sm font-semibold text-cyan-700">
                  {ocrStatus === 'failed' ? 'OCR 识别失败' : 'OCR 识别完成'}
                </p>
                <h3 className="mt-1 font-semibold text-slate-950">OCR 文本草稿</h3>
```

Add warning and fallback block before textareas:

```tsx
            {emptyTextWarning ? (
              <p className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                识别结果为空，请检查图片或手动输入。
              </p>
            ) : null}
            {ocrFallbackNotice ? (
              <p className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800">
                {ocrFallbackNotice}
              </p>
            ) : null}
            {ocrStatus === 'failed' ? (
              <div className="mt-4 rounded-lg border border-rose-100 bg-rose-50 p-3">
                <p className="text-sm font-semibold text-rose-800">{ocrError}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={useMockDraftFallback}
                    className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                  >
                    使用 mock 草稿
                  </button>
                  <button
                    type="button"
                    onClick={startManualOcrInput}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    手动输入 OCR 文本
                  </button>
                  <button
                    type="button"
                    onClick={startOcr}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    重试 OCR
                  </button>
                </div>
              </div>
            ) : null}
```

Update organizer controls while `isOcrRunning`:

- Disable grouping mode buttons:

```tsx
disabled={isOcrRunning}
```

- Disable local image selection and mock-image add actions by passing an `disabled={isOcrRunning}` prop to `UploadSourceSelector`; update `UploadSourceSelector` props so the file input and add mock button respect it.

Update `app/src/components/UploadSourceSelector.tsx` props:

```ts
interface UploadSourceSelectorProps {
  onSelectImages: (files: File[]) => void
  onAddMockImage: () => void
  disabled?: boolean
}
```

Use `disabled` on the “选择图片” file input and “添加模拟图片” button:

```tsx
<input disabled={disabled} ... />
<button type="button" disabled={disabled} ...>
  添加模拟图片
</button>
```

Pass the prop from `UploadPage`:

```tsx
<UploadSourceSelector onAddMockImage={addPage} onSelectImages={addLocalFiles} disabled={isOcrRunning} />
```

- Disable page selection buttons in mixed mode:

```tsx
disabled={isOcrRunning}
```

- Disable page move/delete buttons:

```tsx
disabled={isOcrRunning || displayIndex === 1}
disabled={isOcrRunning || displayIndex === pages.length}
disabled={isOcrRunning}
```

- Disable merge and split buttons:

```tsx
disabled={isOcrRunning}
```

Keep the early `if (isOcrRunning) return` guards in handlers even after adding disabled attributes.

Keep the existing textarea grid and confirm button. Keep `confirmMockOcrText` function name if desired to limit AppState changes; it can still confirm OCR text regardless of source.

- [ ] **Step 7: Update existing UploadPage tests for renamed button**

Replace test queries:

```ts
screen.getByRole('button', { name: '开始模拟 OCR（预计 6 篇）' })
```

with:

```ts
screen.getByRole('button', { name: '开始 OCR 识别（预计 6 篇）' })
```

Replace similar fixed-2 and mixed-mode button names:

```ts
screen.getByRole('button', { name: '开始 OCR 识别（预计 3 篇）' })
screen.getByRole('button', { name: '开始 OCR 识别（预计 5 篇）' })
```

- [ ] **Step 8: Verify UploadPage OCR flow**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/UploadPage.test.tsx
npm.cmd test -- src/services/ocr
npm.cmd run lint
```

Expected:

- UploadPage tests pass.
- OCR service tests pass.
- Lint passes.

- [ ] **Step 9: Commit UploadPage integration**

Run:

```powershell
cd D:\wenjie-writewise-ai
git add app/src/pages/UploadPage.tsx app/src/pages/UploadPage.test.tsx
git commit -m "feat: connect upload page to ocr clients"
```

Expected:

- Commit contains UploadPage integration and test updates.

### Task 5: Add Environment Examples and Documentation Updates

**Files:**
- Create: `app/.env.example`
- Create: `ocr-gateway/.env.example`
- Modify: `docs/current_development_status.md`

- [ ] **Step 1: Add frontend environment example**

Create `app/.env.example`:

```env
VITE_OCR_MODE=mock
VITE_OCR_API_BASE=http://localhost:8787
```

- [ ] **Step 2: Add Gateway environment example**

Create `ocr-gateway/.env.example`:

```env
PORT=8787
OCR_PROVIDER=mock
OCR_TIMEOUT_MS=30000
```

Do not add any real API key to `.env.example`.

- [ ] **Step 3: Update development status**

Add a new top section to `docs/current_development_status.md`:

```markdown
## 本次新增进展：真实 OCR Gateway 接入 v0.1

- 新增最小 `ocr-gateway`，提供 `GET /health` 和 `POST /ocr/recognize`。
- Gateway v0.1 使用 `mock` provider 跑通 real OCR 形态链路，并提供 `mock_failure` 受控失败能力。
- Gateway 使用 memory storage 处理上传图片，不写数据库，不长期保存文件，不上传对象存储。
- Gateway 限制图片类型为 PNG / JPEG / WebP，并限制单张图片大小和单次 OCR 页数。
- 前端新增统一 OCR Client，支持 mock OCR 与 real OCR 链路测试模式；当前 real OCR 链路测试仍由 Gateway mock provider 返回统一 OCR JSON。
- 上传整理页 real OCR 链路测试成功后回填现有 OCR 草稿区，失败后提供使用 mock 草稿、手动输入和重试 OCR。
- 前端只读取 `VITE_OCR_MODE` 和 `VITE_OCR_API_BASE`，不保存 provider key 或 secret。
- 当前仍不接真实 OCR 厂商、不接真实 AI 批改、不解析 PDF / Word / 文件夹。
```

- [ ] **Step 4: Verify docs and examples are staged cleanly**

Run:

```powershell
cd D:\wenjie-writewise-ai
git status --short
```

Expected:

- Only `app/.env.example`, `ocr-gateway/.env.example`, and `docs/current_development_status.md` are changed for this task.
- `ocr-gateway/.env` is not present in `git status`.
- `ocr-gateway/node_modules` is not present in `git status`.

- [ ] **Step 5: Commit docs and environment examples**

Run:

```powershell
cd D:\wenjie-writewise-ai
git add app/.env.example ocr-gateway/.env.example docs/current_development_status.md
git commit -m "docs: document ocr gateway configuration"
```

Expected:

- Commit includes docs and env examples only.

### Task 6: Run Security Scan and Full Verification

**Files:**
- No planned source changes.
- Possible modify: test files only if verification reveals a real mismatch.

- [ ] **Step 1: Run frontend secret/provider scan**

Run:

```powershell
cd D:\wenjie-writewise-ai
rg "SECRET|API_KEY|OPENAI|TENCENT|BAIDU" app/src ocr-gateway/src --glob "!**/*.test.*"
```

Expected:

- No matches in frontend production source.
- No real key strings in Gateway production source.
- `app/src` has no provider-specific logic.

- [ ] **Step 2: Run Gateway tests and typecheck**

Run:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test
npm.cmd run typecheck
```

Expected:

- Gateway tests pass.
- Typecheck passes.

- [ ] **Step 3: Run frontend focused tests**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/services/ocr
npm.cmd test -- src/pages/UploadPage.test.tsx
```

Expected:

- OCR service tests pass.
- UploadPage tests pass.

- [ ] **Step 4: Run frontend full verification**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected:

- Full test suite passes.
- Lint passes.
- Build passes.

- [ ] **Step 5: Optional local smoke test with Gateway**

Terminal 1:

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
$env:OCR_PROVIDER='mock'
npm.cmd run dev
```

Expected:

- Gateway prints `OCR Gateway listening on http://localhost:8787`.

Terminal 2:

```powershell
cd D:\wenjie-writewise-ai\app
$env:VITE_OCR_MODE='real'
$env:VITE_OCR_API_BASE='http://localhost:8787'
npm.cmd run dev
```

Expected:

- Vite starts.
- UploadPage can select real OCR 链路测试 and fill OCR drafts after local image upload.

- [ ] **Step 6: Clean generated build output**

If `app/dist` exists after build, remove it only after confirming it is inside `D:\wenjie-writewise-ai\app`:

```powershell
cd D:\wenjie-writewise-ai\app
$target = Resolve-Path -LiteralPath ".\dist"
$root = Resolve-Path -LiteralPath "."
if ($target.Path -like (Join-Path $root.Path '*')) { Remove-Item -LiteralPath $target.Path -Recurse -Force } else { throw "Refusing to remove unexpected path $($target.Path)" }
```

Expected:

- `app/dist` is removed.
- No source files are changed by cleanup.

- [ ] **Step 7: Commit verification-only fixes if needed**

If verification required source or test fixes, commit them:

```powershell
cd D:\wenjie-writewise-ai
git add app ocr-gateway docs
git commit -m "test: stabilize ocr gateway integration"
```

Expected:

- Skip this commit when no files changed.
- Do not commit `app/dist` or `node_modules`.

## Final Verification Checklist

Before opening a PR or merging:

- [ ] `cd D:\wenjie-writewise-ai\ocr-gateway; npm.cmd test`
- [ ] `cd D:\wenjie-writewise-ai\ocr-gateway; npm.cmd run typecheck`
- [ ] `cd D:\wenjie-writewise-ai\app; npm.cmd test -- src/services/ocr`
- [ ] `cd D:\wenjie-writewise-ai\app; npm.cmd test -- src/pages/UploadPage.test.tsx`
- [ ] `cd D:\wenjie-writewise-ai\app; npm.cmd test`
- [ ] `cd D:\wenjie-writewise-ai\app; npm.cmd run lint`
- [ ] `cd D:\wenjie-writewise-ai\app; npm.cmd run build`
- [ ] `cd D:\wenjie-writewise-ai; rg "SECRET|API_KEY|OPENAI|TENCENT|BAIDU" app/src ocr-gateway/src --glob "!**/*.test.*"` returns no matches.
- [ ] `git status --short --branch` shows no unintended files.
- [ ] `git status --short` does not include `.env`, `ocr-gateway/.env`, `node_modules`, or `ocr-gateway/node_modules`.

## Expected Commit Sequence

1. `feat: add ocr gateway skeleton`
2. `feat: add gateway mock ocr providers`
3. `feat: add frontend ocr clients`
4. `feat: connect upload page to ocr clients`
5. `docs: document ocr gateway configuration`
6. `test: stabilize ocr gateway integration` only if verification fixes are required.

## Notes for Execution

- Start execution from latest `main` in a fresh `codex/real-ocr-gateway-v01` branch.
- Use TDD: write the failing test, run it, implement the smallest change, rerun.
- Keep `UploadPage` provider-agnostic. It may know `mock` and `real`, but not Tencent/Baidu/OpenAI/PaddleOCR.
- Keep real provider names and secrets out of `app/src`.
- Use Gateway `OCR_PROVIDER=mock_failure` to test frontend failure paths without breaking network behavior.
- Preserve existing upload grouping and confirm-to-progress queue behavior.
