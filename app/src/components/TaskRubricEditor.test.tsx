import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultRubricDimensions } from '../services/taskRubric/rubricForm'
import type { RubricValidity } from '../services/taskRubric/rubricForm'
import type { RubricDimension } from '../types'
import { TaskRubricEditor, type TaskRubricEditorProps } from './TaskRubricEditor'

const writingRequirement = 'Write an email to invite your friend.'

function validity(
  totalWeight = 100,
  errors: RubricValidity['errors'] = { dimensionItems: [{}, {}, {}, {}] },
): RubricValidity {
  const differenceFromHundred = Math.abs(totalWeight - 100)
  const hasErrors = Boolean(
    errors.fullScore
      || errors.writingRequirement
      || errors.dimensions
      || errors.dimensionItems.some((item) => Object.keys(item).length > 0),
  )

  return { valid: differenceFromHundred <= 0.001 && !hasErrors, totalWeight, differenceFromHundred, errors }
}

function renderEditor(overrides: Partial<TaskRubricEditorProps> = {}) {
  const props: TaskRubricEditorProps = {
    writingRequirement,
    dimensions: createDefaultRubricDimensions(),
    validity: validity(),
    canRequestAi: true,
    aiState: 'idle',
    onWritingRequirementChange: vi.fn(),
    onDimensionsChange: vi.fn(),
    onRequestAi: vi.fn(),
    ...overrides,
  }

  return { ...render(<TaskRubricEditor {...props} />), props }
}

