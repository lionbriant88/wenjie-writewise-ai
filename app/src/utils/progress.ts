import type { Essay, EssayStatus } from '../types'

export function calculateProgress(essays: Essay[]) {
  const total = essays.length
  const completed = essays.filter((essay) => ['completed', 'manual'].includes(essay.status)).length
  const exceptions = essays.filter((essay) => essay.status === 'needs_review').length

  return {
    total,
    completed,
    exceptions,
    completionPercent: total === 0 ? 0 : Math.round((completed / total) * 100),
    exceptionPercent: total === 0 ? 0 : Math.round((exceptions / total) * 100),
  }
}

export function summarizeStatuses(essays: Essay[]) {
  return essays.reduce<Partial<Record<EssayStatus, number>>>((summary, essay) => {
    summary[essay.status] = (summary[essay.status] ?? 0) + 1
    return summary
  }, {})
}
