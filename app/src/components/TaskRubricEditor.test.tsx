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
  const differenceFromHundred = Number(Math.abs(totalWeight - 100).toFixed(12))
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
    expect(screen.queryByRole('textbox', { name: /维度名称/ })).not.toBeInTheDocument()

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

  it('uses canonical IDs for ordinary collisions and the legibility deletion lock', async () => {
    const user = userEvent.setup()
    const dimensions = createDefaultRubricDimensions().map((dimension) => {
      if (dimension.id === 'content') return { ...dimension, id: ' ordinary-1 ' }
      if (dimension.id === 'legibility') return { ...dimension, id: ' legibility ', name: '清晰程度' }
      return dimension
    })
    const onDimensionsChange = vi.fn()
    renderEditor({ dimensions, onDimensionsChange })

    expect(screen.queryByRole('button', { name: '删除清晰程度' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '添加评分维度' }))

    const emitted = onDimensionsChange.mock.calls.at(-1)?.[0] as RubricDimension[]
    const canonicalIds = emitted.map(({ id }) => id.trim())
    expect(new Set(canonicalIds)).toHaveProperty('size', canonicalIds.length)
    expect(emitted.at(-1)?.id).toMatch(/^ordinary-/)
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

  it('keeps duplicate invalid rows independently expandable and deletes only the selected occurrence', async () => {
    const user = userEvent.setup()
    const dimensions = createDefaultRubricDimensions()
    dimensions[1] = { ...dimensions[1]!, id: dimensions[0]!.id }
    const duplicateError = '维度 ID 不能重复。'
    const errors: RubricValidity['errors'] = {
      dimensions: '评分维度包含重复 ID。',
      dimensionItems: [{ id: duplicateError }, { id: duplicateError }, {}, {}],
    }
    const onDimensionsChange = vi.fn()
    renderEditor({ dimensions, validity: validity(100, errors), onDimensionsChange })

    await user.click(screen.getByRole('button', { name: '编辑语言质量' }))
    expect(screen.getByRole('textbox', { name: '维度名称：语言质量' })).toBeVisible()
    expect(screen.queryByRole('textbox', { name: '维度名称：内容与任务完成' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '删除语言质量' }))
    const emitted = onDimensionsChange.mock.calls.at(-1)?.[0] as RubricDimension[]
    expect(emitted.map(({ name }) => name)).toEqual(['内容与任务完成', '结构与连贯', '卷面与可读性'])
    emitted.forEach((dimension) => {
      expect(dimension).not.toBe(dimensions.find(({ name }) => name === dimension.name))
    })
  })

  it('keeps a valid unique row expanded when ordinary fields change', async () => {
    const user = userEvent.setup()
    const dimensions = createDefaultRubricDimensions()
    const { rerender, props } = renderEditor({ dimensions })

    await user.click(screen.getByRole('button', { name: '编辑内容与任务完成' }))
    const renamed = dimensions.map((dimension) => (
      dimension.id === 'content' ? { ...dimension, name: '任务完成度' } : dimension
    ))
    rerender(<TaskRubricEditor {...props} dimensions={renamed} />)

    expect(screen.getByRole('button', { name: '编辑任务完成度' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('textbox', { name: '维度名称：任务完成度' })).toBeVisible()
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

  it('shows accepted and rejected tolerance boundaries without rounding them into the same value', () => {
    const { rerender, props } = renderEditor({ validity: validity(99.999) })
    expect(screen.getByText('当前合计 99.999%，在 0.001% 容差内视为 100%')).toBeInTheDocument()

    rerender(<TaskRubricEditor {...props} validity={validity(100.001)} />)
    expect(screen.getByText('当前合计 100.001%，在 0.001% 容差内视为 100%')).toBeInTheDocument()

    rerender(<TaskRubricEditor {...props} validity={validity(99.9989999)} />)
    expect(screen.getByText('当前合计 99.9989999%，还需 0.0010001%')).toBeInTheDocument()

    rerender(<TaskRubricEditor {...props} validity={validity(100.0010001)} />)
    expect(screen.getByText('当前合计 100.0010001%，超出 0.0010001%')).toBeInTheDocument()
  })

  it('does not display a positive sub-millionth weight as zero', () => {
    const dimensions = createDefaultRubricDimensions()
    dimensions[0] = { ...dimensions[0]!, weight: 0.0000001 }
    renderEditor({ dimensions })

    expect(screen.getByText('0.0000001%')).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('emits NaN for an empty numeric input and remains safely controlled after rerender', async () => {
    const user = userEvent.setup()
    const dimensions = createDefaultRubricDimensions()
    const onDimensionsChange = vi.fn()
    const { rerender, props } = renderEditor({ dimensions, onDimensionsChange })
    await user.click(screen.getByRole('button', { name: '编辑内容与任务完成' }))

    await user.clear(screen.getByRole('spinbutton', { name: '权重：内容与任务完成' }))
    const emitted = onDimensionsChange.mock.calls.at(-1)?.[0] as RubricDimension[]
    expect(emitted[0]?.weight).toBe(Number.NaN)

    rerender(<TaskRubricEditor {...props} dimensions={emitted} />)
    expect(screen.getByRole('spinbutton', { name: '权重：内容与任务完成' })).toHaveValue(null)
    expect(screen.getByText('无效权重')).toBeInTheDocument()
  })

  it('labels NaN and Infinity badges as invalid weights without a percent suffix', () => {
    const dimensions = createDefaultRubricDimensions()
    dimensions[0] = { ...dimensions[0]!, weight: Number.NaN }
    dimensions[1] = { ...dimensions[1]!, weight: Number.POSITIVE_INFINITY }
    renderEditor({ dimensions })

    expect(screen.getAllByText('无效权重')).toHaveLength(2)
    expect(screen.queryByText('无效权重%')).not.toBeInTheDocument()
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

    const collapsedRow = screen.getByRole('button', { name: '编辑内容与任务完成' })
    expect(collapsedRow).toHaveAttribute('aria-invalid', 'true')
    expect(collapsedRow).toHaveAccessibleDescription('请修正此维度：请填写维度名称。；请填写维度说明。；权重必须大于 0。')
    expect(screen.getByText('请修正此维度：请填写维度名称。；请填写维度说明。；权重必须大于 0。')).toBeVisible()

    await user.click(collapsedRow)
    expect(screen.getByRole('textbox', { name: '维度名称：内容与任务完成' })).toHaveAccessibleDescription('请填写维度名称。')
    expect(screen.getByRole('textbox', { name: '维度说明：内容与任务完成' })).toHaveAccessibleDescription('请填写维度说明。')
    expect(screen.getByRole('spinbutton', { name: '权重：内容与任务完成' })).toHaveAccessibleDescription('权重必须大于 0。')
  })

  it('scopes every DOM ID and accessibility reference to its editor instance', () => {
    const errors: RubricValidity['errors'] = {
      writingRequirement: '请填写写作要求。',
      dimensions: '评分维度权重合计必须为 100%。',
      dimensionItems: [{ name: '请填写维度名称。' }, {}, {}, {}],
    }
    const props: TaskRubricEditorProps = {
      writingRequirement: '',
      dimensions: createDefaultRubricDimensions(),
      validity: validity(95, errors),
      canRequestAi: false,
      aiState: 'idle',
      onWritingRequirementChange: vi.fn(),
      onDimensionsChange: vi.fn(),
      onRequestAi: vi.fn(),
    }
    const { container } = render(
      <>
        <TaskRubricEditor {...props} />
        <TaskRubricEditor {...props} />
      </>,
    )

    const allIds = Array.from(container.querySelectorAll<HTMLElement>('[id]'), (element) => element.id)
    expect(new Set(allIds).size).toBe(allIds.length)

    const editors = screen.getAllByRole('region', { name: '评分标准' })
    expect(editors).toHaveLength(2)
    editors.forEach((editor) => {
      editor.querySelectorAll<HTMLElement>('[aria-labelledby], [aria-describedby], [aria-controls]').forEach((element) => {
        const references = ['aria-labelledby', 'aria-describedby', 'aria-controls']
          .flatMap((attribute) => element.getAttribute(attribute)?.split(/\s+/) ?? [])
        references.forEach((reference) => {
          const target = document.getElementById(reference)
          expect(target, `missing target for ${reference}`).not.toBeNull()
          expect(editor.contains(target), `${reference} escaped its editor`).toBe(true)
        })
      })
      editor.querySelectorAll<HTMLLabelElement>('label[for]').forEach((label) => {
        const target = document.getElementById(label.htmlFor)
        expect(target, `missing label target for ${label.htmlFor}`).not.toBeNull()
        expect(editor.contains(target), `${label.htmlFor} escaped its editor`).toBe(true)
      })

      const collapsedToggle = within(editor).getByRole('button', { name: '编辑内容与任务完成' })
      const detailsId = collapsedToggle.getAttribute('aria-controls')
      const details = detailsId ? document.getElementById(detailsId) : null
      expect(details).not.toBeNull()
      expect(details).toHaveAttribute('hidden')
    })
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
