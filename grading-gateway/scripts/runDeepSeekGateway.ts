import { loadDeepSeekEnvironment } from './deepSeekEnvironment.js'
Object.assign(process.env, loadDeepSeekEnvironment())
await import('../src/index.js')
