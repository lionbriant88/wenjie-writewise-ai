import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ClassReviewIssueBlockV1 } from '../services/classReview/types'
import { ClassReviewIssueList } from './ClassReviewIssueList'

function block(id: string, overrides: Partial<ClassReviewIssueBlockV1> = {}): ClassReviewIssueBlockV1 {
  return {
    blockId: id,
    topicKey: `topic.${id}`,
    origin: 'teacher',
    title: `问题 ${id}`,
    diagnosis: `诊断 ${id}`,
    teachingAction: `建议 ${id}`,
    severity: 'medium',
    teacherStudentCount: 1,
    systemStudentCount: 0,
    combinedStudentCount: 1,
    occurrenceCount: 1,
    supportDenominator: null,
    anonymousExamples: [`example ${id}`],
    evidenceRefs: [{
      evidenceId: `evidence.${id}`,
      selectionOrigin: 'teacher_selected',
      sourceLocator: `language.${id}`,
      sourceResultRevision: 0,
      anonymousExample: `example ${id}`,
    }],
    ...overrides,
  }
}

describe('ClassReviewIssueList', () => {
  it('renders issueOrder as the source of display order and limits examples to three', () => {
    render(
      <ClassReviewIssueList
        issueBlocks={[
          block('a', { anonymousExamples: ['a1', 'a2', 'a3', 'a4'] }),
          block('b'),
        ]}
        issueOrder={['b', 'a']}
      />,
    )

    expect(screen.getAllByRole('article').map((item) => item.textContent)).toEqual([
      expect.stringContaining('问题 b'),
      expect.stringContaining('问题 a'),
    ])
    expect(screen.getByText('a1')).toBeInTheDocument()
    expect(screen.getByText('a3')).toBeInTheDocument()
    expect(screen.queryByText('a4')).not.toBeInTheDocument()
  })

  it('separates system support from teacher additions and keeps move/remove/undo accessible', async () => {
    const user = userEvent.setup()
    const onMove = vi.fn()
    const onRemove = vi.fn()
    const onUndo = vi.fn()
    render(
      <ClassReviewIssueList
        issueBlocks={[
          block('system', {
            origin: 'ai',
            systemStudentCount: 7,
            teacherStudentCount: 1,
            combinedStudentCount: 8,
            occurrenceCount: 9,
            supportDenominator: 12,
            evidenceRefs: [
              {
                evidenceId: 'system.ref',
                selectionOrigin: 'system_generation',
                sourceLocator: 'group.system',
                sourceResultRevision: 0,
                anonymousExample: 'system example',
              },
              {
                evidenceId: 'teacher.ref',
                selectionOrigin: 'teacher_selected',
                sourceLocator: 'language.teacher',
                sourceResultRevision: 1,
                anonymousExample: 'teacher example',
              },
            ],
          }),
          block('manual'),
        ]}
        issueOrder={['system', 'manual']}
        onMoveIssue={onMove}
        onRemoveTeacherEvidence={onRemove}
        onUndoRemove={onUndo}
      />,
    )

    const systemCard = screen.getAllByRole('article')[0]
    expect(within(systemCard).getByText('系统支持 7 / 12')).toBeInTheDocument()
    expect(within(systemCard).getByText('教师添加 1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '下移：问题 system' }))
    expect(onMove).toHaveBeenCalledWith('system', 1)

    await user.click(within(systemCard).getByRole('button', { name: '移出手动添加' }))
    expect(onRemove).toHaveBeenCalledWith('teacher.ref')
    expect(screen.getByRole('button', { name: '撤销移出' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: '撤销移出' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
  })
})
