import 'dotenv/config'
import { parseGatewayRuntimeConfig } from './gatewayRuntimeConfig.js'
import { createSafeProviderMetricStderrSink, createProviderTelemetryRecorder } from './providerTelemetry.js'
import { getMultimodalProvider } from './providers/index.js'
import { createSafeDiagnosticStderrSink } from './safeDiagnostics.js'
import { createGatewayExecutionServices, createServer } from './server.js'

const runtimeConfig = parseGatewayRuntimeConfig(process.env)
const kimiApiKey = process.env.KIMI_API_KEY
const host = process.env.HOST ?? '127.0.0.1'
const port = Number.parseInt(process.env.PORT ?? '8790', 10)
const onDiagnostic = createSafeDiagnosticStderrSink(
  process.env.GRADING_SAFE_DIAGNOSTICS,
  (line) => console.error(line),
)
const providerTelemetry = createProviderTelemetryRecorder({
  emit: createSafeProviderMetricStderrSink(
    process.env.GRADING_SAFE_TELEMETRY,
    (line) => console.error(line),
  ),
})
const multimodalProvider = getMultimodalProvider(runtimeConfig, { apiKey: kimiApiKey })
const monotonicNow = performance.now.bind(performance)
const executionServices = runtimeConfig.executionRegistry === 'memory-v1'
  ? createGatewayExecutionServices(runtimeConfig, { now: monotonicNow })
  : undefined
const app = createServer({
  runtimeConfig,
  multimodalProvider,
  providerTelemetry,
  monotonicNow,
  ...(executionServices ? { executionServices } : {}),
  allowedOrigin: process.env.GRADING_ALLOWED_ORIGIN ?? 'http://127.0.0.1:5173',
  ...(onDiagnostic ? { onDiagnostic } : {}),
})

app.listen(port, host, () => {
  console.log(`grading-gateway listening on ${host}:${port}`)
})
