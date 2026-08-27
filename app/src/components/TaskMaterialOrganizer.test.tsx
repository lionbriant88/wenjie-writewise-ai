import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MATERIAL_FILE_ACCEPT } from '../services/taskMaterial/constants'
import type { MaterialUnit } from '../services/taskMaterial/types'
import type { MaterialSourceState } from '../hooks/useTaskMaterials'
import { TaskMaterialOrganizer, type TaskMaterialOrganizerProps } from './TaskMaterialOrganizer'

function file(name: string, type = 'image/png') {
  return new File(['material'], name, { type })
}

function props(overrides: Partial<TaskMaterialOrganizerProps> = {}): TaskMaterialOrganizerProps {
  return {
    units: [],
    sources: [],
    onSelectFiles: vi.fn(),
    onRemoveUnit: vi.fn(),
    onRemoveSource: vi.fn(),
    onRetrySource: vi.fn(),
    onMoveUnit: vi.fn(),
    ...overrides,
  }
}

describe('TaskMaterialOrganizer', () => {
  it('presents optional JPEG, PNG, WebP, PDF, and DOCX selection without accepting legacy DOC', async () => {
    const user = userEvent.setup()
    const onSelectFiles = vi.fn()
    render(<TaskMaterialOrganizer {...props({ onSelectFiles })} />)

    expect(screen.getByRole('heading', { name: '建议上传作文原材料（选填）' })).toBeInTheDocument()
    expect(screen.getByText(/不上传材料也能批改/)).toBeInTheDocument()
    const input = screen.getByLabelText('选择作文原材料')
    expect(input).toHaveAttribute('multiple')
    expect(input).toHaveAttribute('accept', MATERIAL_FILE_ACCEPT)
    expect(MATERIAL_FILE_ACCEPT.split(',')).not.toContain('.doc')

    const image = file('prompt.png')
    const pdf = file('paper.pdf', 'application/pdf')
    const docx = file('requirements.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    await user.upload(input, [image, pdf, docx])

    expect(onSelectFiles).toHaveBeenCalledTimes(1)
    expect(onSelectFiles).toHaveBeenCalledWith([image, pdf, docx])
  })

  it('shows image and PDF previews plus the DOCX body-only limitation', () => {
    const image = file('prompt.png')
    const pdfPage = file('paper-page.png')
    const units: MaterialUnit[] = [
      {
        id: 'image-unit', sourceId: 'image-source', kind: 'image', sourceKind: 'image',
        displayName: 'prompt.png', file: image, mimeType: 'image/png', previewUrl: 'blob:prompt',
      },
      {
        id: 'pdf-unit', sourceId: 'pdf-source', kind: 'image', sourceKind: 'pdf',
        displayName: 'paper.pdf · 第 1 页', file: pdfPage, mimeType: 'image/png',
        previewUrl: 'blob:paper-1', pageNumber: 1,
      },
      {
        id: 'docx-unit', sourceId: 'docx-source', kind: 'text', sourceKind: 'docx',
        displayName: 'requirements.docx', text: 'Write about a memorable day.', warnings: ['docx_body_only'],
      },
    ]

    render(<TaskMaterialOrganizer {...props({ units })} />)

    expect(screen.getByRole('img', { name: 'prompt.png 预览' })).toHaveAttribute('src', 'blob:prompt')
    expect(screen.getByRole('img', { name: 'paper.pdf · 第 1 页 预览' })).toHaveAttribute('src', 'blob:paper-1')
    const docxCard = screen.getByText('requirements.docx').closest('li')
    expect(docxCard).not.toBeNull()
    expect(within(docxCard!).getByText('正文已提取')).toBeInTheDocument()
    expect(within(docxCard!).getByText(/DOCX 仅提取正文/)).toBeInTheDocument()
    expect(within(docxCard!).getByText(/复杂排版、表格或嵌入图片/)).toBeInTheDocument()
  })

  it('announces normalizing and failed sources and forwards retry or source deletion', async () => {
    const user = userEvent.setup()
    const onRetrySource = vi.fn()
    const onRemoveSource = vi.fn()
    const sources: MaterialSourceState[] = [
      {
        key: 'pending-source', fileName: 'processing.pdf', status: 'normalizing', unitIds: [],
      },
      {
        key: 'failed-source', fileName: 'damaged.pdf', status: 'failed', unitIds: [],
        errorCode: 'pdf_render_failed', errorMessage: 'PDF 页面转换失败。',
      },
    ]
    render(<TaskMaterialOrganizer {...props({ sources, onRetrySource, onRemoveSource })} />)

    const statuses = screen.getAllByRole('status')
    expect(statuses).toHaveLength(2)
    expect(statuses[0]).toHaveTextContent('processing.pdf')
    expect(statuses[0]).toHaveTextContent('正在处理')
    expect(statuses[1]).toHaveTextContent('damaged.pdf')
    expect(statuses[1]).toHaveTextContent('PDF 页面转换失败。')

    await user.click(screen.getByRole('button', { name: '重试 damaged.pdf' }))
    await user.click(screen.getByRole('button', { name: '删除 processing.pdf' }))
    await user.click(screen.getByRole('button', { name: '删除 damaged.pdf' }))
    expect(onRetrySource).toHaveBeenCalledWith('failed-source')
    expect(onRemoveSource).toHaveBeenNthCalledWith(1, 'pending-source')
    expect(onRemoveSource).toHaveBeenNthCalledWith(2, 'failed-source')
  })

  it('forwards unit move and deletion callbacks and disables every action when requested', async () => {
    const user = userEvent.setup()
    const unit: MaterialUnit = {
      id: 'unit-1', sourceId: 'source-1', kind: 'image', sourceKind: 'image',
      displayName: 'prompt.png', file: file('prompt.png'), mimeType: 'image/png', previewUrl: 'blob:prompt',
    }
    const onMoveUnit = vi.fn()
    const onRemoveUnit = vi.fn()
    const view = render(<TaskMaterialOrganizer {...props({ units: [unit], onMoveUnit, onRemoveUnit })} />)

    await user.click(screen.getByRole('button', { name: '上移 prompt.png' }))
    await user.click(screen.getByRole('button', { name: '下移 prompt.png' }))
    await user.click(screen.getByRole('button', { name: '删除 prompt.png' }))
    expect(onMoveUnit).toHaveBeenNthCalledWith(1, 'unit-1', -1)
    expect(onMoveUnit).toHaveBeenNthCalledWith(2, 'unit-1', 1)
    expect(onRemoveUnit).toHaveBeenCalledWith('unit-1')

    view.rerender(<TaskMaterialOrganizer {...props({ units: [unit], disabled: true })} />)
    expect(screen.getByLabelText('选择作文原材料')).toBeDisabled()
    expect(screen.getByRole('button', { name: '上移 prompt.png' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下移 prompt.png' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除 prompt.png' })).toBeDisabled()
  })
})
