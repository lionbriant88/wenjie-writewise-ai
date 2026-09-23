import { fileURLToPath } from 'node:url'
import { loadOpenRouterEnvironment } from './openRouterEnvironment.js'

Object.assign(process.env, loadOpenRouterEnvironment())
process.env.HOST = '127.0.0.1'
process.env.DOTENV_CONFIG_PATH = fileURLToPath(new URL('../.env.openrouter.local', import.meta.url))
await import('../src/index.js')
