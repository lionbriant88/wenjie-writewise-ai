import { createServer as createHttpServer } from 'node:http'
import net from 'node:net'
import type { Request, Response } from 'express'
import multer from 'multer'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createServer } from './server.js'
import type { MultimodalProvider } from './providers/multimodalProviderTypes.js'
import type { GeneratedRubricV1, TaskMaterialContextV1 } from './multimodal/types.js'

interface RawMultimodalProvider {
  generateMaterialContext(input: Parameters<MultimodalProvider['generateMaterialContext']>[0]): Promise<TaskMaterialContextV1>
  generateRubric(input: Parameters<MultimodalProvider['generateRubric']>[0]): Promise<GeneratedRubricV1>
  gradeEssay(input: Parameters<MultimodalProvider['gradeEssay']>[0]): Promise<unknown>
}

function fakeMultimodalProvider(
  overrides: Partial<RawMultimodalProvider> = {},
): MultimodalProvider {
  return {
    async generateMaterialContext(input) {
      if (!overrides.generateMaterialContext) throw new Error('not used')
      return { value: await overrides.generateMaterialContext(input), attempts: [] }
    },
    async generateRubric(input) {
      if (!overrides.generateRubric) throw new Error('not used')
      return { value: await overrides.generateRubric(input), attempts: [] }
    },
    async gradeEssay(input) {
      if (!overrides.gradeEssay) throw new Error('not used')
      return { value: await overrides.gradeEssay(input), attempts: [] }
    },
  }
}

function safeBody(response: { body: unknown }) {
  return JSON.stringify(response.body)
}

