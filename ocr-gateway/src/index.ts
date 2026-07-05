import { createServer } from './server.js'

const port = Number(process.env.PORT ?? 8787)
const app = createServer()

app.listen(port, () => {
  console.log(`OCR Gateway listening on http://localhost:${port}`)
})
