import type { JobDto, TaskDto } from '../../../shared/pilotContracts'
import type { MaterialContextClient } from '../services/taskMaterial/materialClient'
import type { TaskMaterialRequestBase } from '../services/taskMaterial/types'
import type {
  RubricClient,
  RubricClientFailure,
} from '../services/taskRubric/types'
import type { PilotClient } from './client'

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted()
    const finish = () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    const abort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}
function failure(requestId: string, unknown = false): RubricClientFailure {
  return {
    requestId,
    status: 'failed',
    error: {
      code: unknown ? 'provider_result_unknown' : 'provider_unavailable',
      message: unknown
        ? '上次生成结果尚未确定，请稍后检查。当前评分标准仍可使用。'
        : '上次生成未得到可用结果。当前内容已保留，可直接填写评分标准。',
      retryable: false,
    },
  }
}
export function createPilotMaterialClients({
  client,
  taskDraft,
  pollMs = 2000,
}: {
  client: PilotClient
  taskDraft: (request: TaskMaterialRequestBase) => Promise<TaskDto>
  pollMs?: number
}): { materialClient: MaterialContextClient; rubricClient: RubricClient } {
  async function run(
    kind: 'rubric' | 'material_context',
    request: TaskMaterialRequestBase,
  ): Promise<NonNullable<JobDto['result']> | RubricClientFailure> {
    request.signal?.throwIfAborted()
    const task = await taskDraft(request)
    request.signal?.throwIfAborted()
    // A rubric response already includes material understanding; never launch a second hidden analysis.
    if (kind === 'material_context' && task.draft.materialContext)
      return task.draft.materialContext
    const previous = await client.listAssistance(task.id, request.signal)
    let job: JobDto | undefined =
      kind === 'material_context'
        ? (previous.find(
            (j) => j.kind === 'rubric' && j.state !== 'cancelled',
          ) ?? previous.find((j) => j.kind === kind))
        : previous.find((j) => j.kind === kind)
    if (!job)
      job = await client.enqueueMaterial(
        task.id,
        {
          commandId: crypto.randomUUID(),
          expectedRevision: task.revision,
          value: { kind },
        },
        request.signal,
      )
    while (job.state === 'queued' || job.state === 'running') {
      await delay(pollMs, request.signal)
      job = await client.getJob(job.id, request.signal)
    }
    request.signal?.throwIfAborted()
    if ((job.state === 'succeeded' || job.state === 'partial') && job.result)
      return job.result
    return failure(request.requestId, job.state === 'result_unknown')
  }
  return {
    rubricClient: {
      async generate(request) {
        const value = await run('rubric', request)
        if ('status' in value) return value
        if (!('dimensions' in value)) return failure(request.requestId)
        return {
          requestId: request.requestId,
          status: 'success',
          rubric: value,
        }
      },
    },
    materialClient: {
      async analyze(request) {
        const value = await run('material_context', request)
        if ('status' in value) return value
        const {
          materialSummary,
          writingRequirements,
          constraints,
          reviewWarnings,
        } = value
        return {
          requestId: request.requestId,
          status: 'success',
          materialContext: {
            materialSummary,
            writingRequirements,
            constraints,
            reviewWarnings,
          },
        }
      },
    },
  }
}
