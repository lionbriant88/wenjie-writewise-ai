import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { AppStateContext, type AppState } from '../context/appStateContextValue'
import { CloudWorkspace } from './workspace'
import { createPilotClient } from './client'
import { PrivateImage } from './PrivateImage'
it('requests a new private signature after an image read fails', async () => {
  let count = 0
  const client = createPilotClient({
      getCsrfToken: () => null,
      onSessionExpired: () => {},
      fetchImpl: vi.fn(async () =>
        Response.json({
          url: 'https://synthetic.supabase.co/image?signature=' + ++count,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        }),
      ),
    }),
    pilot = new CloudWorkspace(client)
  const view = render(
    <AppStateContext.Provider value={{ pilot } as AppState}>
      <PrivateImage uploadId="synthetic" alt="作文原图" />
    </AppStateContext.Provider>,
  )
  expect(await screen.findByAltText('作文原图')).toHaveAttribute(
    'src',
    expect.stringContaining('signature=1'),
  )
  fireEvent.error(screen.getByAltText('作文原图'))
  fireEvent.click(screen.getByText('重新读取原图'))
  await waitFor(() =>
    expect(screen.getByAltText('作文原图')).toHaveAttribute(
      'src',
      expect.stringContaining('signature=2'),
    ),
  )
  view.unmount()
  pilot.dispose()
})
