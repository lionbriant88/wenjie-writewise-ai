export const PROVIDER_RESULT_LIMITS = {
  publicText: 50_000,
  issueKey: 200,
  relationshipKey: 200,
  recognitionMessage: 1_000,
  possibleReading: 1_000,
  dimensions: 10,
  issues: 100,
  revisions: 100,
  upgrades: 100,
  sentencePairs: 100,
  logicNotes: 100,
  logicIssues: 50,
  legibilityIssues: 50,
  recognitionWarnings: 50,
  relationships: 100,
  changeTypes: 20,
} as const

export const PROVIDER_RESULT_KEYS = {
  result: ['transcript', 'recognitionWarnings', 'printedTextExcluded', 'reportedTotalScore', 'dimensionScores', 'issues', 'sentenceRevisions', 'expressionUpgrades', 'fullTextRevision', 'legibilityIssues', 'overallComment'],
  recognitionWarning: ['scope', 'message'],
  dimensionScore: ['dimensionId', 'score', 'reason', 'evidence', 'relatedIssueKeys'],
  issue: ['issueKey', 'type', 'severity', 'originalText', 'suggestion', 'explanation', 'evidenceCertainty', 'requiresTeacherReview'],
  sentenceRevision: ['originalText', 'revisedText', 'note', 'relatedIssueKeys', 'changeTypes'],
  expressionUpgrade: ['originalText', 'upgradedText', 'note'],
  fullTextRevision: ['sentencePairs', 'logicNotes', 'logicIssues'],
  legacyFullTextRevision: ['correctedText', 'improvedText', 'sentencePairs', 'logicNotes', 'logicIssues'],
  sentencePair: ['originalText', 'correctedText', 'improvedText', 'relatedIssueKeys', 'changeTypes', 'explanation', 'requiresTeacherReview'],
  logicNote: ['quote', 'note'],
  logicIssue: ['issueKey', 'originalText', 'contextBefore', 'contextAfter', 'subType', 'severity', 'diagnosis', 'suggestedAction', 'conservativeSuggestion', 'polishedSuggestion', 'requiresTeacherReview'],
  legibilityIssue: ['issueKey', 'transcriptText', 'possibleReadings', 'pageNumber', 'regionDescription', 'explanation', 'defaultOutcome', 'resolution', 'deductionPoints'],
  legacyLegibilityIssue: ['issueKey', 'transcriptText', 'possibleReadings', 'pageNumber', 'regionDescription', 'explanation', 'defaultOutcome'],
} as const

export function hasExactProviderKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => key in value)
}

export function providerStringSchema(maxLength: number) {
  return { type: 'string', maxLength } as const
}

export function providerNonEmptyStringSchema(maxLength: number) {
  return { type: 'string', minLength: 1, maxLength } as const
}

export function providerNonBlankStringSchema(maxLength: number) {
  return { type: 'string', minLength: 1, maxLength, pattern: '\\S' } as const
}
