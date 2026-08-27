import type { TaskMaterialRequestBase, TaskMaterialRequestUnit } from './types'

interface ImageManifestEntry {
  id: string
  kind: 'image'
  imageIndex: number
}

interface TextManifestEntry {
  id: string
  kind: 'text'
  textIndex: number
}

type MaterialManifestEntry = ImageManifestEntry | TextManifestEntry

const SAFE_IMAGE_EXTENSIONS: Record<string, 'jpeg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function appendTaskMaterials(
  formData: FormData,
  materials: readonly TaskMaterialRequestUnit[],
): void {
  const manifest: MaterialManifestEntry[] = []
  const images: File[] = []
  const textMaterials: Array<{ displayName: string; text: string }> = []

  for (const material of materials) {
    if (material.kind === 'image') {
      manifest.push({ id: material.id, kind: 'image', imageIndex: images.length })
      images.push(material.file)
      continue
    }
    if (material.kind === 'text') {
      manifest.push({ id: material.id, kind: 'text', textIndex: textMaterials.length })
      textMaterials.push({ displayName: material.displayName, text: material.text })
      continue
    }
    throw new Error('Unsupported ready task material unit.')
  }

  formData.append('materialManifest', JSON.stringify(manifest))
  images.forEach((file, index) => {
    const extension = SAFE_IMAGE_EXTENSIONS[file.type] ?? 'jpeg'
    formData.append('images', file, `material-image-${index + 1}.${extension}`)
  })
  formData.append('textMaterials', JSON.stringify(textMaterials))
}

export function createTaskMaterialFormData(
  request: Pick<TaskMaterialRequestBase, 'requestId' | 'fullScore' | 'writingRequirement' | 'materials'>,
): FormData {
  const formData = new FormData()
  formData.append('requestId', request.requestId)
  formData.append('fullScore', String(request.fullScore))
  formData.append('writingRequirement', request.writingRequirement)
  appendTaskMaterials(formData, request.materials)
  return formData
}
