# Phase 1 Static Prototype Design

## Goal

Build the first-stage static web prototype for Wenjie WriteWise AI. The prototype should let an English teacher understand the full workflow: create a grading task, upload essays, organize multi-page essays, monitor grading progress, review exceptions, inspect one essay result, and present class-level review material on a whiteboard.

## Scope

This phase uses mock data only. It does not connect to a backend, database, OCR service, AI grading service, account system, student roster, or Seewo whiteboard integration.

The prototype must cover:

- Task list and task creation.
- Essay upload simulation and multi-page organization.
- Batch processing progress.
- Exception review for low OCR confidence, blurry images, and hard-to-read handwriting.
- Single essay grading report with teacher-editable scores and comments.
- Class review page suitable for landscape whiteboard display.

Out of scope:

- Real file persistence beyond browser state.
- Real OCR or AI calls.
- Student login, teacher login, parent view, roster management, and formal exam marking.
- PDF/PPTX export.
- Deep integration with Seewo or other teaching platforms.

## Recommended Approach

Use a lightweight React application in `app`:

- Vite for local development and bundling.
- React and TypeScript for typed UI code.
- Tailwind CSS for fast, consistent styling.
- React Router for the documented routes.
- Local mock data files for tasks, essays, grading results, and class insights.

This approach keeps the first prototype fast to build while preserving a structure that can later be replaced with real APIs.

## Routes

- `/`: task list.
- `/tasks/new`: create a mock task.
- `/tasks/:taskId/upload`: essay upload and multi-page organization.
- `/tasks/:taskId/progress`: grading progress.
- `/tasks/:taskId/exceptions`: exception review.
- `/tasks/:taskId/essays/:essayId`: single essay result.
- `/tasks/:taskId/class-review`: class review page for computer or whiteboard display.

## Application Structure

The app should keep files small and responsibility-focused:

- `src/main.tsx`: React entry point.
- `src/App.tsx`: router setup.
- `src/types/index.ts`: domain types for tasks, essays, scores, revisions, and class insights.
- `src/data/mockData.ts`: mock tasks, essays, results, and class review data.
- `src/context/AppStateContext.tsx`: in-memory state for mock task creation and teacher edits.
- `src/layout/AppLayout.tsx`: shared shell with navigation.
- `src/components/*`: reusable UI components such as status badges, score breakdowns, upload panels, exception lists, and insight panels.
- `src/pages/*`: one page per route.
- `src/utils/*`: small helpers for score formatting, task lookup, and progress calculations.

## Data Model

The prototype data follows the PRD object model:

- `Task`: task metadata, class name, essay type, counts, status, and timestamps.
- `Essay`: essay number, page list, OCR text, confidence, status, exception reasons, and review flags.
- `GradingResult`: total score, dimension scores, error annotations, sentence revisions, upgraded expressions, overall comment, and teacher adjustment flag.
- `ClassInsight`: grammar errors, spelling errors, typical problem sentences, and rewrite exercises.

For phase 1, data can live in TypeScript objects. Teacher edits can update in-memory React state. Refresh persistence is not required.

## Interaction Design

The interface should feel like a teacher workbench, not a marketing website.

Key interactions:

- Create task form adds a task to in-memory state and sends the teacher to the upload page.
- Upload page simulates added pages and supports page grouping, page order changes, merge, and split actions visually.
- Progress page summarizes the queue and links to completed essays, exception review, and class review.
- Exception review lets the teacher edit OCR text, reorder page thumbnails, trigger simulated regrading, or mark an essay for manual grading.
- Essay result page lets the teacher adjust total score, dimension scores, annotations, revisions, and comments.
- Class review page uses larger type, fewer dense controls, and landscape-friendly sections.

## Visual Direction

Use a restrained professional interface:

- Clear sidebar or top-level navigation for task workflow.
- Compact but readable cards and tables for teacher scanning.
- Status badges for progress and exceptions.
- Strong visual hierarchy for scores, OCR confidence, and action areas.
- Whiteboard page should use larger typography and avoid cramped tables.

Avoid:

- Landing-page hero sections.
- Decorative gradient blobs or marketing composition.
- Student-name-dependent UI.
- Heavy visual noise that distracts from grading work.

## Error Handling And Empty States

The prototype should handle missing or invalid route IDs with a simple not-found state and a link back to the task list.

Pages should show useful empty states when:

- No task exists.
- A task has no exceptions.
- A task has no completed essays.

Because this is a static prototype, errors should be displayed inline rather than relying on global notifications.

## Testing And Verification

Use automated checks where they add confidence without overbuilding the prototype:

- Unit tests for progress calculations and data lookup helpers.
- Component or integration tests for key user-visible state changes if the tooling is available in the scaffold.
- Manual verification through the running Vite app for every required route.

Before marking phase 1 complete:

- Run the package check commands available in `app`, such as lint, tests, and build.
- Start the local dev server.
- Verify the app opens in a browser at the local preview URL.
- Check desktop and whiteboard-like landscape layouts.
- Commit and push the completed milestone to GitHub.

## Git And Safety Rules

All work stays under `D:\wenjie-writewise-ai`.

Do not delete unknown files. Clean only confirmed generated or temporary files from this task, such as failed scaffold remnants, build output, caches, or logs. Keep source files, docs, mock data, and user-provided assets.

Commit and push meaningful milestones:

- Design spec.
- Implementation plan.
- Working phase 1 prototype.
- Any later substantial revision.

