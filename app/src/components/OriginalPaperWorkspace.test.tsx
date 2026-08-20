import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Essay } from '../types'
import type { ReviewIssueCardItem } from '../utils/reviewIssueItems'
import { OriginalPaperWorkspace } from './OriginalPaperWorkspace'

const reviewIssues: ReviewIssueCardItem[] = [
  {
    id: 'grammar-1',
    source: 'language',
    typeLabel: 'grammar',
    severity: 'high',
    original: 'It are blue.',
    suggestion: 'It is blue.',
    explanation: '主谓不一致。',
  },
  {
    id: 'logic-1',
    source: 'logic',
    typeLabel: '上下文关联度差',
    severity: 'medium',
    original: 'This sentence does not connect.',
    diagnosis: '上下文缺少明确关系。',
  },
  {
    id: 'legibility-1',
    source: 'legibility',
    typeLabel: '卷面与可读性',
    severity: 'medium',
    original: 'wark',
    diagnosis: '字形无法唯一确认。',
    pageReference: { kind: 'page-description', pageNumber: 1, regionDescription: '第一段末行右侧' },
  },
  {
    id: 'legibility-2',
    source: 'legibility',
    typeLabel: '卷面与可读性',
    severity: 'medium',
    original: 'frends',
    diagnosis: '字形无法唯一确认。',
    pageReference: { kind: 'page-description', pageNumber: 2, regionDescription: '第二段首行左侧' },
  },
]

function createEssay(): Essay {
  const firstFile = new File(['first'], 'first-page.jpg', { type: 'image/jpeg' })
  const secondFile = new File(['second'], 'second-page.jpg', { type: 'image/jpeg' })

  return {
    id: 'essay-paper',
    taskId: 'task-paper',
    essayNumber: '作文 1',
    pages: [
      {
        id: 'page-1', label: 'first-page.jpg', pageNumber: 1, quality: 'clear', accent: '#2563eb',
        previewUrl: 'blob:revoked-first', sourceFile: firstFile,
      },
      {
        id: 'page-2', label: 'second-page.jpg', pageNumber: 2, quality: 'clear', accent: '#0891b2',
        previewUrl: 'blob:revoked-second', sourceFile: secondFile,
      },
    ],
    pageCount: 2,
    pageOrder: ['page-2', 'page-1'],
    ocrText: 'It are blue.',
    ocrConfidence: 0.8,
    status: 'grading_ready',
    exceptionReasons: [],
    teacherReviewed: false,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  }
}

