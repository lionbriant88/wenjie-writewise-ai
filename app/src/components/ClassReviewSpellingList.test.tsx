import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ClearSpellingItemV1 } from '../services/classReview/types'
import { ClassReviewSpellingList } from './ClassReviewSpellingList'

const items: ClearSpellingItemV1[] = [
  {
    itemId: 'spell-b',
    topicKey: 'topic.b',
    sourceSubtype: 'spelling',
    originalWord: 'filling',
    correctedWord: 'feeling',
    studentCount: 1,
    occurrenceCount: 1,
    anonymousExample: 'I have a good filling.',
  },
  {
    itemId: 'spell-a',
    topicKey: 'topic.a',
    sourceSubtype: 'spelling',
    originalWord: 'enviroment',
    correctedWord: 'environment',
    studentCount: 8,
    occurrenceCount: 8,
    anonymousExample: 'protect the enviroment',
  },
]

describe('ClassReviewSpellingList', () => {
  it('sorts definite spelling items deterministically and promotes without an AI call', async () => {
    const user = userEvent.setup()
    const onPromote = vi.fn()
    render(<ClassReviewSpellingList items={items} promotedItemIds={new Set(['spell-b'])} onPromote={onPromote} />)

    expect(screen.getAllByRole('article').map((item) => item.textContent)).toEqual([
      expect.stringContaining('enviroment → environment'),
      expect.stringContaining('filling → feeling'),
    ])

    await user.click(screen.getAllByRole('button', { name: '加入共性问题' })[0])
    expect(onPromote).toHaveBeenCalledWith('spell-a')
    expect(screen.getByRole('button', { name: '已加入问题列表' })).toBeDisabled()
  })
})
