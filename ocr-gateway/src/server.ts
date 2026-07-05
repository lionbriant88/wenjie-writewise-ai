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