describe('task material multipart boundary', () => {
  it('settles the upload middleware once when a multipart client aborts mid-file', async () => {
    const upload = multer({ storage: multer.memoryStorage() }).single('images')
    let callbackCalls = 0
    let settleCallback: (error: unknown) => void = () => undefined
    const callbackResult = new Promise<unknown>((resolve) => { settleCallback = resolve })
    const server = createHttpServer((incoming, outgoing) => {
      upload(incoming as unknown as Request, outgoing as unknown as Response, (error) => {
        callbackCalls += 1
        settleCallback(error)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test address.')

    const boundary = 'synthetic-abort-boundary'
    const partialBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="images"; filename="synthetic.png"',
      'Content-Type: image/png',
      '',
      'partial',
    ].join('\r\n')
    const rawRequest = [
      'POST /upload HTTP/1.1',
      'Host: 127.0.0.1',
      `Content-Type: multipart/form-data; boundary=${boundary}`,
      `Content-Length: ${Buffer.byteLength(partialBody) + 1024}`,
      '',
      partialBody,
    ].join('\r\n')
    const socket = net.createConnection({ host: '127.0.0.1', port: address.port })
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject)
      socket.once('connect', () => {
        socket.write(rawRequest, () => {
          socket.destroy()
          resolve()
        })
      })
    })

    let timeout: NodeJS.Timeout | undefined
    const outcome = await Promise.race([
      callbackResult.then((error) => ({ kind: 'callback' as const, error })),
      new Promise<{ kind: 'timeout' }>((resolve) => { timeout = setTimeout(() => resolve({ kind: 'timeout' }), 500) }),
    ])
    if (timeout) clearTimeout(timeout)
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))

    expect(outcome.kind).toBe('callback')
    if (outcome.kind === 'callback') expect(outcome.error).toBeInstanceOf(Error)
    expect(callbackCalls).toBe(1)
  })

  it('rejects a manifest image with no matching upload without exposing multipart data', async () => {
    const response = await request(createServer())
      .post('/tasks/rubric')
      .field('requestId', 'missing-images')
      .field('fullScore', '15')
      .field('materialManifest', JSON.stringify([{ id: 'material-1', kind: 'image', imageIndex: 0 }]))
      .field('textMaterials', JSON.stringify([]))
      .expect(400)

    expect(response.body).toMatchObject({ requestId: 'missing-images', status: 'failed', error: { code: 'invalid_request', retryable: false } })
    expect(safeBody(response)).not.toMatch(/filename|bytes|material\.png|stack/i)
  })

  it('rejects an abruptly terminated multipart form without echoing parser details', async () => {
    const marker = 'PRIVATE-MALFORMED-PAYLOAD'
    const boundary = 'synthetic-malformed-boundary'
    const response = await request(createServer())
      .post('/tasks/rubric')
      .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
      .send(`--${boundary}\r\nContent-Disposition: form-data; name="requestId"\r\n\r\n${marker}`)
      .expect(400)

    expect(response.body).toMatchObject({ requestId: 'unavailable', status: 'failed', error: { code: 'invalid_request', retryable: false } })
    expect(safeBody(response)).not.toMatch(/PRIVATE-MALFORMED-PAYLOAD|boundary|multipart|stack/i)
  })

  it('rejects unexpected upload fields safely on both task routes before Provider use', async () => {
    let contextCalls = 0
    let rubricCalls = 0
    const provider = fakeMultimodalProvider({
      async generateMaterialContext() { contextCalls += 1; throw new Error('must not run') },
      async generateRubric() { rubricCalls += 1; throw new Error('must not run') },
    })
    for (const route of ['/tasks/material-context', '/tasks/rubric']) {
      let pending = request(createServer({ multimodalProvider: provider }))
        .post(route)
        .field('requestId', 'unexpected-upload-field')
        .field('fullScore', '15')
      if (route.endsWith('material-context')) pending = pending.field('writingRequirement', 'Teacher requirement.')
      const response = await pending
        .field('materialManifest', JSON.stringify([{ id: 'image-1', kind: 'image', imageIndex: 0 }]))
        .field('textMaterials', JSON.stringify([]))
        .attach('PRIVATE-UPLOAD-FIELD', Buffer.from('PRIVATE-UPLOAD-CONTENT'), { filename: 'private.png', contentType: 'image/png' })
        .expect(400)

      expect(response.body).toMatchObject({ status: 'failed', error: { code: 'invalid_request', retryable: false } })
      expect(safeBody(response)).not.toMatch(/PRIVATE|UPLOAD-FIELD|UPLOAD-CONTENT|private\.png|stack/)
    }
    expect(contextCalls).toBe(0)
    expect(rubricCalls).toBe(0)
  })

  it('rejects manifest and image count mismatches without exposing filenames', async () => {
    const response = await request(createServer())
      .post('/tasks/rubric')
      .field('requestId', 'count-mismatch')
      .field('fullScore', '15')
      .field('materialManifest', JSON.stringify([
        { id: 'material-1', kind: 'image', imageIndex: 0 },
        { id: 'material-2', kind: 'image', imageIndex: 1 },
      ]))
      .field('textMaterials', JSON.stringify([]))
      .attach('images', Buffer.from('PRIVATE-BYTES'), { filename: 'private-material.png', contentType: 'image/png' })
      .expect(400)

    expect(response.body).toMatchObject({ requestId: 'count-mismatch', status: 'failed', error: { code: 'invalid_request', retryable: false } })
    expect(safeBody(response)).not.toMatch(/PRIVATE-BYTES|private-material\.png|filename|bytes|stack/i)
  })

  it('rejects unsupported image media types without exposing filenames', async () => {
    const response = await request(createServer())
      .post('/tasks/rubric')
      .field('requestId', 'bad-mime')
      .field('fullScore', '15')
      .field('materialManifest', JSON.stringify([{ id: 'material-1', kind: 'image', imageIndex: 0 }]))
      .field('textMaterials', JSON.stringify([]))
      .attach('images', Buffer.from('PRIVATE-BYTES'), { filename: 'private-material.gif', contentType: 'image/gif' })
      .expect(400)

    expect(response.body).toMatchObject({ requestId: 'bad-mime', status: 'failed', error: { code: 'invalid_request', retryable: false } })
    expect(safeBody(response)).not.toMatch(/PRIVATE-BYTES|private-material\.gif|filename|bytes|stack/i)
  })

  it('accepts exactly 8 MB and ten images when the provider is configured', async () => {
    const provider = fakeMultimodalProvider({
      async generateRubric() {
        return {
          taskName: 'Synthetic task', materialSummary: 'A synthetic task material summary.',
          writingRequirements: ['Write clearly.'], constraints: ['Use English.'],
          dimensions: [
            { id: 'content', name: 'Content', weight: 95, description: 'Cover the task.', deductionFocus: ['Missing task coverage.'], sourceEvidence: ['Prompt heading.'] },
            { id: 'legibility', name: 'Legibility', weight: 5, description: 'Handwriting is legible.', deductionFocus: [], sourceEvidence: [] },
          ],
          reviewWarnings: ['Verify source material.'],
        }
      },
    })
    let pending = request(createServer({ multimodalProvider: provider }))
      .post('/tasks/rubric')
      .field('requestId', 'maximum-images')
      .field('fullScore', '15')
      .field('materialManifest', JSON.stringify(Array.from({ length: 10 }, (_, index) => ({ id: `material-${index + 1}`, kind: 'image', imageIndex: index }))))
      .field('textMaterials', JSON.stringify([]))
    for (let index = 0; index < 10; index += 1) {
      pending = pending.attach('images', index === 0 ? Buffer.alloc(8 * 1024 * 1024) : Buffer.from('image'), {
        filename: `material-${index + 1}.png`, contentType: 'image/png',
      })
    }
    const response = await pending.expect(200)
    expect(response.body).toMatchObject({ requestId: 'maximum-images', status: 'success' })
  })

  it('rejects images larger than 8 MB and more than ten images safely', async () => {
    const oversized = await request(createServer())
      .post('/tasks/rubric')
      .field('requestId', 'oversized-image')
      .field('fullScore', '15')
      .field('materialManifest', JSON.stringify([{ id: 'material-1', kind: 'image', imageIndex: 0 }]))
      .field('textMaterials', JSON.stringify([]))
      .attach('images', Buffer.alloc((8 * 1024 * 1024) + 1, 1), { filename: 'private-oversized.png', contentType: 'image/png' })
      .expect(413)
    expect(oversized.body).toMatchObject({ requestId: 'oversized-image', status: 'failed', error: { code: 'request_too_large', retryable: false } })
    expect(safeBody(oversized)).not.toMatch(/private-oversized\.png|bytes|stack/i)

    let pending = request(createServer()).post('/tasks/rubric')
      .field('requestId', 'too-many-images')
      .field('fullScore', '15')
      .field('materialManifest', JSON.stringify(Array.from({ length: 11 }, (_, index) => ({ id: `material-${index + 1}`, kind: 'image', imageIndex: index }))))
      .field('textMaterials', JSON.stringify([]))
    for (let index = 0; index < 11; index += 1) {
      pending = pending.attach('images', Buffer.from('PRIVATE-BYTES'), { filename: `private-${index}.png`, contentType: 'image/png' })
    }
    const tooMany = await pending.expect(413)
    expect(tooMany.body).toMatchObject({ requestId: 'too-many-images', status: 'failed', error: { code: 'request_too_large', retryable: false } })
    expect(safeBody(tooMany)).not.toMatch(/PRIVATE-BYTES|private-\d+\.png|bytes|stack/i)
  })
})
