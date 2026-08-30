import {
  arrayAt,
  codePointLengthAt,
  enumAt,
  fail,
  hasOnlyKeys,
  jsonUtf8ByteLength,
  opaqueAt,
  pass,
  stringAt,
  uniqueStringsAt,
  type ClassReviewProviderOutputV1,
  type ClassReviewSynthesisRequestV1,
  type Severity,
  type ValidationResult,
} from './types.js'

const SEVERITIES: readonly Severity[] = ['low', 'medium', 'high']

const opaqueAliasSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$',
} as const

export const classReviewProviderOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['overallComment', 'strengths', 'patterns', 'learningRecommendations'],
  properties: {
    overallComment: { type: 'string', minLength: 1, maxLength: 300 },
    strengths: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail', 'dimensionIds'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 40 },
          detail: { type: 'string', minLength: 1, maxLength: 120 },
          dimensionIds: {
            type: 'array',
            minItems: 0,
            maxItems: 3,
            uniqueItems: true,
            items: opaqueAliasSchema,
          },
        },
      },
    },
    patterns: {
      type: 'array',
      minItems: 0,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['groupIds', 'title', 'diagnosis', 'teachingAction', 'severity'],
        properties: {
          groupIds: {
            type: 'array',
            minItems: 1,
            maxItems: 12,
            uniqueItems: true,
            items: opaqueAliasSchema,
          },
          title: { type: 'string', minLength: 1, maxLength: 40 },
          diagnosis: { type: 'string', minLength: 1, maxLength: 100 },
          teachingAction: { type: 'string', minLength: 1, maxLength: 100 },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
    },
    learningRecommendations: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'action'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 40 },
          action: { type: 'string', minLength: 1, maxLength: 120 },
        },
      },
    },
  },
} as const

