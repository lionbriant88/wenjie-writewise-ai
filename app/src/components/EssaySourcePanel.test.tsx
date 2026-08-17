import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Essay } from '../types'
import type { ReviewIssueCardItem } from '../utils/reviewIssueItems'
import { buildSourceIssueMarkers } from '../utils/sourceIssueMarkers'
import { EssaySourcePanel } from './EssaySourcePanel'

const kimiEssay: Essay = {
  id: 'essay-1', taskId: 'task-1', essayNumber: '作文 1', pages: [], pageCount: 0, pageOrder: [],
  ocrText: 'Kimi faithfully recognized student text.', transcriptSource: 'kimi_vision', ocrConfidence: 0,
  status: 'grading_ready', exceptionReasons: [], aiResultId: 'essay-1-result', teacherReviewed: false,
  gradingRun: { status: 'success', requestId: 'request-1', source: 'remote', reviewReasons: [], startedAt: 'started', completedAt: 'finished' },
  createdAt: 'created', updatedAt: 'updated',
}

describe('EssaySourcePanel', () => {
  it('shows Kimi recognition warnings and printed-text status without exposing printed source text', () => {
    render(
      <EssaySourcePanel
        essay={kimiEssay}
        transcriptionWarnings={['Final word is unclear.']}
        printedTextExcluded
        onOcrTextChange={vi.fn()}
        onViewOriginalImage={vi.fn()}
      />,
    )

    expect(screen.getByText('Kimi 图像识别结果，建议结合原图复核。')).toBeInTheDocument()
    expect(screen.queryByText(/识别置信度/)).not.toBeInTheDocument()
    expect(screen.getByText('已排除试卷印刷提示，仅保留学生作答内容。')).toBeInTheDocument()
    expect(screen.getByText('Final word is unclear.')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('printed source text')
  })

  it('drops an unsaved draft and returns to read mode when a different essay is shown', async () => {
    const user = userEvent.setup()
    const onOcrTextChange = vi.fn()
    const essayB = { ...kimiEssay, id: 'essay-2', ocrText: kimiEssay.ocrText }
    const view = render(<EssaySourcePanel essay={kimiEssay} onOcrTextChange={onOcrTextChange} onViewOriginalImage={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '复核识别结果' }))
    await user.clear(screen.getByLabelText('学生作文识别文本'))
    await user.type(screen.getByLabelText('学生作文识别文本'), 'Unsaved essay A draft.')
    view.rerender(<EssaySourcePanel essay={essayB} onOcrTextChange={onOcrTextChange} onViewOriginalImage={vi.fn()} />)

    expect(screen.queryByLabelText('学生作文识别文本')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '复核识别结果' }))
    expect(screen.getByLabelText('学生作文识别文本')).toHaveValue('Kimi faithfully recognized student text.')
    await user.clear(screen.getByLabelText('学生作文识别文本'))
    await user.type(screen.getByLabelText('学生作文识别文本'), 'Essay B correction.')
    await user.click(screen.getByRole('button', { name: '保存识别文本并使旧结果失效' }))
    expect(onOcrTextChange).toHaveBeenCalledWith('essay-2', 'Essay B correction.')
  })

  it('synchronizes a same-essay draft when its saved recognition text changes', async () => {
    const user = userEvent.setup()
    const view = render(<EssaySourcePanel essay={kimiEssay} onOcrTextChange={vi.fn()} onViewOriginalImage={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '复核识别结果' }))
    view.rerender(<EssaySourcePanel essay={{ ...kimiEssay, ocrText: 'Updated Kimi text.' }} onOcrTextChange={vi.fn()} onViewOriginalImage={vi.fn()} />)
    expect(screen.getByLabelText('学生作文识别文本')).toHaveValue('Updated Kimi text.')
  })

  it('blocks recognition editing while grading is running and explains why', () => {
    render(
      <EssaySourcePanel
        essay={{ ...kimiEssay, status: 'grading', gradingRun: { status: 'running', requestId: 'request-1', startedAt: 'started' } }}
        onOcrTextChange={vi.fn()}
        onViewOriginalImage={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '复核识别结果' })).toBeDisabled()
    expect(screen.getByText('批改完成后再编辑')).toBeInTheDocument()
  })

  it('highlights a shared-range marker when its secondary issue is active', () => {
    render(
      <EssaySourcePanel
        essay={kimiEssay}
        activeIssueId="issue-secondary"
        issueMarkers={[{
          issueId: 'issue-primary', issueIds: ['issue-primary', 'issue-secondary'], source: 'language', severity: 'medium',
          original: 'student text', matchedText: 'student text', start: 27, end: 39,
        }]}
        onOcrTextChange={vi.fn()}
        onViewOriginalImage={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '查看问题：student text' })).toHaveAttribute('data-active', 'true')
  })

  it('renders nested issue ranges as flat segments with deterministic active ids and click ownership', async () => {
    const user = userEvent.setup()
    const essay = { ...kimiEssay, ocrText: 'Before outer inner tail after.' }
    const nestedIssues: ReviewIssueCardItem[] = [
      {
        id: 'outer-high', source: 'language', typeLabel: 'structure', severity: 'high',
        original: 'outer inner tail', suggestion: 'outer revised tail', explanation: 'Outer issue.',
      },
      {
        id: 'inner-medium', source: 'logic', typeLabel: 'unclear_logic', severity: 'medium',
        original: 'inner', diagnosis: 'Inner issue.', suggestedActionLabel: 'Clarify it.',
      },
    ]
    const issueMarkers = buildSourceIssueMarkers(essay.ocrText, nestedIssues)
    const onIssueMarkerSelect = vi.fn()
    const renderPanel = (activeIssueId: string) => (
      <EssaySourcePanel
        essay={essay}
        activeIssueId={activeIssueId}
        issueMarkers={issueMarkers}
        onIssueMarkerSelect={onIssueMarkerSelect}
        onOcrTextChange={vi.fn()}
        onViewOriginalImage={vi.fn()}
      />
    )
    const view = render(renderPanel('outer-high'))
    const markerButtons = () => [...view.container.querySelectorAll<HTMLElement>('[data-issue-source]')]

    expect(markerButtons().map(({ textContent }) => textContent)).toEqual(['outer ', 'inner', ' tail'])
    expect(view.container.querySelector('button button')).toBeNull()
    expect(markerButtons().map((button) => button.dataset.active)).toEqual(['true', 'true', 'true'])

    view.rerender(renderPanel('inner-medium'))
    expect(markerButtons().map((button) => button.dataset.active)).toEqual(['false', 'true', 'false'])

    await user.click(screen.getByRole('button', { name: '查看问题：inner' }))
    expect(onIssueMarkerSelect).toHaveBeenCalledWith('outer-high')
  })
})
