import { calculateDimensionMaxScore } from "../../../app/src/services/grading/scoringRules.js";
import { isWellFormedUnicode } from "../../../app/src/services/grading/gradingResultSemantics.js";
import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../database.js";
import type {
  Command,
  EssayDto,
  TeacherReviewInput,
  ListQuery,
  Page,
} from "../../../shared/pilotContracts.js";
import { PilotError, invalid, notFound } from "./errors.js";
import {
  id,
  list,
  record,
  text,
  validateCommand,
  readListQuery,
} from "./validation.js";
import { checkRevision, ownedTask } from "./tasks.js";
import { payloadHash, runCommand } from "./commands.js";
import { ownedEssay, projectEssay, type EssayRow } from "./records.js";
export class PilotEssayRepository {
  constructor(private readonly db: Database) {}
  async get(owner: string, essay: string): Promise<EssayDto> {
    return projectEssay(this.db, await ownedEssay(this.db, owner, essay));
  }
  async list(
    owner: string,
    task: string,
    query: ListQuery,
  ): Promise<Page<EssayDto>> {
    await ownedTask(this.db, owner, task);
    const { limit, cursor } = readListQuery(query);
    const rows = (
      await this.db.query<EssayRow>(
        "SELECT * FROM pilot_grading.essays WHERE owner_id=$1 AND task_id=$2 AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4",
        [owner, task, cursor ?? null, limit + 1],
      )
    ).rows;
    return {
      items: await Promise.all(
        rows.slice(0, limit).map((r) => projectEssay(this.db, r)),
      ),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
  async attach(
    owner: string,
    task: string,
    input: Command<{ groups: { studentName: string; uploadIds: string[] }[] }>,
  ): Promise<Page<EssayDto>> {
    const c = validateCommand(input, false),
      v = record(c.value, ["groups"]);
    const groups = list(v.groups, 50).map((g) => {
      const x = record(g, ["studentName", "uploadIds"]);
      const uploads = list(x.uploadIds, 10).map(id);
      if (!uploads.length) return invalid();
      return {
        studentName: text(x.studentName, 200, true),
        uploadIds: uploads,
      };
    });
    if (
      !groups.length ||
      new Set(groups.flatMap((g) => g.uploadIds)).size !==
        groups.flatMap((g) => g.uploadIds).length
    )
      return invalid();
    return this.db.transaction(async (tx) => {
      await ownedTask(tx, owner, task);
      const ids = await runCommand(
        tx,
        owner,
        "essay:attach:" + task,
        c,
        payloadHash(c),
        async () => {
          const t = await ownedTask(tx, owner, task, true);
          if (t.state !== "confirmed") return invalid();
          let number = Number(
            (
              await tx.query<{ n: number }>(
                "SELECT coalesce(max(essay_number),0) AS n FROM pilot_grading.essays WHERE owner_id=$1 AND task_id=$2",
                [owner, task],
              )
            ).rows[0].n,
          );
          const ids: string[] = [];
          for (const group of groups) {
            const essay = randomUUID();
            number++;
            for (const upload of group.uploadIds) {
              const u = (
                await tx.query<{ state: string }>(
                  "SELECT state FROM pilot_grading.uploads WHERE owner_id=$1 AND task_id=$2 AND id=$3 AND purpose='essay' AND deleted_at IS NULL FOR UPDATE",
                  [owner, task, upload],
                )
              ).rows[0];
              if (!u) notFound();
              if (u.state === "attached")
                throw new PilotError("upload_already_attached", 409);
              if (u.state !== "verified")
                throw new PilotError("upload_incomplete", 409);
            }
            await tx.query(
              "INSERT INTO pilot_grading.essays(owner_id,task_id,id,student_name,essay_number) VALUES($1,$2,$3,$4,$5)",
              [
                owner,
                task,
                essay,
                group.studentName || "学生" + number,
                number,
              ],
            );
            await tx.query(
              "INSERT INTO pilot_grading.essay_sources(owner_id,task_id,essay_id,revision) VALUES($1,$2,$3,1)",
              [owner, task, essay],
            );
            for (const [i, upload] of group.uploadIds.entries()) {
              await tx.query(
                "INSERT INTO pilot_grading.essay_pages(owner_id,task_id,essay_id,upload_id,page_number) VALUES($1,$2,$3,$4,$5)",
                [owner, task, essay, upload, i + 1],
              );
              await tx.query(
                "UPDATE pilot_grading.uploads SET state='attached' WHERE owner_id=$1 AND id=$2",
                [owner, upload],
              );
            }
            ids.push(essay);
          }
          return ids;
        },
      );
      return {
        items: await Promise.all(
          ids.map(async (essay) =>
            projectEssay(tx, await ownedEssay(tx, owner, essay)),
          ),
        ),
        nextCursor: null,
      };
    });
  }
  private async edit(
    owner: string,
    essay: string,
    input: unknown,
    operation: string,
    apply: (tx: Queryable, row: EssayRow, value: unknown) => Promise<void>,
  ): Promise<EssayDto> {
    const c = validateCommand(input, true);
    return this.db.transaction(async (tx) => {
      await ownedEssay(tx, owner, essay);
      return runCommand(
        tx,
        owner,
        operation + essay,
        c,
        payloadHash(c),
        async () => {
          const row = await ownedEssay(tx, owner, essay, true);
          checkRevision(row.revision, c.expectedRevision);
          await apply(tx, row, c.value);
          await tx.query(
            "UPDATE pilot_grading.essays SET revision=revision+1,updated_at=now() WHERE owner_id=$1 AND id=$2",
            [owner, essay],
          );
          return projectEssay(tx, await ownedEssay(tx, owner, essay));
        },
      );
    });
  }
  saveTranscript(
    owner: string,
    essay: string,
    input: Command<{ text: string }>,
  ): Promise<EssayDto> {
    return this.edit(
      owner,
      essay,
      input,
      "essay:transcript:",
      async (tx, r, v) => {
        const raw = record(v, ["text"]).text;
        const value = text(raw, 50000);
        if (
          typeof raw !== "string" ||
          !isWellFormedUnicode(raw) ||
          raw.length > 50000
        )
          return invalid();
        await tx.query(
          "INSERT INTO pilot_grading.essay_sources(owner_id,task_id,essay_id,revision,confirmed_transcript) VALUES($1,$2,$3,$4,$5)",
          [owner, r.task_id, essay, r.source_revision + 1, value],
        );
        await tx.query(
          "UPDATE pilot_grading.essays SET source_revision=source_revision+1,confirmed_transcript=$3,current_result_job_id=NULL,teacher_reviewed=false WHERE owner_id=$1 AND id=$2",
          [owner, essay, value],
        );
      },
    );
  }
  markManual(
    owner: string,
    essay: string,
    input: Command<{ manualReviewRequired: true }>,
  ): Promise<EssayDto> {
    return this.edit(
      owner,
      essay,
      input,
      "essay:manual:",
      async (tx, _r, v) => {
        if (record(v, ["manualReviewRequired"]).manualReviewRequired !== true)
          return invalid();
        await tx.query(
          "UPDATE pilot_grading.essays SET manual_review_required=true,teacher_reviewed=false WHERE owner_id=$1 AND id=$2",
          [owner, essay],
        );
      },
    );
  }
  saveReview(
    owner: string,
    essay: string,
    input: Command<TeacherReviewInput>,
  ): Promise<EssayDto> {
    return this.edit(owner, essay, input, "essay:review:", async (tx, r, v) => {
      if (!r.current_result_job_id)
        throw new PilotError("result_required", 409);
      const t = await ownedTask(tx, owner, r.task_id),
        pkg = t.confirmed_package;
      if (!pkg) return invalid();
      const x = record(v, [
        "dimensionScores",
        "overallComment",
        "teacherSuggestion",
        "confirm",
      ]);
      if (typeof x.confirm !== "boolean") return invalid();
      const scores = list(x.dimensionScores, 10).map((value) => {
        const d = record(value, ["dimensionId", "score"]);
        const dimension = pkg.rubric.dimensions.find(
          (p) => p.id === d.dimensionId,
        );
        if (
          !dimension ||
          typeof d.score !== "number" ||
          !Number.isFinite(d.score) ||
          d.score < 0 ||
          d.score > calculateDimensionMaxScore(pkg.fullScore, dimension.weight)
        )
          return invalid();
        return { dimensionId: dimension.id, score: d.score };
      });
      if (
        scores.length !== pkg.rubric.dimensions.length ||
        new Set(scores.map((s) => s.dimensionId)).size !== scores.length
      )
        return invalid();
      const review: TeacherReviewInput = {
        dimensionScores: scores,
        overallComment: text(x.overallComment, 10000, true),
        teacherSuggestion: text(x.teacherSuggestion, 10000, true),
        confirm: x.confirm,
      };
      await tx.query(
        "INSERT INTO pilot_grading.teacher_reviews(owner_id,job_id,review) VALUES($1,$2,$3) ON CONFLICT(owner_id,job_id) DO UPDATE SET review=excluded.review,revision=pilot_grading.teacher_reviews.revision+1,updated_at=now()",
        [owner, r.current_result_job_id, JSON.stringify(review)],
      );
      await tx.query(
        "UPDATE pilot_grading.essays SET teacher_reviewed=$3,manual_review_required=CASE WHEN $3 THEN false ELSE manual_review_required END WHERE owner_id=$1 AND id=$2",
        [owner, essay, review.confirm],
      );
    });
  }
}
