import type { ClassInsight, Essay, GradingResult, Task } from '../types'

export function findTask(tasks: Task[], taskId: string) {
  return tasks.find((task) => task.id === taskId)
}

export function findEssaysByTask(essays: Essay[], taskId: string) {
  return essays.filter((essay) => essay.taskId === taskId)
}

export function findEssay(essays: Essay[], essayId: string) {
  return essays.find((essay) => essay.id === essayId)
}

export function findResultByEssayId(results: GradingResult[], essayId: string) {
  return results.find((result) => result.essayId === essayId)
}

export function findClassInsight(insights: ClassInsight[], taskId: string) {
  return insights.find((insight) => insight.taskId === taskId)
}
