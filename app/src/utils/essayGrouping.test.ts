import { describe, expect, it } from 'vitest'
import type { EssayPage } from '../types'
import { createEssayImageGroups } from './essayGrouping'

const page = (index: number): EssayPage => ({
  id: `page-${index}`,
  label: `Page ${index}`,
  pageNumber: index,
  quality: 'clear',
  accent: '#2563eb',
})

describe('createEssayImageGroups', () => {
  it('creates one essay group per page in single mode', () => {
    const groups = createEssayImageGroups([page(1), page(2), page(3)], 'single')

    expect(groups.map((group) => group.pageIds)).toEqual([['page-1'], ['page-2'], ['page-3']])
  })

  it('creates fixed two-page groups and preserves page order', () => {
    const groups = createEssayImageGroups([page(1), page(2), page(3), page(4)], 'fixed-2')

    expect(groups.map((group) => group.pageIds)).toEqual([
      ['page-1', 'page-2'],
      ['page-3', 'page-4'],
    ])
  })

  it('keeps an odd final page as a single-page group in fixed two-page mode', () => {
    const groups = createEssayImageGroups([page(1), page(2), page(3), page(4), page(5)], 'fixed-2')

    expect(groups.map((group) => group.pageIds)).toEqual([
      ['page-1', 'page-2'],
      ['page-3', 'page-4'],
      ['page-5'],
    ])
  })
})
