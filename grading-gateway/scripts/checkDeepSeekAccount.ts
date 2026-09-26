import { loadDeepSeekEnvironment } from './deepSeekEnvironment.js'
import { parseGatewayRuntimeConfig } from '../src/gatewayRuntimeConfig.js'
import { getMultimodalProvider } from '../src/providers/index.js'

export async function checkDeepSeekAccount() {
  const env = loadDeepSeekEnvironment()
  const config = parseGatewayRuntimeConfig(env)
  getMultimodalProvider(config, { apiKey: env.DEEPSEEK_API_KEY })
  const read = async (path: string) => {
    const response = await fetch(`https://api.deepseek.com${path}`, { redirect: 'error',
      headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY.trim()}` }, signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`DeepSeek read-only preflight HTTP ${response.status}`)
    return response.json()
  }
  const [models, balance] = await Promise.all([read('/models'), read('/user/balance')])
  const model = models.data?.find((item: { id?: string }) => item.id === 'deepseek-flash')
  return { modelAvailable: Boolean(model), imageInput: Array.isArray(model?.input_modalities) ? model.input_modalities.includes('image') : null,
    balanceAvailable: balance.is_available === true,
    balances: Array.isArray(balance.balance_infos) ? balance.balance_infos.filter((b: any) => ['USD', 'CNY'].includes(b.currency)).map((b: any) => ({ currency: b.currency, total: Number(b.total_balance) })) : [] }
}
if (process.argv.includes('--check')) {
  try { console.log(JSON.stringify(await checkDeepSeekAccount())) }
  catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code
    console.log(JSON.stringify({ ok: false, code: ['EACCES', 'ENOTFOUND', 'ETIMEDOUT'].includes(code ?? '') ? code : 'preflight_failed',
      httpStatus: /HTTP (\d{3})$/.exec(error instanceof Error ? error.message : '')?.[1] }))
    process.exitCode = 1
  }
}
