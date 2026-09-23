import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import request from 'supertest'
import { parseGatewayRuntimeConfig } from '../src/gatewayRuntimeConfig.js'
import { createServer } from '../src/server.js'
import { getMultimodalProvider } from '../src/providers/index.js'
import { loadOpenRouterEnvironment } from './openRouterEnvironment.js'

const MAX_CALLS = 5

function safeError(error: unknown) {
  if (!error || typeof error !== 'object') return { code: 'unknown' }
  const record = error as Record<string, unknown>
  return {
    code: typeof record.code === 'string' ? record.code : 'unknown',
    retryable: typeof record.retryable === 'boolean' ? record.retryable : undefined,
    diagnosticCode: typeof record.diagnosticCode === 'string' ? record.diagnosticCode : undefined,
  }
}

function writeLedger(value: unknown) {
  writeFileSync(ledgerPath, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' })
}

const runAuthorized = process.argv.includes('--run-authorized')
const manualRubricMode = process.argv.includes('--manual-rubric')
if (!runAuthorized) {
  throw new Error('Refusing real calls without --run-authorized.')
}
const env = loadOpenRouterEnvironment()
const model = env.OPENROUTER_MODEL ?? 'unknown-model'
const ledgerName = `openrouter-smoke-${model.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}-20260923.json`
const ledgerPath = fileURLToPath(new URL(`../local-private-results/${ledgerName}`, import.meta.url))
mkdirSync(fileURLToPath(new URL('../local-private-results/', import.meta.url)), { recursive: true })
if (existsSync(ledgerPath) && !manualRubricMode) {
  throw new Error('Smoke ledger already exists; refusing to create duplicate real calls.')
}

const startedAt = new Date().toISOString()
const apiKey = env.OPENROUTER_API_KEY
if (!apiKey) throw new Error('OPENROUTER_API_KEY is missing from the ignored local file.')
if (!existsSync(ledgerPath)) writeLedger({ startedAt, model, maxCalls: MAX_CALLS, calls: [] })
const runtimeConfig = parseGatewayRuntimeConfig(env)
const provider = getMultimodalProvider(runtimeConfig, { apiKey })
const app = createServer({ runtimeConfig, multimodalProvider: provider, allowedOrigin: env.GRADING_ALLOWED_ORIGIN })
const fixtureA = readFileSync(fileURLToPath(new URL('../../test-fixtures/kimi-policy/grammar-and-logic.png', import.meta.url)))
const fixtureB = readFileSync(fileURLToPath(new URL('../../test-fixtures/kimi-policy/clear-enviroment.png', import.meta.url)))
const base = {
  requestId: 'synthetic-rubric-20260923', fullScore: '15', writingRequirement: 'Recommend a school club in clear English.',
  materialManifest: JSON.stringify([{ id: 'synthetic-prompt', kind: 'text', textIndex: 0 }]),
  textMaterials: JSON.stringify([{ displayName: 'Synthetic prompt', text: 'Recommend a school club and explain two reasons.' }]),
}
const record = JSON.parse(readFileSync(ledgerPath, 'utf8')) as { model?: string; calls: Array<Record<string, unknown>>; completedAt?: string }
if (record.model !== model) throw new Error('Smoke ledger model does not match the selected model.')
const call = async (stage: string, execute: () => Promise<{ status: number; body: Record<string, unknown> }>) => {
  if (record.calls.length >= MAX_CALLS) throw new Error('Smoke call cap reached.')
  const ordinal = record.calls.length + 1
  const started = Date.now()
  const entry: Record<string, unknown> = { ordinal, stage, reservedAt: new Date().toISOString() }
  record.calls.push(entry)
  writeFileSync(ledgerPath, JSON.stringify(record, null, 2), 'utf8')
  try {
    const response = await execute()
    entry.status = response.status
    entry.resultStatus = typeof response.body.status === 'string' ? response.body.status : undefined
    entry.errorCode = response.body.error && typeof response.body.error === 'object'
      ? safeError(response.body.error).code : undefined
    entry.elapsedMs = Date.now() - started
    writeFileSync(ledgerPath, JSON.stringify(record, null, 2), 'utf8')
    return response
  } catch (error) {
    entry.error = safeError(error)
    entry.elapsedMs = Date.now() - started
    writeFileSync(ledgerPath, JSON.stringify(record, null, 2), 'utf8')
    throw error
  }
}

let rubric: {
  materialSummary: string
  writingRequirements: string[]
  constraints: string[]
  [key: string]: unknown
}
if (manualRubricMode) {
  rubric = {
    taskName: 'Synthetic club recommendation',
    materialSummary: 'Recommend a school club and explain two reasons.',
    writingRequirements: ['Use clear English and give two relevant reasons.'],
    constraints: [],
    reviewWarnings: [],
    dimensions: [
      { id: 'content', name: 'Content', weight: 95, description: 'Addresses the task with relevant reasons.', deductionFocus: [], sourceEvidence: [] },
      { id: 'legibility', name: 'Legibility', weight: 5, description: 'Writing is readable.', deductionFocus: [], sourceEvidence: [] },
    ],
  }
} else {
  const rubricResponse = await call('rubric_generation', () => request(app).post('/tasks/rubric').field(base))
  if (rubricResponse.status !== 200 || !rubricResponse.body.rubric) throw new Error('Rubric smoke call did not return a rubric.')
  rubric = rubricResponse.body.rubric as typeof rubric
}
const task = {
  taskId: 'synthetic-task-20260923', fullScore: 15, materialSummary: rubric.materialSummary,
  writingRequirements: rubric.writingRequirements, constraints: rubric.constraints, rubric,
}
const metadata = {
  requestVersion: 'multimodal-grading-request-v2', requestId: 'synthetic-grade-20260923', essayId: 'synthetic-essay-1',
  pageIds: ['synthetic-page-1', 'synthetic-page-2'], task,
}
const gradeResponse = await call('essay_grading_images', () => request(app).post('/grading/grade-images')
  .field('metadata', JSON.stringify(metadata))
  .attach('pages', fixtureA, { filename: 'synthetic-page-1.png', contentType: 'image/png' })
  .attach('pages', fixtureB, { filename: 'synthetic-page-2.png', contentType: 'image/png' }))
if (gradeResponse.status !== 200) throw new Error(`Image grading smoke call failed with HTTP ${gradeResponse.status}.`)
const regradeMetadata = { ...metadata, requestId: 'synthetic-regrade-20260923', pageIds: [], confirmedTranscript: 'Teacher confirmed synthetic transcript.' }
const regradeResponse = await call('essay_regrading_text', () => request(app).post('/grading/grade-images')
  .field('metadata', JSON.stringify(regradeMetadata)))
if (regradeResponse.status !== 200) throw new Error(`Text regrading smoke call failed with HTTP ${regradeResponse.status}.`)
record.completedAt = new Date().toISOString()
writeFileSync(ledgerPath, JSON.stringify(record, null, 2), 'utf8')
console.log(JSON.stringify({ ok: true, model: runtimeConfig.openrouter?.model, calls: record.calls.map(({ ordinal, stage, status, resultStatus, elapsedMs }) => ({ ordinal, stage, status, resultStatus, elapsedMs })) }))
