# Phase 1 UX Polish Design

## Goal

Polish the existing Wenjie WriteWise AI phase 1 static prototype so it feels more useful in a teacher review session. The app already demonstrates the full workflow; this pass should make the workflow clearer, the next action easier to find, and the interface more concise with a restrained technology style.

## Scope

This pass stays within the existing React prototype under `app`.

In scope:

- Improve page hierarchy, spacing, and scan efficiency.
- Add clearer workflow orientation and next-step cues.
- Improve narrow-screen navigation and task/essay list readability.
- Strengthen action areas on progress, exception review, and essay result pages.
- Refine the visual style to feel concise, professional, and lightly technological.

Out of scope:

- Real OCR, AI, backend, persistence, login, or file upload.
- Major route changes.
- Replacing mock data with real data.
- A marketing landing page.
- Heavy visual redesign that would obscure the teacher workflow.

## Recommended Approach

Use a focused workflow polish rather than a full redesign.

The current prototype already has the right product shape: task list, upload, progress, exception review, essay result, and class review. The main weakness is not missing pages; it is that teachers need faster orientation. The polish should keep the current structure but add clearer workflow signals and more purposeful action placement.

## Visual Direction

The interface should feel clean and lightly technological, not decorative.

Use:

- White and very light gray surfaces for clarity.
- Slate text for professional readability.
- Blue as the primary action color.
- Small cyan or indigo accents for the technology feel.
- Thin borders, subtle shadows, and compact status chips.
- Icons in workflow navigation and key action buttons.
- Stable card dimensions and dense but comfortable spacing.

Avoid:

- Large hero sections.
- Gradient blob or orb decoration.
- Purple-heavy or one-hue visual themes.
- Overly rounded cards or playful styling.
- Dense tables on narrow screens when card rows would be easier to scan.

## Workflow Orientation

Each task page should make the teacher understand three things quickly:

- Which task and class they are viewing.
- Which workflow step they are on.
- What the next useful action is.

Add or refine a compact workflow strip for task pages:

1. Upload and organize
2. Batch progress
3. Review exceptions
4. Essay results
5. Class review

On desktop, this can appear in the left navigation or page header. On narrow screens, it should become a horizontal shortcut row near the top of the page so the workflow does not disappear when the sidebar is hidden.

## Micro-Interactions

Use very light micro-interactions to reinforce the feeling that AI processing is active and responsive. These interactions should be subtle enough for a teacher workbench and should not distract from grading.

Recommended interactions:

- Status chips should use smooth color and background transitions when their state changes.
- Processing or grading states can include a very subtle pulse or shimmer, limited to the chip or small status indicator.
- Completed states can briefly show a checkmark or success accent when a simulated state transition finishes.
- Score or OCR edits should show a small inline success checkmark or toast after saving.
- Button feedback should feel immediate, with pressed, disabled, and saved states clearly visible.

Constraints:

- Avoid large page transitions, bouncing motion, confetti, or decorative animation.
- Keep animation durations short, roughly 150 to 250 ms for transitions and under 1 second for temporary success feedback.
- Respect users who prefer reduced motion by disabling non-essential animation under `prefers-reduced-motion`.
- Do not add a third-party animation library for this pass unless the existing stack already needs it.

## Page-Specific Changes

### Task List

Make task cards easier to scan:

- Surface the strongest next action for each task.
- Emphasize exceptions when a task needs review.
- Keep counts grouped but reduce empty visual space.
- Preserve links to continue task and view class review.

### Progress Page

Add a next-action panel above the essay list:

- If exceptions exist, prompt the teacher to review them first.
- If all essays are complete, prompt class review.
- If processing remains, show that the queue is simulated.

For wide screens, keep the table. For narrow screens, convert essay rows into compact cards with status, OCR confidence, page count, and action.

Status chips on this page should communicate movement. For example, a simulated "批改中" item becoming "已完成" should transition color smoothly and briefly show a checkmark, so the teacher perceives that the system is actively working.

### Exception Review

Make exception handling feel like a review workbench:

- Keep image preview and OCR editor close together.
- Put confidence and exception reason near the essay title.
- Group primary actions in a consistent action bar.
- Make the primary action "重新批改" or equivalent visually distinct from secondary actions such as "标记人工批改".

### Essay Result

Make the score and teacher adjustment workflow easier to read:

- Add a compact score summary near the top.
- Keep OCR confidence visible but secondary.
- Group save/adjustment actions near editable score and comment sections.
- Keep error annotations, revision suggestions, and upgraded expressions distinct.
- After the teacher saves score or comment adjustments, show a lightweight success confirmation through an inline checkmark or compact toast.

### Class Review

Keep the whiteboard-friendly direction, but make it feel more presentation-ready:

- Use a concise top panel for task/class context.
- Keep large type and generous line height.
- Use subtle technology accents, such as slim colored section markers.
- Avoid putting too much material above the fold.

## Component Boundaries

Prefer small additions over large rewrites:

- Add a reusable workflow navigation component if it can serve multiple pages.
- Add a reusable next-action panel if progress and task list both need it.
- Refine existing cards, badges, and lists instead of creating a new design system.
- Keep page components responsible for page-specific decisions.

## Responsive Design

Desktop:

- Preserve the sidebar workflow navigation.
- Keep tables where they improve scan efficiency.
- Use denser card grids where the current layout feels too sparse.

Mobile or narrow browser:

- Add top workflow shortcuts because the sidebar is hidden.
- Replace wide tables with cards.
- Keep primary actions visible without horizontal scrolling.
- Ensure button text fits and does not overlap.

## Error Handling And Empty States

Do not change the data model or error model. Keep existing not-found and empty states, but make them more action-oriented when touched:

- Empty exception state should point to progress or class review.
- Missing task or essay should offer a return to the task list.

## Testing And Verification

Run the existing checks after implementation:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Use the local browser to verify:

- Task list is easier to scan.
- Progress page clearly suggests the next action.
- Progress status chips have subtle transitions and do not distract from scanning.
- Exception review actions are grouped and obvious.
- Essay result page has clearer score hierarchy.
- Saving teacher adjustments gives clear lightweight success feedback.
- Class review remains whiteboard-friendly.
- Narrow mobile-sized viewport does not hide workflow navigation or force awkward table scanning.

## Success Criteria

The polish is successful when a teacher can open a task and immediately answer:

- Where am I in the grading workflow?
- Which essays still need attention?
- What should I do next?
- Where do I go for class-level review material?

The visual style should read as simple, modern, and slightly technological without turning into a marketing page.
