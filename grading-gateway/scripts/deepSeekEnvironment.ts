import { readFileSync } from 'node:fs'
import { parse } from 'dotenv'

export function loadDeepSeekEnvironment() {
  const defaults = parse(readFileSync(new URL('../config/deepseek.env.example', import.meta.url)))
  const local = parse(readFileSync(new URL('../.env.deepseek.local', import.meta.url)))
  const env = { ...defaults, ...local }
  for (const key of Object.keys(env)) if (process.env[key] !== undefined) env[key] = process.env[key]!
  if (process.env.DEEPSEEK_API_KEY) env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
  if (env.GRADING_PROVIDER !== 'deepseek') throw new Error('This launcher requires DeepSeek.')
  return env
}
