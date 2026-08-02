import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Essay } from '../types'
import { EssaySourcePanel } from './EssaySourcePanel'

const kimiEssay: Essay = {
  id: 'essay-1', taskId: 'task-1', essayNumber: '作文 1', pages: [], pageCount: 0, pageOrder: [],
  ocrText: 'Kimi faithfully recognized student text.', transcriptSource: 'kimi_vision', ocrConfidence: 0.8,
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
    expect(screen.getByText('已排除试卷印刷提示，仅保留学生作答内容。')).toBeInTheDocument()
    expect(screen.getByText('Final word is unclear.')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('printed source text')
  })
})