function renderWorkspace(overrides: Partial<React.ComponentProps<typeof OriginalPaperWorkspace>> = {}) {
  const essay = createEssay()
  return render(
    <MemoryRouter>
      <OriginalPaperWorkspace
        essay={essay}
        taskId={essay.taskId}
        reviewIssues={reviewIssues}
        activeIssueId={null}
        onIssueSelect={vi.fn()}
        onBackToGrading={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  )
}

describe('OriginalPaperWorkspace', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rebuilds usable image URLs from source files, follows pageOrder and owns cleanup', async () => {
    const createObjectURL = vi.fn((file: File) => `blob:fresh-${file.name}`)
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })

    const view = renderWorkspace()

    await waitFor(() => expect(screen.getByRole('img', { name: '作文 1 原卷第 1 页' })).toHaveAttribute('src', 'blob:fresh-second-page.jpg'))
    expect(screen.getByRole('button', { name: '查看第 1 页：second-page.jpg' })).toHaveAttribute('aria-current', 'page')
    expect(createObjectURL).toHaveBeenCalledTimes(2)

    const stage = screen.getByTestId('paper-image-stage')
    stage.scrollLeft = 70
    stage.scrollTop = 90
    await userEvent.click(screen.getByRole('button', { name: '查看第 2 页：first-page.jpg' }))
    expect(screen.getByRole('img', { name: '作文 1 原卷第 2 页' })).toHaveAttribute('src', 'blob:fresh-first-page.jpg')
    expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument()
    expect(stage.scrollLeft).toBe(0)
    expect(stage.scrollTop).toBe(0)

    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fresh-first-page.jpg')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fresh-second-page.jpg')
  })

  it('supports zoom, rotation and reset without replacing the real image', async () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    })
    const user = userEvent.setup()
    renderWorkspace()

    const image = await screen.findByRole('img', { name: '作文 1 原卷第 1 页' })
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1200 },
      naturalHeight: { configurable: true, value: 1600 },
    })
    fireEvent.load(image)
    expect(screen.getByText('100%')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '放大原卷' }))
    expect(screen.getByText('125%')).toBeInTheDocument()
    expect(screen.getByTestId('paper-image-carrier')).toHaveStyle({ width: '125%', aspectRatio: '0.75' })
    expect(image).toHaveStyle({ width: '100%' })

    await user.click(screen.getByRole('button', { name: '顺时针旋转原卷' }))
    expect(image).toHaveStyle({ transform: 'rotate(90deg) translateY(-100%)', transformOrigin: 'top left' })
    expect(screen.getByTestId('paper-image-carrier').style.width).toBe('166.66666666666666%')
    expect(Number.parseFloat(screen.getByTestId('paper-image-carrier').style.aspectRatio)).toBeCloseTo(4 / 3)
    expect(image).toHaveStyle({ width: '75%' })
    expect(screen.getByTestId('paper-image-plane')).toHaveClass('items-start')
    expect(screen.getByTestId('paper-image-stage')).toHaveClass('xl:flex-1', 'xl:min-h-0')

    await user.click(screen.getByRole('button', { name: '顺时针旋转原卷' }))
    expect(screen.getByTestId('paper-image-carrier')).toHaveStyle({ width: '125%', aspectRatio: '0.75' })
    expect(image).toHaveStyle({ width: '100%', transform: 'rotate(180deg) translate(-100%, -100%)' })

    await user.click(screen.getByRole('button', { name: '顺时针旋转原卷' }))
    expect(screen.getByTestId('paper-image-carrier').style.width).toBe('166.66666666666666%')
    expect(Number.parseFloat(screen.getByTestId('paper-image-carrier').style.aspectRatio)).toBeCloseTo(4 / 3)
    expect(image).toHaveStyle({ width: '75%', transform: 'rotate(270deg) translateX(-100%)' })

    await user.click(screen.getByRole('button', { name: '重置原卷视图' }))
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByTestId('paper-image-carrier')).toHaveStyle({ width: '100%', aspectRatio: '0.75' })
    expect(image).toHaveStyle({ width: '100%', transform: 'rotate(0deg)' })
  })

  it('keeps every StrictMode-created source-file URL owned and recoverable', async () => {
    const createdUrls: string[] = []
    const revokedUrls: string[] = []
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((file: File) => {
        const url = `blob:strict-${file.name}-${createdUrls.length}`
        createdUrls.push(url)
        return url
      }),
      revokeObjectURL: vi.fn((url: string) => revokedUrls.push(url)),
    })
    const essay = createEssay()
    const view = render(
      <StrictMode>
        <MemoryRouter>
          <OriginalPaperWorkspace
            essay={essay}
            taskId={essay.taskId}
            reviewIssues={reviewIssues}
            activeIssueId={null}
            onIssueSelect={vi.fn()}
            onBackToGrading={vi.fn()}
          />
        </MemoryRouter>
      </StrictMode>,
    )

    await screen.findByRole('img', { name: '作文 1 原卷第 1 页' })
    const currentImageUrl = screen.getByRole('img', { name: '作文 1 原卷第 1 页' }).getAttribute('src')
    expect(currentImageUrl).toBeTruthy()
    expect(revokedUrls).not.toContain(currentImageUrl)
    view.unmount()

    expect(createdUrls.length).toBeGreaterThanOrEqual(2)
    expect([...revokedUrls].sort()).toEqual([...createdUrls].sort())
  })

  it('pans the enlarged paper by dragging the image stage', async () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    })
    const user = userEvent.setup()
    renderWorkspace()

    await screen.findByRole('img', { name: '作文 1 原卷第 1 页' })
    await user.click(screen.getByRole('button', { name: '放大原卷' }))
    const stage = screen.getByTestId('paper-image-stage')
    stage.scrollLeft = 40
    stage.scrollTop = 30

    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 70, clientY: 60 })
    fireEvent.pointerUp(stage, { pointerId: 1 })

    expect(stage.scrollLeft).toBe(70)
    expect(stage.scrollTop).toBe(70)

    await user.click(screen.getByRole('button', { name: '重置原卷视图' }))
    expect(stage.scrollLeft).toBe(0)
    expect(stage.scrollTop).toBe(0)
  })

  it('shows only trustworthy page metadata and never fabricates image markers', async () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    })
    const user = userEvent.setup()
    const onIssueSelect = vi.fn()
    const view = renderWorkspace({ onIssueSelect })

    expect(await screen.findByText('第一段末行右侧')).toBeInTheDocument()
    expect(screen.queryByText('第二段首行左侧')).not.toBeInTheDocument()
    expect(screen.getAllByText('未精确定位')).toHaveLength(2)
    expect(view.container.querySelector('svg[data-paper-marker], canvas')).toBeNull()

    await user.click(screen.getByRole('button', { name: /It are blue\./ }))
    expect(onIssueSelect).toHaveBeenCalledWith('grammar-1')

    await user.click(screen.getByRole('button', { name: '查看第 2 页：first-page.jpg' }))
    expect(screen.getByText('第二段首行左侧')).toBeInTheDocument()
    expect(screen.queryByText('第一段末行右侧')).not.toBeInTheDocument()
  })

  it('opens the trusted page for an already-selected legibility issue without guessing text-issue pages', async () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    })
    const view = renderWorkspace({ activeIssueId: 'legibility-2' })

    expect(await screen.findByRole('img', { name: '作文 1 原卷第 2 页' })).toHaveAttribute('src', 'blob:first-page.jpg')
    expect(screen.getByText('第二段首行左侧')).toBeInTheDocument()
    const stage = screen.getByTestId('paper-image-stage')
    stage.scrollLeft = 50
    stage.scrollTop = 80

    view.rerender(
      <MemoryRouter>
        <OriginalPaperWorkspace
          essay={createEssay()}
          taskId="task-paper"
          reviewIssues={reviewIssues}
          activeIssueId="legibility-1"
          onIssueSelect={vi.fn()}
          onBackToGrading={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('img', { name: '作文 1 原卷第 1 页' })).toHaveAttribute('src', 'blob:second-page.jpg')
    expect(stage.scrollLeft).toBe(0)
    expect(stage.scrollTop).toBe(0)

    view.rerender(
      <MemoryRouter>
        <OriginalPaperWorkspace
          essay={createEssay()}
          taskId="task-paper"
          reviewIssues={reviewIssues}
          activeIssueId="grammar-1"
          onIssueSelect={vi.fn()}
          onBackToGrading={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument()
  })

  it('keeps the image first on small screens and exposes annotations as a bottom sheet', async () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    })
    const user = userEvent.setup()
    renderWorkspace()

    const stage = screen.getByTestId('paper-image-stage')
    const thumbnails = screen.getByTestId('paper-thumbnail-rail')
    expect(stage.compareDocumentPosition(thumbnails) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)

    const trigger = screen.getByRole('button', { name: /查看原卷批注/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: '原卷批注' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '关闭批注遮罩' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭原卷批注' })).toHaveFocus()

    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: /逻辑批注：This sentence does not connect/ })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: '关闭原卷批注' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: '关闭原卷批注' }))
    expect(trigger).toHaveFocus()
  })

  it('closes mobile modal semantics at the desktop breakpoint without focusing a hidden trigger', async () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    })
    let desktopChangeListener: ((event: MediaQueryListEvent) => void) | undefined
    const matchMedia = vi.fn(() => ({
      matches: false,
      media: '(min-width: 80rem)',
      onchange: null,
      addEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
        if (type === 'change') desktopChangeListener = listener
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    vi.stubGlobal('matchMedia', matchMedia)
    const user = userEvent.setup()
    renderWorkspace()

    const trigger = screen.getByRole('button', { name: /查看原卷批注/ })
    await user.click(trigger)
    const rail = screen.getByRole('dialog', { name: '原卷批注' })
    expect(screen.getByRole('button', { name: '关闭原卷批注' })).toHaveFocus()
    expect(matchMedia).toHaveBeenCalledWith('(min-width: 80rem)')

    act(() => desktopChangeListener?.({ matches: true } as MediaQueryListEvent))

    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
    expect(rail).not.toHaveAttribute('role')
    expect(rail).not.toHaveAttribute('aria-modal')
    expect(rail).toHaveFocus()
    expect(trigger).not.toHaveFocus()
  })

  it('shows a useful fallback when an image fails to load', async () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    })
    renderWorkspace()

    const image = await screen.findByRole('img', { name: '作文 1 原卷第 1 页' })
    image.dispatchEvent(new Event('error', { bubbles: true }))

    expect(await screen.findByText('当前页原卷图片加载失败')).toBeInTheDocument()
    expect(screen.getByText('可切换其他页继续查看；本次批改结果和识别文本不会受影响。')).toBeInTheDocument()
  })

  it('falls back immediately when a non-current page thumbnail fails', async () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    })
    renderWorkspace()

    await screen.findByRole('img', { name: '作文 1 原卷第 1 页' })
    fireEvent.error(screen.getByRole('img', { name: 'first-page.jpg 缩略图' }))

    expect(screen.queryByRole('img', { name: 'first-page.jpg 缩略图' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: '查看第 2 页：first-page.jpg' })).getByText('2')).toBeInTheDocument()
  })

  it('bounds the desktop workspace and keeps a ten-page thumbnail rail independently scrollable', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(), revokeObjectURL: vi.fn() })
    const essay = createEssay()
    essay.pages = Array.from({ length: 10 }, (_, index) => ({
      id: `page-${index + 1}`,
      label: `page-${index + 1}.jpg`,
      pageNumber: index + 1,
      quality: 'clear' as const,
      accent: '#2563eb',
      previewUrl: `https://images.example.test/page-${index + 1}.jpg`,
    }))
    essay.pageOrder = essay.pages.map((page) => page.id)
    essay.pageCount = 10

    renderWorkspace({ essay })

    await screen.findByRole('img', { name: '作文 1 原卷第 1 页' })
    expect(screen.getAllByRole('button', { name: /查看第 \d+ 页/ })).toHaveLength(10)
    expect(screen.getByTestId('paper-thumbnail-rail')).toHaveClass('xl:min-h-0', 'xl:overflow-x-hidden', 'xl:overflow-y-auto', 'xl:h-[clamp(560px,calc(100dvh-10rem),860px)]')
    expect(screen.getByTestId('paper-image-panel')).toHaveClass('xl:h-[clamp(560px,calc(100dvh-10rem),860px)]')
    expect(screen.getByTestId('paper-image-toolbar')).toHaveClass('shrink-0')
    expect(screen.getByTestId('paper-page-toolbar')).toHaveClass('shrink-0')
    expect(screen.getByTestId('paper-annotation-rail')).toHaveClass('xl:min-h-0', 'xl:h-[clamp(560px,calc(100dvh-10rem),860px)]')
  })

  it('uses a persistent remote image URL without taking ownership of it', async () => {
    const createObjectURL = vi.fn()
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const essay = createEssay()
    essay.pages = [{
      id: 'remote-page', label: 'remote.jpg', pageNumber: 1, quality: 'clear', accent: '#2563eb',
      previewUrl: 'https://images.example.test/remote.jpg',
    }]
    essay.pageOrder = ['remote-page']
    essay.pageCount = 1

    const view = renderWorkspace({ essay })

    expect(await screen.findByRole('img', { name: '作文 1 原卷第 1 页' })).toHaveAttribute('src', 'https://images.example.test/remote.jpg')
    expect(createObjectURL).not.toHaveBeenCalled()
    view.unmount()
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('keeps navigation and annotations usable when no page image was retained', () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(), revokeObjectURL: vi.fn() })
    const essay = createEssay()
    essay.pages = []
    essay.pageOrder = []
    essay.pageCount = 0

    renderWorkspace({ essay })

    expect(screen.getByText('当前页暂无可显示的原卷图片')).toBeInTheDocument()
    expect(screen.getByText('第 1 / 1 页')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '原卷批注' })).toBeInTheDocument()
    expect(screen.getByText('暂无原卷页')).toBeInTheDocument()
  })
})
