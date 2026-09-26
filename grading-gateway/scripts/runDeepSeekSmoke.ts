import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import request from 'supertest'
import { loadDeepSeekEnvironment } from './deepSeekEnvironment.js'
import { checkDeepSeekAccount } from './checkDeepSeekAccount.js'
import { reserveSmokeCall } from './deepSeekSmokeBudget.js'
import { parseGatewayRuntimeConfig } from '../src/gatewayRuntimeConfig.js'
import { getMultimodalProvider } from '../src/providers/index.js'
import { createServer } from '../src/server.js'
import { createProviderTelemetryRecorder, serializeSafeProviderMetric } from '../src/providerTelemetry.js'

async function main() {
  if (!process.argv.includes('--run-authorized')) throw Error('Authorization flag required.')
  const account = await checkDeepSeekAccount()
  if (!account.modelAvailable || account.imageInput === false || !account.balanceAvailable
    || !account.balances.some((b: { currency: string; total: number }) => b.total >= (b.currency === 'CNY' ? .60 : .10))) throw Error('Account preflight failed.')
  const env = loadDeepSeekEnvironment()
  const config = parseGatewayRuntimeConfig(env)
  const directory = fileURLToPath(new URL('../local-private-results/deepseek-20260925/', import.meta.url))
  const rubricMode = process.argv.includes('--rubric-image')
  const caseId = rubricMode ? 'rubric-image' : process.argv.includes('--verify-score-bounds') ? 'score-bounds-image'
    : process.argv.includes('--diagnostic-image') ? 'diagnostic-image' : 'single-image'
  const metrics: unknown[] = []
  const diagnostics: unknown[] = []
  let shapeDiagnostic: unknown
  let reservation: ReturnType<typeof reserveSmokeCall> | undefined
  const provider = getMultimodalProvider(config, { apiKey: env.DEEPSEEK_API_KEY, fetchImpl: async (url, init) => {
    if (url !== 'https://api.deepseek.com/chat/completions' || reservation) throw Error('Unexpected additional completion.')
    reservation = reserveSmokeCall(directory, caseId, JSON.parse(String(init?.body)))
    console.log(JSON.stringify({ stage: 'reserved', ordinal: reservation.ordinal, reservedCny: reservation.reservedCnyMicros / 1e6, reservedUsd: reservation.reservedUsdMicros / 1e6 }))
    const response = await fetch(url, init)
    if (response.ok) {
      try {
        const envelope = await response.clone().json()
        const value = JSON.parse(envelope.choices?.[0]?.message?.content)
        const rows = value.dimensionScores
        const expected = ['content', 'legibility']
        const maxima = [14.25, .75]
        shapeDiagnostic = { dimensionsIsArray: Array.isArray(rows), rows: Array.isArray(rows) ? rows.slice(0, 10).map((row: any) => {
          const index = expected.indexOf(row?.dimensionId)
          return { expectedIndex: index, scoreIsNumber: typeof row?.score === 'number', score: Number.isFinite(row?.score) ? row.score : null,
            withinBound: index >= 0 && typeof row?.score === 'number' && row.score >= 0 && row.score <= maxima[index] }
        }) : [] }
      } catch { shapeDiagnostic = { parsed: false } }
    }
    return response
  } })
  const telemetry = createProviderTelemetryRecorder({ emit: (metric) => { const safe = serializeSafeProviderMetric(metric); if (safe) metrics.push(JSON.parse(safe)) } })
  const app = createServer({ runtimeConfig: config, multimodalProvider: provider, providerTelemetry: telemetry,
    onDiagnostic: (event) => diagnostics.push({ stage: event.stage, code: event.diagnosticCode }) })
  const rubric = { taskName: 'Synthetic club recommendation', materialSummary: 'Recommend a school club and explain two reasons.',
    writingRequirements: ['Use clear English and give two relevant reasons.'], constraints: [], reviewWarnings: [],
    dimensions: [
      { id: 'content', name: 'Content', weight: 95, description: 'Addresses the task with relevant reasons.', deductionFocus: [], sourceEvidence: [] },
      { id: 'legibility', name: 'Legibility', weight: 5, description: 'Writing is readable.', deductionFocus: [], sourceEvidence: [] },
    ] }
  const task = { taskId: 'synthetic-deepseek', fullScore: 15, materialSummary: rubric.materialSummary, writingRequirements: rubric.writingRequirements, constraints: [], rubric }
  const fixture = readFileSync(new URL('../../test-fixtures/kimi-policy/grammar-and-logic.png', import.meta.url))
  const started = Date.now()
  const response = rubricMode
    ? await request(app).post('/tasks/rubric').field({ requestId: 'synthetic-deepseek-rubric', fullScore: '15', writingRequirement: rubric.materialSummary,
      materialManifest: JSON.stringify([{ id: 'synthetic-page', kind: 'image', imageIndex: 0 }]) }).attach('images', fixture, { filename: 'synthetic.png', contentType: 'image/png' })
    : await request(app).post('/grading/grade-images').field('metadata', JSON.stringify({
      requestVersion: 'multimodal-grading-request-v2', requestId: 'synthetic-deepseek-image', essayId: 'synthetic-essay', pageIds: ['synthetic-page'], task,
    })).attach('pages', fixture, { filename: 'synthetic.png', contentType: 'image/png' })
  const body = response.body
  const summary = { status: response.status, resultStatus: body.status, resultVersion: body.resultVersion,
    errorCode: body.error?.code, elapsedMs: Date.now() - started, totalScore: body.totalScore,
    transcriptMatches: typeof body.transcript === 'string' ? body.transcript.includes('I suggest you joins the club.') && body.transcript.includes('The moon is made of green paper.') && !body.transcript.includes('CASE-A04') : undefined,
    dimensionCount: Array.isArray(body.dimensionScores) ? body.dimensionScores.length : undefined,
    rubricReturned: Boolean(body.rubric), shapeDiagnostic, diagnostics, metrics, usage: telemetry.snapshot() }
  if (reservation) writeFileSync(join(directory, `result-${reservation.ordinal}.json`), JSON.stringify(summary, null, 2), { flag: 'wx' })
  console.log(JSON.stringify(summary))
  if (response.status !== 200) process.exitCode = 1
}
main().catch(() => { console.error(JSON.stringify({ ok: false, code: 'smoke_stopped_safely', note: 'No automatic retry; check preflight and reserved ledger.' })); process.exitCode = 1 })