export function validateClassReviewProviderOutput(
  value: unknown,
  request: ClassReviewSynthesisRequestV1,
): ValidationResult<ClassReviewProviderOutputV1> {
  const path = '/output'
  const record = hasOnlyKeys(value, path, [
    'overallComment', 'strengths', 'patterns', 'learningRecommendations',
  ])
  if (!record.ok) return record
  const overallComment = stringAt(record.value.overallComment, `${path}/overallComment`, 300)
  if (!overallComment.ok) return overallComment
  const overallLength = codePointLengthAt(overallComment.value, `${path}/overallComment`, 2200)
  if (!overallLength.ok) return overallLength
  let visibleCodePoints = overallLength.value

  const knownDimensionIds = new Set(request.statistics.dimensions.map(({ dimensionId }) => dimensionId))
  const strengths = arrayAt<ClassReviewProviderOutputV1['strengths'][number]>(
    record.value.strengths,
    `${path}/strengths`,
    3,
    (item, itemPath) => {
      const strength = hasOnlyKeys(item, itemPath, ['title', 'detail', 'dimensionIds'])
      if (!strength.ok) return strength
      const title = stringAt(strength.value.title, `${itemPath}/title`, 40)
      if (!title.ok) return title
      const detail = stringAt(strength.value.detail, `${itemPath}/detail`, 120)
      if (!detail.ok) return detail
      const dimensionIds = arrayAt(strength.value.dimensionIds, `${itemPath}/dimensionIds`, 3, opaqueAt)
      if (!dimensionIds.ok) return dimensionIds
      const unique = uniqueStringsAt(dimensionIds.value, (index) => `${itemPath}/dimensionIds/${index}`)
      if (!unique.ok) return unique
      for (let index = 0; index < dimensionIds.value.length; index += 1) {
        if (!knownDimensionIds.has(dimensionIds.value[index])) {
          return fail('unknown_reference', `${itemPath}/dimensionIds/${index}`)
        }
      }
      const titleLength = codePointLengthAt(title.value, `${itemPath}/title`, 2200)
      if (!titleLength.ok) return titleLength
      const detailLength = codePointLengthAt(detail.value, `${itemPath}/detail`, 2200)
      if (!detailLength.ok) return detailLength
      visibleCodePoints += titleLength.value + detailLength.value
      return pass({ title: title.value, detail: detail.value, dimensionIds: dimensionIds.value })
    },
    1,
  )
  if (!strengths.ok) return strengths

  const knownGroupIds = new Set(request.groups.map(({ groupId }) => groupId))
  const ownedGroupIds = new Set<string>()
  const patterns = arrayAt<ClassReviewProviderOutputV1['patterns'][number]>(
    record.value.patterns,
    `${path}/patterns`,
    8,
    (item, itemPath) => {
      const pattern = hasOnlyKeys(item, itemPath, [
        'groupIds', 'title', 'diagnosis', 'teachingAction', 'severity',
      ])
      if (!pattern.ok) return pattern
      const groupIds = arrayAt(pattern.value.groupIds, `${itemPath}/groupIds`, 12, opaqueAt, 1)
      if (!groupIds.ok) return groupIds
      const unique = uniqueStringsAt(groupIds.value, (index) => `${itemPath}/groupIds/${index}`)
      if (!unique.ok) return unique
      for (let index = 0; index < groupIds.value.length; index += 1) {
        const groupId = groupIds.value[index]
        if (!knownGroupIds.has(groupId)) return fail('unknown_reference', `${itemPath}/groupIds/${index}`)
        if (ownedGroupIds.has(groupId)) return fail('duplicate_value', `${itemPath}/groupIds/${index}`)
        ownedGroupIds.add(groupId)
      }
      const title = stringAt(pattern.value.title, `${itemPath}/title`, 40)
      if (!title.ok) return title
      const diagnosis = stringAt(pattern.value.diagnosis, `${itemPath}/diagnosis`, 100)
      if (!diagnosis.ok) return diagnosis
      const teachingAction = stringAt(pattern.value.teachingAction, `${itemPath}/teachingAction`, 100)
      if (!teachingAction.ok) return teachingAction
      const severity = enumAt(pattern.value.severity, `${itemPath}/severity`, SEVERITIES)
      if (!severity.ok) return severity
      const titleLength = codePointLengthAt(title.value, `${itemPath}/title`, 2200)
      if (!titleLength.ok) return titleLength
      const diagnosisLength = codePointLengthAt(diagnosis.value, `${itemPath}/diagnosis`, 2200)
      if (!diagnosisLength.ok) return diagnosisLength
      const actionLength = codePointLengthAt(teachingAction.value, `${itemPath}/teachingAction`, 2200)
      if (!actionLength.ok) return actionLength
      visibleCodePoints += titleLength.value + diagnosisLength.value + actionLength.value
      return pass({
        groupIds: groupIds.value,
        title: title.value,
        diagnosis: diagnosis.value,
        teachingAction: teachingAction.value,
        severity: severity.value,
      })
    },
  )
  if (!patterns.ok) return patterns

  const recommendations = arrayAt<ClassReviewProviderOutputV1['learningRecommendations'][number]>(
    record.value.learningRecommendations,
    `${path}/learningRecommendations`,
    3,
    (item, itemPath) => {
      const recommendation = hasOnlyKeys(item, itemPath, ['title', 'action'])
      if (!recommendation.ok) return recommendation
      const title = stringAt(recommendation.value.title, `${itemPath}/title`, 40)
      if (!title.ok) return title
      const action = stringAt(recommendation.value.action, `${itemPath}/action`, 120)
      if (!action.ok) return action
      const titleLength = codePointLengthAt(title.value, `${itemPath}/title`, 2200)
      if (!titleLength.ok) return titleLength
      const actionLength = codePointLengthAt(action.value, `${itemPath}/action`, 2200)
      if (!actionLength.ok) return actionLength
      visibleCodePoints += titleLength.value + actionLength.value
      return pass({ title: title.value, action: action.value })
    },
    1,
  )
  if (!recommendations.ok) return recommendations
  if (visibleCodePoints > 2200) return fail('limit_exceeded', path)

  const output: ClassReviewProviderOutputV1 = {
    overallComment: overallComment.value,
    strengths: strengths.value,
    patterns: patterns.value,
    learningRecommendations: recommendations.value,
  }
  return jsonUtf8ByteLength(output) <= 16 * 1024
    ? pass(output)
    : fail('limit_exceeded', path)
}
