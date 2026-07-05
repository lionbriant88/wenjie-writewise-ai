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