describe('TaskRubricEditor', () => {
  it('shows one collapsed rubric with the approved defaults and no mode or confirmation branch', () => {
    const { container } = renderEditor()

    const requirement = screen.getByRole('textbox', { name: '写作要求' })
    expect(requirement).toHaveValue(writingRequirement)
    expect(requirement.tagName).toBe('TEXTAREA')
    expect(requirement).toHaveClass('min-h-40')

    expect(screen.getByText('内容与任务完成')).toBeInTheDocument()
    expect(screen.getByText('语言质量')).toBeInTheDocument()
    expect(screen.getByText('结构与连贯')).toBeInTheDocument()
    expect(screen.getByText('卷面与可读性')).toBeInTheDocument()
    expect(screen.getAllByText('40%')).toHaveLength(2)
    expect(screen.getByText('15%')).toBeInTheDocument()
    expect(screen.getByText('5%')).toBeInTheDocument()
    expect(screen.queryByLabelText(/维度名称/)).not.toBeInTheDocument()

    const forbidden = ['教师模式', 'AI模式', 'AI 模式', '评分标准来源', '确认采用该标准']
    forbidden.forEach((text) => expect(container).not.toHaveTextContent(text))
  })

  it('expands a keyboard-accessible detail row and emits controlled deep clones for edits', async () => {
    const user = userEvent.setup()
    const dimensions = createDefaultRubricDimensions()
    dimensions[0]!.deductionFocus = ['task completion']
    dimensions[0]!.sourceEvidence = ['teacher material']
    const onDimensionsChange = vi.fn()
    const { props } = renderEditor({ dimensions, onDimensionsChange })

    const toggle = screen.getByRole('button', { name: '编辑内容与任务完成' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    toggle.focus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    const nameInput = screen.getByRole('textbox', { name: '维度名称：内容与任务完成' })
    const descriptionInput = screen.getByRole('textbox', { name: '维度说明：内容与任务完成' })
    const weightInput = screen.getByRole('spinbutton', { name: '权重：内容与任务完成' })
    expect(descriptionInput.tagName).toBe('TEXTAREA')
    expect(weightInput).toHaveAttribute('type', 'number')

    fireEvent.change(nameInput, { target: { value: '任务完成度' } })
    const emitted = onDimensionsChange.mock.calls.at(-1)?.[0] as RubricDimension[]
    expect(emitted[0]?.name).toBe('任务完成度')
    expect(dimensions[0]?.name).toBe('内容与任务完成')
    expect(emitted).not.toBe(dimensions)
    emitted.forEach((dimension, index) => {
      expect(dimension).not.toBe(dimensions[index])
      expect(dimension.deductionFocus).not.toBe(dimensions[index]?.deductionFocus)
      if (dimensions[index]?.sourceEvidence) {
        expect(dimension.sourceEvidence).not.toBe(dimensions[index]?.sourceEvidence)
      }
    })

    expect(props.onWritingRequirementChange).not.toHaveBeenCalled()
  })

  it('emits writing requirement changes without owning the value', () => {
    const onWritingRequirementChange = vi.fn()
    renderEditor({ onWritingRequirementChange })

    fireEvent.change(screen.getByRole('textbox', { name: '写作要求' }), { target: { value: 'A new requirement' } })

    expect(onWritingRequirementChange).toHaveBeenCalledWith('A new requirement')
  })

  it('adds collision-safe ordinary dimensions and deletes only ordinary dimensions', async () => {
    const user = userEvent.setup()
    const dimensions = createDefaultRubricDimensions().map((dimension) => (
      dimension.id === 'legibility' ? { ...dimension, name: '清晰程度' } : dimension
    ))
    dimensions.push({
      id: 'ordinary-1',
      name: '自定义维度',
      description: '自定义说明',
      weight: 1,
      deductionFocus: ['hidden'],
      sourceEvidence: ['hidden evidence'],
    })
    const onDimensionsChange = vi.fn()
    renderEditor({ dimensions, onDimensionsChange })

    expect(screen.getByRole('button', { name: '删除内容与任务完成' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除自定义维度' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除清晰程度' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '添加评分维度' }))
    const added = onDimensionsChange.mock.calls.at(-1)?.[0] as RubricDimension[]
    expect(added).toHaveLength(dimensions.length + 1)
    expect(added.at(-1)).toMatchObject({ id: expect.stringMatching(/^ordinary-/), name: '', description: '', weight: 1 })
    expect(dimensions.map(({ id }) => id)).not.toContain(added.at(-1)?.id)
    added.slice(0, -1).forEach((dimension, index) => {
      expect(dimension).not.toBe(dimensions[index])
      expect(dimension.deductionFocus).not.toBe(dimensions[index]?.deductionFocus)
      if (dimensions[index]?.sourceEvidence) {
        expect(dimension.sourceEvidence).not.toBe(dimensions[index]?.sourceEvidence)
      }
    })

    await user.click(screen.getByRole('button', { name: '删除自定义维度' }))
    const afterDelete = onDimensionsChange.mock.calls.at(-1)?.[0] as RubricDimension[]
    expect(afterDelete.map(({ id }) => id)).not.toContain('ordinary-1')
    expect(afterDelete.map(({ id }) => id)).toContain('legibility')
    afterDelete.forEach((dimension) => {
      const source = dimensions.find(({ id }) => id === dimension.id)
      expect(dimension).not.toBe(source)
      expect(dimension.deductionFocus).not.toBe(source?.deductionFocus)
      if (source?.sourceEvidence) expect(dimension.sourceEvidence).not.toBe(source.sourceEvidence)
    })
  })

  it('states weight shortages, exact totals, overages, and tolerance-safe decimal totals precisely', () => {
    const { rerender, props } = renderEditor({ validity: validity(95) })
    expect(screen.getByText('当前合计 95%，还需 5%')).toBeInTheDocument()

    rerender(<TaskRubricEditor {...props} validity={validity(100)} />)
    expect(screen.getByText('当前合计 100%，权重合计正确')).toBeInTheDocument()

    rerender(<TaskRubricEditor {...props} validity={validity(102.25)} />)
    expect(screen.getByText('当前合计 102.25%，超出 2.25%')).toBeInTheDocument()

    rerender(<TaskRubricEditor {...props} validity={validity(99.9995)} />)
    expect(screen.getByText('当前合计 99.9995%，在 0.001% 容差内视为 100%')).toBeInTheDocument()
  })

  it('associates writing and dimension errors with the exact invalid controls', async () => {
    const user = userEvent.setup()
    const errors: RubricValidity['errors'] = {
      writingRequirement: '请填写写作要求。',
      dimensions: '评分维度权重合计必须为 100%。',
      dimensionItems: [
        { name: '请填写维度名称。', description: '请填写维度说明。', weight: '权重必须大于 0。' },
        {},
        {},
        {},
      ],
    }
    renderEditor({ writingRequirement: '', validity: validity(95, errors) })

    expect(screen.getByRole('textbox', { name: '写作要求' })).toHaveAccessibleDescription('请填写写作要求。')
    expect(screen.getByText('当前合计 95%，还需 5%')).toHaveAccessibleDescription('评分维度权重合计必须为 100%。')

    await user.click(screen.getByRole('button', { name: '编辑内容与任务完成' }))
    expect(screen.getByRole('textbox', { name: '维度名称：内容与任务完成' })).toHaveAccessibleDescription('请填写维度名称。')
    expect(screen.getByRole('textbox', { name: '维度说明：内容与任务完成' })).toHaveAccessibleDescription('请填写维度说明。')
    expect(screen.getByRole('spinbutton', { name: '权重：内容与任务完成' })).toHaveAccessibleDescription('权重必须大于 0。')
  })

  it('keeps AI assistance secondary and reports generating and failed states accessibly', async () => {
    const user = userEvent.setup()
    const onRequestAi = vi.fn()
    const { rerender, props } = renderEditor({ canRequestAi: false, onRequestAi })
    const button = screen.getByRole('button', { name: '根据材料生成评分标准' })
    expect(button).toBeDisabled()
    expect(button).toHaveClass('border-slate-200', 'bg-white')

    rerender(<TaskRubricEditor {...props} canRequestAi aiState="idle" />)
    await user.click(screen.getByRole('button', { name: '根据材料生成评分标准' }))
    expect(onRequestAi).toHaveBeenCalledTimes(1)

    rerender(<TaskRubricEditor {...props} canRequestAi aiState="generating" aiMessage="正在参考材料生成…" />)
    expect(screen.getByRole('button', { name: '根据材料生成评分标准' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('正在参考材料生成…')

    rerender(<TaskRubricEditor {...props} canRequestAi aiState="failed" aiMessage="<script>生成失败</script>" />)
    expect(screen.getByRole('alert')).toHaveTextContent('<script>生成失败</script>')
    expect(document.querySelector('script')).not.toBeInTheDocument()
  })

  it('disables every editable action when the editor is disabled', async () => {
    renderEditor({ disabled: true })

    expect(screen.getByRole('textbox', { name: '写作要求' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '添加评分维度' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '根据材料生成评分标准' })).toBeDisabled()
    const firstSummary = screen.getByRole('button', { name: '编辑内容与任务完成' })
    expect(firstSummary).toBeDisabled()
    expect(within(firstSummary).getByText('40%')).toBeInTheDocument()
  })
})
