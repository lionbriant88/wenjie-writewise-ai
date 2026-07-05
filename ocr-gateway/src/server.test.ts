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
