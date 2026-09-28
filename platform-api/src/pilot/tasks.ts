import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../database.js";
import type {
  Command,
  TaskDto,
  TaskDraftInput,
  ListQuery,
  Page,
} from "../../../shared/pilotContracts.js";
import { validateConfirmedRubric } from "../../../grading-gateway/src/multimodal/validateRubric.js";
import {
  id,
  validateCommand,
  validateDraft,
  readListQuery,
  record,
} from "./validation.js";
import { PilotError, invalid, notFound } from "./errors.js";
import { payloadHash, runCommand } from "./commands.js";
import { syncMaterialUploads } from "./materialUploads.js";
type TaskRow = Record<string, unknown> & {
  id: string;
  revision: number;
  rubric_revision: number;
  state: TaskDto["state"];
  draft: TaskDraftInput;
  confirmed_package: TaskDto["confirmedPackage"];
  created_at: Date | string;
  updated_at: Date | string;
};
export function projectTask(row: TaskRow): TaskDto {
  return {
    id: row.id,
    revision: row.revision,
    rubricRevision: row.rubric_revision,
    state: row.state,
    draft: row.draft,
    confirmedPackage: row.confirmed_package,
    counts: { total: 0, completed: 0, exceptions: 0 },
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
export async function ownedTask(
  tx: Queryable,
  ownerId: string,
  taskId: string,
  lock = false,
): Promise<TaskRow> {
  const row = (
    await tx.query<TaskRow>(
      `SELECT * FROM pilot_grading.tasks WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL${lock ? " FOR UPDATE" : ""}`,
      [id(ownerId), id(taskId)],
    )
  ).rows[0];
  return row ?? notFound();
}
export function checkRevision(actual: number, expected?: number): void {
  if (actual !== expected) throw new PilotError("revision_conflict", 409);
}
export class PilotTaskRepository {
  constructor(private readonly db: Database) {}
  async get(ownerId: string, taskId: string): Promise<TaskDto> {
    return projectTask(await ownedTask(this.db, ownerId, taskId));
  }
  async list(ownerId: string, query: ListQuery): Promise<Page<TaskDto>> {
    const { limit, cursor } = readListQuery(query);
    const rows = (
      await this.db.query<TaskRow>(
        "SELECT * FROM pilot_grading.tasks WHERE owner_id=$1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3",
        [id(ownerId), cursor ?? null, limit + 1],
      )
    ).rows;
    return {
      items: rows.slice(0, limit).map(projectTask),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
  async createDraft(
    ownerId: string,
    input: Command<TaskDraftInput>,
  ): Promise<TaskDto> {
    const c = validateCommand(input, false);
    const draft = validateDraft(c.value);
    return this.db.transaction(async (tx) => {
      const result = await runCommand(
        tx,
        id(ownerId),
        "task:create",
        c,
        payloadHash(c.value),
        async () => {
          const taskId = randomUUID();
          await tx.query(
            "INSERT INTO pilot_grading.tasks(owner_id,id,draft) VALUES($1,$2,$3)",
            [ownerId, taskId, JSON.stringify(draft)],
          );
          await syncMaterialUploads(tx, ownerId, taskId, draft.materialRefs);
          return projectTask(await ownedTask(tx, ownerId, taskId));
        },
      );
      await ownedTask(tx, ownerId, result.id);
      return result;
    });
  }
  async saveDraft(
    ownerId: string,
    taskId: string,
    input: Command<TaskDraftInput>,
  ): Promise<TaskDto> {
    const c = validateCommand(input, true);
    const draft = validateDraft(c.value);
    return this.db.transaction(async (tx) => {
      await ownedTask(tx, ownerId, taskId);
      return runCommand(
        tx,
        ownerId,
        "task:save:" + taskId,
        c,
        payloadHash(c),
        async () => {
          const current = await ownedTask(tx, ownerId, taskId, true);
          checkRevision(current.revision, c.expectedRevision);
          if (current.state !== "draft")
            throw new PilotError("task_already_confirmed", 409);
          await syncMaterialUploads(tx, ownerId, taskId, draft.materialRefs);
          await tx.query(
            "UPDATE pilot_grading.tasks SET draft=$3,revision=revision+1,updated_at=now() WHERE owner_id=$1 AND id=$2",
            [ownerId, taskId, JSON.stringify(draft)],
          );
          return projectTask(await ownedTask(tx, ownerId, taskId));
        },
      );
    });
  }
  async confirm(
    ownerId: string,
    taskId: string,
    input: Command<Record<string, never>>,
  ): Promise<TaskDto> {
    const c = validateCommand(input, true);
    record(c.value, []);
    return this.db.transaction(async (tx) => {
      await ownedTask(tx, ownerId, taskId);
      return runCommand(
        tx,
        ownerId,
        "task:confirm:" + taskId,
        c,
        payloadHash(c),
        async () => {
          const current = await ownedTask(tx, ownerId, taskId, true);
          checkRevision(current.revision, c.expectedRevision);
          if (current.state !== "draft")
            throw new PilotError("task_already_confirmed", 409);
          const d = current.draft;
          if (!d.fullScore || !d.writingRequirement) return invalid();
          const context = d.materialContext ?? {
            materialSummary: "教师确认的写作要求：" + d.writingRequirement,
            writingRequirements: [],
            constraints: [],
            reviewWarnings: [],
          };
          const rubric = validateConfirmedRubric({
            taskName: d.taskName || "作文批改任务",
            ...context,
            writingRequirements: [
              ...new Set([
                d.writingRequirement,
                ...context.writingRequirements,
              ]),
            ],
            dimensions: d.dimensions,
          });
          if (!rubric.ok) return invalid();
          const { materialSummary, writingRequirements, constraints } =
            rubric.value;
          const pkg = {
            taskId,
            fullScore: d.fullScore,
            materialSummary,
            writingRequirements,
            constraints,
            rubric: rubric.value,
          };
          const revision = current.rubric_revision + 1;
          await tx.query(
            "INSERT INTO pilot_grading.task_revisions(owner_id,task_id,revision,package) VALUES($1,$2,$3,$4)",
            [ownerId, taskId, revision, JSON.stringify(pkg)],
          );
          await tx.query(
            "UPDATE pilot_grading.tasks SET confirmed_package=$3,state='confirmed',rubric_revision=$4,revision=revision+1,updated_at=now() WHERE owner_id=$1 AND id=$2",
            [ownerId, taskId, JSON.stringify(pkg), revision],
          );
          return projectTask(await ownedTask(tx, ownerId, taskId));
        },
      );
    });
  }
}
