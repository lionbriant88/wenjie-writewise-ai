import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { ProgressPage } from './ProgressPage'
import { UploadPage } from './UploadPage'

function renderUploadPage() {
  render(
    <AppStateProvider>
      <MemoryRouter initialEntries={['/tasks/task-1/upload']}>
        <Routes>
          <Route path="/tasks/:taskId/upload" element={<UploadPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

function renderUploadToProgressFlow() {
  render(
    <AppStateProvider>
      <MemoryRouter initialEntries={['/tasks/task-1/upload']}>
        <Routes>
          <Route path="/tasks/:taskId/upload" element={<UploadPage />} />
          <Route path="/tasks/:taskId/progress" element={<ProgressPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

async function clearOrganizerImages(user: ReturnType<typeof userEvent.setup>) {
  let deleteButton = screen.queryAllByRole('button', { name: /^删除 / })[0]

  while (deleteButton) {
    await user.click(deleteButton)
    deleteButton = screen.queryAllByRole('button', { name: /^删除 / })[0]
  }
}

describe('UploadPage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    localStorage.clear()
  })

  it('shows compact upload source entries with stage-three placeholders', () => {
    renderUploadPage()

    const sourceRegion = screen.getByRole('region', { name: '选择导入方式' })

    expect(within(sourceRegion).getByRole('heading', { name: '选择导入方式' })).toBeInTheDocument()
    expect(within(sourceRegion).getByText(/当前版本支持图片 \/ 文件导入/)).toBeInTheDocument()

    const fileImport = within(sourceRegion).getByRole('group', { name: '图片 / 文件导入' })
    expect(within(fileImport).getByText('当前可用')).toBeInTheDocument()
    expect(within(fileImport).getByText(/从当前设备选择已经存在的作文图片或文件/)).toBeInTheDocument()
    expect(within(fileImport).getByLabelText('选择图片')).toBeInTheDocument()
    expect(within(fileImport).getByRole('button', { name: '添加模拟图片' })).toBeInTheDocument()

    const cameraCapture = within(sourceRegion).getByRole('group', { name: '拍照采集' })
    expect(within(cameraCapture).getByText('阶段三接入')).toBeInTheDocument()
    expect(within(cameraCapture).getByText(/软件内调用手机、平板或电脑摄像头现场拍摄作文/)).toBeInTheDocument()

    const scannerImport = within(sourceRegion).getByRole('group', { name: '扫描件导入' })
    expect(within(scannerImport).getByText('阶段三接入')).toBeInTheDocument()
    expect(within(scannerImport).getByText(/学校扫描仪或阅卷系统已经生成的作文图片、PDF 或文件夹/)).toBeInTheDocument()

    const seewoCapture = within(sourceRegion).getByRole('group', { name: '希沃展台采集' })
    expect(within(seewoCapture).getByText('课堂即时批改')).toBeInTheDocument()
    expect(within(seewoCapture).getByText('批量采集上传')).toBeInTheDocument()
    expect(within(seewoCapture).getAllByText('阶段三接入').length).toBeGreaterThanOrEqual(3)

    expect(screen.queryByRole('button', { name: '打开摄像头' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '连接扫描仪' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '开始展台采集' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '展台截图' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '选择扫描件' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '使用本地图片模拟' })).not.toBeInTheDocument()
  })

  it('adds selected local images to the organizer with real preview thumbnails', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:essay-photo-preview'),
      revokeObjectURL: vi.fn(),
    })
    renderUploadPage()

    const file = new File(['image-bytes'], 'essay-photo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('选择图片'), file)

    expect(screen.getByText('essay-photo.png')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'essay-photo.png 预览' })).toHaveAttribute(
      'src',
      'blob:essay-photo-preview',
    )
  })

  it('removes selected local images from the organizer and releases their preview URLs', async () => {
    const user = userEvent.setup()
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:essay-photo-preview'),
      revokeObjectURL,
    })
    renderUploadPage()

    const file = new File(['image-bytes'], 'essay-photo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('选择图片'), file)
    await user.click(screen.getByRole('button', { name: '删除 essay-photo.png' }))

    expect(screen.queryByText('essay-photo.png')).not.toBeInTheDocument()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:essay-photo-preview')
  })

  it('starts mock OCR and shows editable OCR draft text for the organized images', async () => {
    const user = userEvent.setup()
    renderUploadPage()

    await user.click(screen.getByRole('button', { name: '开始 OCR 识别（预计 6 篇）' }))

    expect(screen.getByText('OCR 识别完成')).toBeInTheDocument()
    const ocrDraft = screen.getByRole('textbox', { name: '作文 1 OCR 文本' }) as HTMLTextAreaElement
    expect(ocrDraft.value).toContain('作文图片 1')
  })

  it('confirms mock OCR text into the task progress queue', async () => {
    const user = userEvent.setup()
    renderUploadToProgressFlow()

    await user.click(screen.getByRole('button', { name: '开始 OCR 识别（预计 6 篇）' }))
    const ocrDraft = screen.getByRole('textbox', { name: '作文 1 OCR 文本' })
    await user.clear(ocrDraft)
    await user.type(ocrDraft, 'Confirmed OCR essay text')
    await user.click(screen.getByRole('button', { name: '确认 OCR 文本' }))

    expect(screen.getByRole('heading', { name: '批改进度' })).toBeInTheDocument()
    expect(screen.getAllByText('作文 11').length).toBeGreaterThan(0)
    expect(screen.getAllByText('待批改').length).toBeGreaterThan(0)
  })

  it('shows batch grouping modes and removes old top-level grouping actions', () => {
    renderUploadPage()

    expect(screen.getByRole('button', { name: '一张一篇' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '每 2 张一篇' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '混合页数' })).toBeInTheDocument()
    expect(screen.getByText('当前按上传顺序排列，自动分组将按此顺序生成作文。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始 OCR 识别（预计 6 篇）' })).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: '合并为多页作文' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '拆分页' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '手动分组' })).not.toBeInTheDocument()
  })

  it('groups images into fixed two-page essays before OCR', async () => {
    const user = userEvent.setup()
    renderUploadToProgressFlow()

    await user.click(screen.getByRole('button', { name: '每 2 张一篇' }))

    expect(screen.getByText('当前按上传顺序排列，自动分组将按此顺序生成作文。')).toBeInTheDocument()
    expect(screen.getByText('当前 6 张图片，预计生成 3 篇作文')).toBeInTheDocument()
    expect(screen.getByText('作文 1 · 共 2 页')).toBeInTheDocument()
    expect(screen.getByText('作文 3 · 共 2 页')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '开始 OCR 识别（预计 3 篇）' }))
    await user.click(screen.getByRole('button', { name: '确认 OCR 文本' }))

    expect(screen.getByRole('heading', { name: '批改进度' })).toBeInTheDocument()
    expect(screen.getAllByText('作文 11').length).toBeGreaterThan(0)
    expect(screen.getAllByText('作文 13').length).toBeGreaterThan(0)
  })

  it('shows a mixed-pages guide with dismiss and never-remind actions', async () => {
    const user = userEvent.setup()
    renderUploadPage()

    await user.click(screen.getByRole('button', { name: '混合页数' }))

    expect(
      screen.getByText(
        '混合页数模式：未合并的图片会默认作为单页作文。点击图片可选中，多选 2 张以上后可合并为一篇作文；多页作文卡片内可拆分。',
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '知道了' }))
    expect(screen.queryByText('混合页数模式：未合并的图片会默认作为单页作文。')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看操作提示' })).toBeInTheDocument()
  })

  it('stores the mixed-pages never-remind preference locally', async () => {
    const user = userEvent.setup()
    renderUploadPage()

    await user.click(screen.getByRole('button', { name: '混合页数' }))
    await user.click(screen.getByRole('button', { name: '不再提醒' }))

    expect(localStorage.getItem('wenjie-hide-mixed-grouping-guide')).toBe('true')
    expect(screen.queryByText('混合页数模式：未合并的图片会默认作为单页作文。')).not.toBeInTheDocument()
  })

  it('keeps uploaded images as one queued essay per image in default single mode', async () => {
    const user = userEvent.setup()
    renderUploadToProgressFlow()

    await user.click(screen.getByRole('button', { name: '开始 OCR 识别（预计 6 篇）' }))
    await user.click(screen.getByRole('button', { name: '确认 OCR 文本' }))

    expect(screen.getByRole('heading', { name: '批改进度' })).toBeInTheDocument()
    expect(screen.getAllByText('作文 11').length).toBeGreaterThan(0)
    expect(screen.getAllByText('作文 16').length).toBeGreaterThan(0)
  })

  it('merges selected pages into one essay group in mixed mode', async () => {
    const user = userEvent.setup()
    renderUploadPage()

    await user.click(screen.getByRole('button', { name: '混合页数' }))

    expect(screen.getByText('作文 1 · 共 1 页')).toBeInTheDocument()
    expect(screen.getByText('当前 6 张图片，预计生成 6 篇作文')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '选择第 2 张图片' }))
    expect(screen.queryByRole('button', { name: '合并为一篇作文（已选 1 张）' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '选择第 3 张图片' }))
    await user.click(screen.getByRole('button', { name: '合并为一篇作文（已选 2 张）' }))

    expect(screen.getByText('作文 2 · 共 2 页')).toBeInTheDocument()
    expect(screen.getByText('当前 6 张图片，预计生成 5 篇作文')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '拆分此作文 2' })).toBeInTheDocument()
  })

  it('splits a merged essay group back into single-page essays', async () => {
    const user = userEvent.setup()
    renderUploadPage()

    await user.click(screen.getByRole('button', { name: '混合页数' }))
    await user.click(screen.getByRole('button', { name: '选择第 2 张图片' }))
    await user.click(screen.getByRole('button', { name: '选择第 3 张图片' }))
    await user.click(screen.getByRole('button', { name: '合并为一篇作文（已选 2 张）' }))
    await user.click(screen.getByRole('button', { name: '拆分此作文 2' }))

    expect(screen.getByText('当前 6 张图片，预计生成 6 篇作文')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '拆分此作文 2' })).not.toBeInTheDocument()
  })

  it('confirms manually grouped OCR drafts as separate queued essays', async () => {
    const user = userEvent.setup()
    renderUploadToProgressFlow()

    await user.click(screen.getByRole('button', { name: '混合页数' }))
    await user.click(screen.getByRole('button', { name: '选择第 2 张图片' }))
    await user.click(screen.getByRole('button', { name: '选择第 3 张图片' }))
    await user.click(screen.getByRole('button', { name: '合并为一篇作文（已选 2 张）' }))
    await user.click(screen.getByRole('button', { name: '开始 OCR 识别（预计 5 篇）' }))

    expect(screen.getByRole('textbox', { name: '作文 1 OCR 文本' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '作文 2 OCR 文本' })).toBeInTheDocument()

    await user.clear(screen.getByRole('textbox', { name: '作文 1 OCR 文本' }))
    await user.type(screen.getByRole('textbox', { name: '作文 1 OCR 文本' }), 'Manual group one text')
    await user.clear(screen.getByRole('textbox', { name: '作文 2 OCR 文本' }))
    await user.type(screen.getByRole('textbox', { name: '作文 2 OCR 文本' }), 'Manual group two text')
    await user.click(screen.getByRole('button', { name: '确认 OCR 文本' }))

    expect(screen.getByRole('heading', { name: '批改进度' })).toBeInTheDocument()
    expect(screen.getAllByText('作文 11').length).toBeGreaterThan(0)
    expect(screen.getAllByText('作文 12').length).toBeGreaterThan(0)
  })

  it('runs the real OCR link test through the Gateway client and fills editable OCR drafts', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:essay-photo-preview'),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const essayGroupId = ((init as RequestInit).body as FormData).get('essayGroupId') as string

        return {
          ok: true,
          text: async () =>
            JSON.stringify({
            results: [
              {
                essayGroupId,
                text: 'Gateway recognized essay text',
                pages: [{ pageId: 'local-page', text: 'Gateway recognized essay text' }],
                provider: 'remote',
                status: 'success',
              },
            ],
          }),
        }
      }),
    )
    vi.stubEnv('VITE_OCR_API_BASE', 'http://localhost:4317')
    renderUploadPage()

    await clearOrganizerImages(user)
    await user.upload(screen.getByLabelText('选择图片'), new File(['image'], 'essay-photo.png', { type: 'image/png' }))

    await user.click(screen.getByRole('button', { name: 'real OCR 链路测试' }))
    await user.click(screen.getByRole('button', { name: '开始 OCR 识别（预计 1 篇）' }))

    expect(await screen.findByText('OCR 识别完成')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '作文 1 OCR 文本' })).toHaveValue('Gateway recognized essay text')
  })

  it('shows real OCR link-test failure with mock and manual fallback actions', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:essay-photo-preview'),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const essayGroupId = ((init as RequestInit).body as FormData).get('essayGroupId') as string

        return {
          ok: true,
          text: async () =>
            JSON.stringify({
            results: [
              {
                essayGroupId,
                text: '',
                pages: [],
                provider: 'remote',
                status: 'failed',
                error: 'OCR Gateway mock failure: 请使用 mock 草稿或手动输入。',
              },
            ],
          }),
        }
      }),
    )
    vi.stubEnv('VITE_OCR_API_BASE', 'http://localhost:4317')
    renderUploadPage()

    await clearOrganizerImages(user)
    await user.upload(screen.getByLabelText('选择图片'), new File(['image'], 'essay-photo.png', { type: 'image/png' }))

    await user.click(screen.getByRole('button', { name: 'real OCR 链路测试' }))
    await user.click(screen.getByRole('button', { name: '开始 OCR 识别（预计 1 篇）' }))

    expect(await screen.findByText(/OCR Gateway mock failure/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '使用 mock 草稿' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '手动输入 OCR 文本' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '使用 mock 草稿' }))
    expect(await screen.findByText('已使用 mock OCR 草稿作为回退。')).toBeInTheDocument()
    expect((screen.getByRole('textbox', { name: '作文 1 OCR 文本' }) as HTMLTextAreaElement).value).toContain(
      '作文图片 1',
    )
  })

  it('allows manual OCR input after real OCR link-test failure', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:essay-photo-preview'),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const essayGroupId = ((init as RequestInit).body as FormData).get('essayGroupId') as string

        return {
          ok: true,
          text: async () =>
            JSON.stringify({
            results: [
              {
                essayGroupId,
                text: '',
                pages: [],
                provider: 'remote',
                status: 'failed',
                error: 'OCR Gateway mock failure: 请使用 mock 草稿或手动输入。',
              },
            ],
          }),
        }
      }),
    )
    vi.stubEnv('VITE_OCR_API_BASE', 'http://localhost:4317')
    renderUploadPage()

    await clearOrganizerImages(user)
    await user.upload(screen.getByLabelText('选择图片'), new File(['image'], 'essay-photo.png', { type: 'image/png' }))

    await user.click(screen.getByRole('button', { name: 'real OCR 链路测试' }))
    await user.click(screen.getByRole('button', { name: '开始 OCR 识别（预计 1 篇）' }))
    await user.click(await screen.findByRole('button', { name: '手动输入 OCR 文本' }))

    expect(screen.getByRole('textbox', { name: '作文 1 OCR 文本' })).toHaveValue('')
  })

  it('shows an empty-text warning when OCR succeeds with no text', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:essay-photo-preview'),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const essayGroupId = ((init as RequestInit).body as FormData).get('essayGroupId') as string

        return {
          ok: true,
          text: async () =>
            JSON.stringify({
            results: [
              {
                essayGroupId,
                text: '',
                pages: [{ pageId: 'local-page', text: '', warnings: ['empty_text'] }],
                provider: 'remote',
                status: 'success',
              },
            ],
          }),
        }
      }),
    )
    vi.stubEnv('VITE_OCR_API_BASE', 'http://localhost:4317')
    renderUploadPage()

    await clearOrganizerImages(user)
    await user.upload(screen.getByLabelText('选择图片'), new File(['image'], 'essay-photo.png', { type: 'image/png' }))

    await user.click(screen.getByRole('button', { name: 'real OCR 链路测试' }))
    await user.click(screen.getByRole('button', { name: '开始 OCR 识别（预计 1 篇）' }))

    expect(await screen.findByText('识别结果为空，请检查图片或手动输入。')).toBeInTheDocument()
  })
})
