export type SafeGradingDiagnosticStage = 'provider' | 'normalization'

export interface SafeGradingDiagnostic {
  readonly stage: SafeGradingDiagnosticStage
  readonly diagnosticCode: string
}

export type SafeGradingDiagnosticSink = (diagnostic: SafeGradingDiagnostic) => void

const SAFE_DIAGNOSTIC_CODE = /^[a-z][a-z0-9_]{0,63}$/

function sanitizedDiagnostic(diagnostic: SafeGradingDiagnostic): SafeGradingDiagnostic {
  return {
    stage: diagnostic.stage,
    diagnosticCode: SAFE_DIAGNOSTIC_CODE.test(diagnostic.diagnosticCode)
      ? diagnostic.diagnosticCode
      : 'diagnostic_unavailable',
  }
}

export function emitSafeGradingDiagnostic(
  sink: SafeGradingDiagnosticSink | undefined,
  diagnostic: SafeGradingDiagnostic,
): void {
  if (!sink) return
  try {
    sink(sanitizedDiagnostic(diagnostic))
  } catch {
    // Diagnostics must never alter the grading response path.
  }
}

export function createSafeDiagnosticStderrSink(
  enabled: string | undefined,
  output: (line: string) => void,
): SafeGradingDiagnosticSink | undefined {
  if (enabled !== '1') return undefined
  return (diagnostic) => {
    output(JSON.stringify({ event: 'grading_safe_diagnostic', ...sanitizedDiagnostic(diagnostic) }))
  }
}
