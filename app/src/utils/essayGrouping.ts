import type { EssayPage } from '../types'

export type UploadGroupingMode = 'single' | 'fixed-2' | 'mixed'

export interface UploadEssayGroup {
  id: string
  pageIds: string[]
}

export function createEssayImageGroups(
  pages: EssayPage[],
  mode: Exclude<UploadGroupingMode, 'mixed'>,
): UploadEssayGroup[] {
  if (mode === 'single') {
    return pages.map((page, index) => ({
      id: `group-${index + 1}`,
      pageIds: [page.id],
    }))
  }

  const groups: UploadEssayGroup[] = []
  for (let index = 0; index < pages.length; index += 2) {
    groups.push({
      id: `group-${groups.length + 1}`,
      pageIds: pages.slice(index, index + 2).map((page) => page.id),
    })
  }
  return groups
}

export function renumberEssayGroups(groups: UploadEssayGroup[]): UploadEssayGroup[] {
  return groups
    .filter((group) => group.pageIds.length > 0)
    .map((group, index) => ({
      ...group,
      id: `group-${index + 1}`,
    }))
}
