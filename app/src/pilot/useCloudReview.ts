import { useEffect, useRef, useState } from 'react'
import type { GradingResult } from '../types'
import type { CloudWorkspace } from './workspace'
import {
  createReviewDraft,
  changeReviewDraft,
  reviewCommand,
  type ReviewDraft,
} from './reviewDraft'
import { PilotApiError } from './client'
import { projectResult } from './projection'
export function useCloudReview(
  pilot: CloudWorkspace | undefined,
  essayId: string,
  result: GradingResult | undefined,
) {
  const [draft, setDraft] = useState<ReviewDraft | null>(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false)
  const live = useRef(draft)
  live.current = draft
  const row = pilot?.essays.find((e) => e.id === essayId)
  const identity = row?.currentResult
    ? JSON.stringify([
        essayId,
        row.sourceRevision,
        row.currentResult.resultRevision,
      ])
    : null
  const loadedIdentity = useRef<string | null>(null)
  useEffect(() => {
    if (!pilot || !row || !result) return
    if (loadedIdentity.current === identity) return
    if (live.current?.essayId === essayId && live.current.dirty) return
    loadedIdentity.current = identity
    setDraft(createReviewDraft(essayId, row.revision, result))
    setError('')
    setSaved(false)
  }, [pilot, essayId, identity, row, result])
  const current = draft?.essayId === essayId ? draft : null
  function edit(patch: Partial<GradingResult>) {
    if (!pilot || !row || !result) return
    setDraft((d) =>
      changeReviewDraft(
        d?.essayId === essayId
          ? d
          : createReviewDraft(essayId, row.revision, result),
        patch,
      ),
    )
    setSaved(false)
  }
  async function save(confirm = false) {
    if (!pilot || !row || !result || saving) return
    const submitted =
      current ?? createReviewDraft(essayId, row.revision, result)
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const response = await pilot.client.saveReview(
        essayId,
        reviewCommand(submitted, confirm),
        pilot.controller.signal,
      )
      pilot.acceptEssay(response)
      const next = projectResult(response)
      if (!next) throw Error('保存结果无法读取。')
      setDraft((d) =>
        d && d !== submitted && d.dirty
          ? { ...d, revision: response.revision }
          : createReviewDraft(essayId, response.revision, next),
      )
      setSaved(true)
    } catch (e) {
      if (!pilot.controller.signal.aborted)
        setError(
          e instanceof PilotApiError && e.status === 409
            ? '云端版本已更新，当前修改仍保留。请加载最新版本后再编辑。'
            : e instanceof Error
              ? e.message
              : '保存失败，请重试。',
        )
    } finally {
      if (!pilot.controller.signal.aborted) setSaving(false)
    }
  }
  async function reload() {
    if (!pilot) return
    try {
      const response = await pilot.client.getEssay(
        essayId,
        pilot.controller.signal,
      )
      pilot.acceptEssay(response)
      const next = projectResult(response)
      setDraft(
        next ? createReviewDraft(essayId, response.revision, next) : null,
      )
      setError('')
      setSaved(false)
    } catch (e) {
      if (!pilot.controller.signal.aborted)
        setError(e instanceof Error ? e.message : '加载失败，请重试。')
    }
  }
  return {
    result: pilot && result && current ? current.result : result,
    dirty: !!current?.dirty,
    saving,
    error,
    saved,
    edit,
    save,
    reload,
  }
}
