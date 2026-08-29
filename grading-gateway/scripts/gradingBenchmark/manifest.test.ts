import { describe, expect, it } from 'vitest'

import {
  computeManifestSha256,
  validateDatasetComposition,
  validateDatasetManifest,
} from './manifest.js'
import type { ManifestValidationErrorCode } from './types.js'

type ManifestInput = {
  manifestVersion: 'grading-benchmark-manifest-v1'
  samples: Array<{
    id: string
    pages: Array<{
      pageOrder: number
      path: string
      mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
      sourceKind: 'image' | 'pdf_page'
    }>
    teacherTranscript: string
    fullScore: number
    teacherScore: number
    importantIssueLabels: string[]
    importantLegibilityLabels: string[]
    strata: {
      page: 'single_page' | 'multi_page_or_pdf'
      legibility: 'clear' | 'difficult'
      scoreBand: 'low' | 'middle' | 'high'
    }
  }>
}

const buildSample = (
  index: number,
  overrides: Partial<ManifestInput['samples'][number]> = {},
): ManifestInput['samples'][number] => ({
  id: `sample-${String(index + 1).padStart(3, '0')}`,
  pages: [
    {
      pageOrder: 1,
      path: `pages/sample-${String(index + 1).padStart(3, '0')}-1.png`,
      mimeType: 'image/png',
      sourceKind: 'image',
    },
  ],
  teacherTranscript: `Synthetic transcript ${index + 1}`,
  fullScore: 15,
  teacherScore: 8,
  importantIssueLabels: ['task_completion'],
  importantLegibilityLabels: [],
  strata: {
    page: 'single_page',
    legibility: 'clear',
    scoreBand: 'middle',
  },
  ...overrides,
})

const buildManifest = (sample = buildSample(0)): ManifestInput => ({
  manifestVersion: 'grading-benchmark-manifest-v1',
  samples: [sample],
})

const injectedFileSystem = (
  privateRoot: string,
  realPathOverrides: Readonly<Record<string, string>> = {},
) => ({
  realpath: async (candidate: string) => realPathOverrides[candidate] ?? candidate,
})

const expectCode = async (promise: Promise<unknown>, code: ManifestValidationErrorCode) => {
  await expect(promise).rejects.toMatchObject({ code })
}

