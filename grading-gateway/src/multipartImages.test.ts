import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createServer } from './server.js'

function safeBody(response: { body: unknown }) {
  return JSON.stringify(response.body)
}

describe('rubric multipart image boundary', () => {
  it('rejects missing pages without exposing multipart data', async () => {
    const response = await request(createServer())
      .post('/tasks/rubric')
      .field('requestId', 'missing-pages')
      .field('fullScore', '15')
      .field('pageIds', JSON.stringify(['material-1']))
      .expect(400)

    expect(response.body).toMatchObject({ requestId: 'missing-pages', status: 'failed', error: { code: 'invalid_request', retryable: false } })
    expect(safeBody(response)).not.toMatch(/filename|bytes|material\.png|stack/i)
  })

  it('rejects page and file count mismatches without exposing filenames', async () => {
    const response = await request(createServer())
      .post('/tasks/rubric')
      .field('requestId', 'count-mismatch')
      .field('fullScore', '15')
      .field('pageIds', JSON.stringify(['material-1', 'material-2']))
      .attach('pages', Buffer.from('PRIVATE-BYTES'), { filename: 'private-material.png', contentType: 'image/png' })
      .expect(400)

    expect(response.body).toMatchObject({ requestId: 'count-mismatch', status: 'failed', error: { code: 'invalid_request', retryable: false } })
    expect(safeBody(response)).not.toMatch(/PRIVATE-BYTES|private-material\.png|filename|bytes|stack/i)
  })

  it('rejects unsupported image media types without exposing filenames', async () => {
    const response = await request(createServer())
      .post('/tasks/rubric')
      .field('requestId', 'bad-mime')
      .field('fullScore', '15')
      .field('pageIds', JSON.stringify(['material-1']))
      .attach('pages', Buffer.from('PRIVATE-BYTES'), { filename: 'private-material.gif', contentType: 'image/gif' })
      .expect(400)

    expect(response.body).toMatchObject({ requestId: 'bad-mime', status: 'failed', error: { code: 'invalid_request', retryable: false } })
    expect(safeBody(response)).not.toMatch(/PRIVATE-BYTES|private-material\.gif|filename|bytes|stack/i)
  })

  it('accepts exactly 8 MB and ten images when the provider is configured', async () => {
    const provider = {
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
      async gradeEssay() { throw new Error('not used') },
    }
    let pending = request(createServer({ multimodalProvider: provider }))
      .post('/tasks/rubric')
      .field('requestId', 'maximum-images')
      .field('fullScore', '15')
      .field('pageIds', JSON.stringify(Array.from({ length: 10 }, (_, index) => `material-${index + 1}`)))
    for (let index = 0; index < 10; index += 1) {
      pending = pending.attach('pages', index === 0 ? Buffer.alloc(8 * 1024 * 1024) : Buffer.from('image'), {
        filename: `material-${index + 1}.png`, contentType: 'image/png',
      })
    }
    const response = await pending.expect(200)
    expect(response.body).toMatchObject({ requestId: 'maximum-images', status: 'success' })
  })

  it('rejects images larger than 8 MB and more than ten pages safely', async () => {
    const oversized = await request(createServer())
      .post('/tasks/rubric')
      .field('requestId', 'oversized-image')
      .field('fullScore', '15')
      .field('pageIds', JSON.stringify(['material-1']))
      .attach('pages', Buffer.alloc((8 * 1024 * 1024) + 1, 1), { filename: 'private-oversized.png', contentType: 'image/png' })
      .expect(413)
    expect(oversized.body).toMatchObject({ requestId: 'oversized-image', status: 'failed', error: { code: 'request_too_large', retryable: false } })
    expect(safeBody(oversized)).not.toMatch(/private-oversized\.png|bytes|stack/i)

    let pending = request(createServer()).post('/tasks/rubric')
      .field('requestId', 'too-many-pages')
      .field('fullScore', '15')
      .field('pageIds', JSON.stringify(Array.from({ length: 11 }, (_, index) => `material-${index + 1}`)))
    for (let index = 0; index < 11; index += 1) {
      pending = pending.attach('pages', Buffer.from('PRIVATE-BYTES'), { filename: `private-${index}.png`, contentType: 'image/png' })
    }
    const tooMany = await pending.expect(413)
    expect(tooMany.body).toMatchObject({ requestId: 'too-many-pages', status: 'failed', error: { code: 'request_too_large', retryable: false } })
    expect(safeBody(tooMany)).not.toMatch(/PRIVATE-BYTES|private-\d+\.png|bytes|stack/i)
  })
})
