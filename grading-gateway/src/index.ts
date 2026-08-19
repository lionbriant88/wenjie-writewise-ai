import 'dotenv/config'
import { parseGradingTimeoutMs } from './providers/index.js'
import { createSafeDiagnosticStderrSink } from './safeDiagnostics.js'
import { createServer } from './server.js'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number.parseInt(process.env.PORT ?? '8790', 10)
const onDiagnostic = createSafeDiagnosticStderrSink(
  process.env.GRADING_SAFE_DIAGNOSTICS,
  (line) => console.error(line),
)
const app = createServer({
  providerName: process.env.GRADING_PROVIDER ?? 'mock',
  allowedOrigin: process.env.GRADING_ALLOWED_ORIGIN ?? 'http://127.0.0.1:5173',
  timeoutMs: parseGradingTimeoutMs(process.env.GRADING_TIMEOUT_MS),
  ...(onDiagnostic ? { onDiagnostic } : {}),
})

app.listen(port, host, () => {
  console.log(`grading-gateway listening on ${host}:${port}`)
})