describe('validateDatasetManifest', () => {
  it('accepts only anonymous samples with ordered pages and complete teacher references', async () => {
    const privateRoot = 'C:\\private-a'
    const sample = buildSample(0, {
      pages: [
        {
          pageOrder: 1,
          path: 'pages/sample-001-1.png',
          mimeType: 'image/png',
          sourceKind: 'pdf_page',
        },
        {
          pageOrder: 2,
          path: 'pages/sample-001-2.webp',
          mimeType: 'image/webp',
          sourceKind: 'pdf_page',
        },
      ],
      teacherTranscript: 'A synthetic, teacher-confirmed transcript.',
      fullScore: 15,
      teacherScore: 12,
      importantIssueLabels: ['grammar', 'task_completion'],
      importantLegibilityLabels: ['ambiguous_word'],
      strata: {
        page: 'multi_page_or_pdf',
        legibility: 'difficult',
        scoreBand: 'high',
      },
    })

    const result = await validateDatasetManifest(buildManifest(sample), {
      privateRoot,
      fileSystem: injectedFileSystem(privateRoot),
    })

    expect(result.manifest).toEqual(buildManifest(sample))
    expect(result.manifestSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each([
    ['non-anonymous sample id', buildSample(0, { id: 'student-li' }), 'invalid_sample_id'],
    ['semantic sample id', buildSample(0, { id: 'sample-alice-smith' }), 'invalid_sample_id'],
    ['sample id with a semantic suffix', buildSample(0, { id: 'sample-001-extra' }), 'invalid_sample_id'],
    ['sample id shorter than three digits', buildSample(0, { id: 'sample-01' }), 'invalid_sample_id'],
    ['six-digit sample id that could encode an external identifier', buildSample(0, { id: 'sample-123456' }), 'invalid_sample_id'],
    ['sample id longer than six digits', buildSample(0, { id: 'sample-1234567' }), 'invalid_sample_id'],
    ['missing transcript', buildSample(0, { teacherTranscript: '' }), 'invalid_teacher_transcript'],
    ['score above full score', buildSample(0, { teacherScore: 16 }), 'invalid_teacher_score'],
    [
      'missing important issue labels',
      (() => {
        const { importantIssueLabels: _omitted, ...sample } = buildSample(0)
        return sample
      })(),
      'invalid_sample_fields',
    ],
  ])('rejects %s', async (_name, sample, code) => {
    const privateRoot = 'C:\\private-a'
    await expectCode(
      validateDatasetManifest(
        {
          manifestVersion: 'grading-benchmark-manifest-v1',
          samples: [sample],
        },
        { privateRoot, fileSystem: injectedFileSystem(privateRoot) },
      ),
      code as ManifestValidationErrorCode,
    )
  })

  it.each([
    ['out-of-order sequence', [buildSample(1), buildSample(0)]],
    ['sequence with a missing ordinal', [buildSample(0), buildSample(2)]],
  ])('rejects an %s instead of accepting caller-chosen numeric identities', async (_name, samples) => {
    const privateRoot = 'C:\\private-a'

    await expectCode(
      validateDatasetManifest(
        {
          manifestVersion: 'grading-benchmark-manifest-v1',
          samples,
        },
        { privateRoot, fileSystem: injectedFileSystem(privateRoot) },
      ),
      'invalid_sample_id',
    )
  })

  it.each([
    ['root identity field', { ownerName: 'Teacher A' }, 'invalid_manifest_fields'],
    ['sample identity field', { studentName: 'Alice' }, 'invalid_sample_fields'],
    ['page identity field', { originalFileName: 'alice-essay.png' }, 'invalid_page_fields'],
    ['stratum extra field', { classroom: 'Class 3' }, 'invalid_strata_fields'],
  ])('enforces the exact field whitelist for an injected %s', async (_name, extra, code) => {
    const privateRoot = 'C:\\private-a'
    const manifest = buildManifest()
    const [scope] = _name.split(' ')

    const input: unknown =
      scope === 'root'
        ? { ...manifest, ...extra }
        : scope === 'sample'
          ? { ...manifest, samples: [{ ...manifest.samples[0], ...extra }] }
          : scope === 'page'
            ? {
                ...manifest,
                samples: [
                  {
                    ...manifest.samples[0],
                    pages: [{ ...manifest.samples[0].pages[0], ...extra }],
                  },
                ],
              }
            : {
                ...manifest,
                samples: [
                  {
                    ...manifest.samples[0],
                    strata: { ...manifest.samples[0].strata, ...extra },
                  },
                ],
              }

    await expectCode(
      validateDatasetManifest(input, {
        privateRoot,
        fileSystem: injectedFileSystem(privateRoot),
      }),
      code as ManifestValidationErrorCode,
    )
  })

  it('rejects pages whose explicit order disagrees with array order', async () => {
    const privateRoot = 'C:\\private-a'
    const sample = buildSample(0, {
      pages: [
        {
          pageOrder: 2,
          path: 'pages/sample-001-2.png',
          mimeType: 'image/png',
          sourceKind: 'image',
        },
        {
          pageOrder: 1,
          path: 'pages/sample-001-1.png',
          mimeType: 'image/png',
          sourceKind: 'image',
        },
      ],
      strata: { page: 'multi_page_or_pdf', legibility: 'clear', scoreBand: 'middle' },
    })

    await expectCode(
      validateDatasetManifest(buildManifest(sample), {
        privateRoot,
        fileSystem: injectedFileSystem(privateRoot),
      }),
      'invalid_page_order',
    )
  })

  it.each(['../outside.png', '..\\outside.png', 'C:\\outside.png', '/outside.png'])(
    'rejects a page path that is not relative and contained: %s',
    async (unsafePath) => {
      const privateRoot = 'C:\\private-a'
      const sample = buildSample(0, {
        pages: [
          {
            ...buildSample(0).pages[0],
            path: unsafePath,
          },
        ],
      })

      await expectCode(
        validateDatasetManifest(buildManifest(sample), {
          privateRoot,
          fileSystem: injectedFileSystem(privateRoot),
        }),
        'page_path_outside_private_root',
      )
    },
  )

  it('rejects a symlink whose real path escapes the injected private root', async () => {
    const privateRoot = 'C:\\private-a'
    const lexicalPagePath = 'C:\\private-a\\pages\\sample-001-1.png'

    await expectCode(
      validateDatasetManifest(buildManifest(), {
        privateRoot,
        fileSystem: injectedFileSystem(privateRoot, {
          [lexicalPagePath]: 'C:\\outside\\secret.png',
        }),
      }),
      'page_realpath_outside_private_root',
    )
  })

  it('produces a root-independent canonical SHA-256 and changes it when page order changes', async () => {
    const first = buildManifest(
      buildSample(0, {
        pages: [
          {
            pageOrder: 1,
            path: 'pages/sample-001-a.png',
            mimeType: 'image/png',
            sourceKind: 'image',
          },
          {
            pageOrder: 2,
            path: 'pages/sample-001-b.png',
            mimeType: 'image/png',
            sourceKind: 'image',
          },
        ],
        strata: { page: 'multi_page_or_pdf', legibility: 'clear', scoreBand: 'middle' },
      }),
    )
    const reordered = structuredClone(first)
    reordered.samples[0].pages = [
      { ...reordered.samples[0].pages[1], pageOrder: 1 },
      { ...reordered.samples[0].pages[0], pageOrder: 2 },
    ]

    const rootA = 'C:\\private-a'
    const rootB = 'D:\\different-private-root'
    const validatedA = await validateDatasetManifest(first, {
      privateRoot: rootA,
      fileSystem: injectedFileSystem(rootA),
    })
    const validatedB = await validateDatasetManifest(first, {
      privateRoot: rootB,
      fileSystem: injectedFileSystem(rootB),
    })

    expect(validatedA.manifestSha256).toBe(validatedB.manifestSha256)
    expect(validatedA.manifestSha256).toBe(computeManifestSha256(first))
    expect(computeManifestSha256(reordered)).not.toBe(validatedA.manifestSha256)
  })
})

describe('validateDatasetComposition', () => {
  const buildFortySampleManifest = (): ManifestInput => ({
    manifestVersion: 'grading-benchmark-manifest-v1',
    samples: Array.from({ length: 40 }, (_, index) => {
      const multiPage = index >= 8 && index < 16
      const scoreBand = index < 8 ? 'low' : index < 16 ? 'middle' : 'high'
      return buildSample(index, {
        ...(multiPage
          ? {
              pages: [
              {
                pageOrder: 1,
                path: `pages/sample-${String(index + 1).padStart(3, '0')}-1.png`,
                mimeType: 'image/png',
                sourceKind: 'pdf_page',
              },
              {
                pageOrder: 2,
                path: `pages/sample-${String(index + 1).padStart(3, '0')}-2.png`,
                mimeType: 'image/png',
                sourceKind: 'pdf_page',
              },
              ],
            }
          : {}),
        teacherScore: scoreBand === 'low' ? 3 : scoreBand === 'middle' ? 8 : 13,
        strata: {
          page: multiPage ? 'multi_page_or_pdf' : 'single_page',
          legibility: index >= 16 && index < 24 ? 'difficult' : 'clear',
          scoreBand,
        },
      })
    }),
  })

  it('accepts 40 distinct essays with at least eight members of every required stratum', () => {
    expect(validateDatasetComposition(buildFortySampleManifest())).toEqual({
      essayCount: 40,
      strataCounts: {
        singlePage: 32,
        multiPageOrPdf: 8,
        clear: 32,
        difficult: 8,
        low: 8,
        middle: 8,
        high: 24,
      },
    })
  })

  it('rejects duplicate essays even when there are 40 entries', () => {
    const manifest = buildFortySampleManifest()
    manifest.samples[39].id = manifest.samples[0].id

    expect(() => validateDatasetComposition(manifest)).toThrowError(
      expect.objectContaining({ code: 'duplicate_sample_id' }),
    )
  })

  it.each([
    ['essayCount', (manifest: ManifestInput) => manifest.samples.pop()],
    [
      'singlePage',
      (manifest: ManifestInput) => {
        for (let index = 0; index < 33; index += 1) {
          manifest.samples[index].strata.page = 'multi_page_or_pdf'
        }
      },
    ],
    [
      'multiPageOrPdf',
      (manifest: ManifestInput) => {
        manifest.samples[15].strata.page = 'single_page'
      },
    ],
    [
      'clear',
      (manifest: ManifestInput) => {
        for (let index = 0; index < 33; index += 1) {
          manifest.samples[index].strata.legibility = 'difficult'
        }
      },
    ],
    [
      'difficult',
      (manifest: ManifestInput) => {
        manifest.samples[23].strata.legibility = 'clear'
      },
    ],
    [
      'low',
      (manifest: ManifestInput) => {
        manifest.samples[7].strata.scoreBand = 'middle'
      },
    ],
    [
      'middle',
      (manifest: ManifestInput) => {
        manifest.samples[15].strata.scoreBand = 'high'
      },
    ],
    [
      'high',
      (manifest: ManifestInput) => {
        for (let index = 16; index < 33; index += 1) {
          manifest.samples[index].strata.scoreBand = 'middle'
        }
      },
    ],
  ])('rejects a dataset below the %s minimum', (_stratum, makeInvalid) => {
    const manifest = buildFortySampleManifest()
    makeInvalid(manifest)

    expect(() => validateDatasetComposition(manifest)).toThrowError(
      expect.objectContaining({ code: 'invalid_dataset_composition' }),
    )
  })
})
