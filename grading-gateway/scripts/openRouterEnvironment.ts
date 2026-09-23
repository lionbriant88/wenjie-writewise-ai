import { readFileSync } from 'node:fs'
import { parse } from 'dotenv'

// Never load the historical Kimi .env or copy credentials into the browser.
export function loadOpenRouterEnvironment() {
  const defaults = parse(readFileSync(new URL('../config/openrouter.env.example', import.meta.url)))
  const local = parse(readFileSync(new URL('../.env.openrouter.local', import.meta.url)))
  const env = { ...defaults, ...local }
  for (const key of Object.keys(env)) {
    if (process.env[key] !== undefined) env[key] = process.env[key]!
  }
  if (process.env.OPENROUTER_API_KEY) env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
  if (env.GRADING_PROVIDER !== 'openrouter') throw new Error('This launcher requires OpenRouter.')
  return env
}
