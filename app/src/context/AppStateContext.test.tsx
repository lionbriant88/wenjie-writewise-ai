import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { confirmOcrAudit, createPendingOcrAudit } from '../services/ocr/audit/transcriptAudit'
import type { Essay } from '../types'
import { AppStateProvider } from './AppStateContext'
import { useAppState } from './useAppState'

const pendingAudit = createPendingOcrAudit({
  sourceKind: 'remote',
  result: {
    essayGroupId: 'group-1',
    text: 'Client final source',
    pages: [{ pageId: 'page-1', text: 'Client final source' }],
    provider: 'remote',
    status: 'success',
  },
  expectedPageIds: ['page-1'],
  assessedAt: '2026-07-12T02:55:00.000Z',
})

function StateHarness() {
  const { essays, confirmMockOcrEssay, updateEssayOcrText } = useAppState()
  const createdEssay = essays.find((essay) => essay.id.includes('-uploaded-'))

  const createEssay = () => {
    confirmMockOcrEssay({
      taskId: 'task-1',
      essayGroups: [
        {
          pages: [{ id: 'page-1', label: 'Synthetic page', pageNumber: 1, quality: 'clear', accent: '#000000' }],
          ocrText: 'Teacher faithful text',
          ocrAudit: confirmOcrAudit(pendingAudit, 'Teacher faithful text', '2026-07-12T03:00:00.000Z'),
        },
      ],
    })
  }

  const correctEssay = () => {
    if (!createdEssay) return
    updateEssayOcrText(createdEssay.id, 'Later faithful correction', '2026-07-12T03:05:00.000Z')
  }

  return (
    <>
      <button type="button" onClick={createEssay}>Create essay</button>
      <button type="button" onClick={correctEssay}>Correct essay</button>
      <pre data-testid="created-essay">{JSON.stringify(createdEssay ?? null)}</pre>
    </>
  )
}

function readCreatedEssay(): Essay {
  return JSON.parse(screen.getByTestId('created-essay').textContent ?? 'null') as Essay
}

describe('AppStateContext OCR audit lifecycle', () => {
  it('persists confirmed audit data and preserves source text on later correction', async () => {
    const user = userEvent.setup()
    render(
      <AppStateProvider>
        <StateHarness />
      </AppStateProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Create essay' }))
    const createdEssay = readCreatedEssay()

    expect(createdEssay.ocrText).toBe('Teacher faithful text')
    expect(createdEssay.ocrAudit?.sourceText).toBe('Client final source')
    expect(createdEssay.ocrAudit?.confirmedTranscript).toBe('Teacher faithful text')
    expect(createdEssay.ocrAudit?.reviewOutcome.confirmedAt).toBe('2026-07-12T03:00:00.000Z')

    await user.click(screen.getByRole('button', { name: 'Correct essay' }))
    const updatedEssay = readCreatedEssay()

    expect(updatedEssay.ocrText).toBe('Later faithful correction')
    expect(updatedEssay.ocrAudit?.sourceText).toBe('Client final source')
    expect(updatedEssay.ocrAudit?.confirmedTranscript).toBe('Later faithful correction')
    expect(updatedEssay.ocrAudit?.reviewOutcome.confirmedAt).toBe('2026-07-12T03:05:00.000Z')
  })
})
