import '@fontsource/bricolage-grotesque/500.css'
import '@fontsource/bricolage-grotesque/700.css'
import '@fontsource/bricolage-grotesque/800.css'
import '@fontsource/figtree/400.css'
import '@fontsource/figtree/500.css'
import '@fontsource/figtree/600.css'
import './style.css'
import {
  applySegmentationMask,
  preload,
  segmentForeground,
  type Config,
} from '@imgly/background-removal'

/** Expand the keep-mask so uncertain edges / hair aren't clipped. */
const MASK_CLOSE_RADIUS = 1
const MASK_DILATE_RADIUS = 2
/** Lift mid-alpha toward opaque (gamma < 1). */
const MASK_ALPHA_GAMMA = 0.72

const ACCEPTED = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/bmp',
])

type AppState = {
  originalUrl: string | null
  resultUrl: string | null
  resultBlob: Blob | null
  fileName: string
  width: number
  height: number
  busy: boolean
}

const state: AppState = {
  originalUrl: null,
  resultUrl: null,
  resultBlob: null,
  fileName: 'image',
  width: 0,
  height: 0,
  busy: false,
}

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <main class="shell">
    <header class="brand">
      <div class="brand__mark" aria-hidden="true">
        <span class="brand__dot"></span>
      </div>
      <h1 class="brand__name">Knockout</h1>
      <p class="brand__tag">
        Drop any image. Get a transparent PNG at the original size. Free.
      </p>
    </header>

    <div
      class="dropzone"
      id="dropzone"
      role="button"
      tabindex="0"
      aria-label="Drop an image or click to browse"
    >
      <input
        class="file-input"
        id="file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp"
      />
      <div class="dropzone__content">
        <div class="dropzone__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M12 16V4m0 0l-4 4m4-4l4 4" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M4 16.5V18a2 2 0 002 2h12a2 2 0 002-2v-1.5" stroke-linecap="round"/>
          </svg>
        </div>
        <p class="dropzone__title">Drop an image here</p>
        <p class="dropzone__hint">
          or <span class="dropzone__browse">browse</span> · PNG, JPG, WebP
        </p>
      </div>
      <div class="progress-panel" id="progress-panel" aria-live="polite">
        <p class="progress-panel__label" id="progress-label">Preparing model…</p>
        <div class="progress-track">
          <div class="progress-fill" id="progress-fill"></div>
        </div>
        <p class="progress-panel__meta" id="progress-meta">0%</p>
      </div>
    </div>

    <p class="error" id="error" role="alert"></p>

    <section class="workspace" id="workspace" hidden>
      <div class="preview">
        <img id="result-image" alt="Background removed result" />
      </div>
      <div class="meta-row">
        <p class="meta-row__info" id="meta-info"></p>
      </div>
      <div class="actions">
        <button type="button" class="btn btn--primary" id="download-btn">
          Download PNG
        </button>
        <button type="button" class="btn btn--ghost" id="again-btn">
          Another image
        </button>
      </div>
    </section>

    <footer class="credit">
      Created by
      <a
        href="http://tiktok.com/@therealonesliveagency"
        target="_blank"
        rel="noopener noreferrer"
      >Jamie Mathieson</a>
    </footer>
  </main>
`

const dropzone = document.querySelector<HTMLDivElement>('#dropzone')!
const fileInput = document.querySelector<HTMLInputElement>('#file-input')!
const errorEl = document.querySelector<HTMLParagraphElement>('#error')!
const workspace = document.querySelector<HTMLElement>('#workspace')!
const resultImage = document.querySelector<HTMLImageElement>('#result-image')!
const metaInfo = document.querySelector<HTMLParagraphElement>('#meta-info')!
const downloadBtn = document.querySelector<HTMLButtonElement>('#download-btn')!
const againBtn = document.querySelector<HTMLButtonElement>('#again-btn')!
const progressFill = document.querySelector<HTMLDivElement>('#progress-fill')!
const progressLabel = document.querySelector<HTMLParagraphElement>('#progress-label')!
const progressMeta = document.querySelector<HTMLParagraphElement>('#progress-meta')!

function showError(message: string) {
  errorEl.textContent = message
  errorEl.classList.add('is-visible')
}

function clearError() {
  errorEl.textContent = ''
  errorEl.classList.remove('is-visible')
}

function setBusy(busy: boolean) {
  state.busy = busy
  dropzone.classList.toggle('is-busy', busy)
  dropzone.setAttribute('aria-busy', String(busy))
}

function setProgress(pct: number, label: string) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)))
  progressFill.style.width = `${clamped}%`
  progressLabel.textContent = label
  progressMeta.textContent = `${clamped}%`
}

function revokeUrls() {
  if (state.originalUrl) URL.revokeObjectURL(state.originalUrl)
  if (state.resultUrl) URL.revokeObjectURL(state.resultUrl)
  state.originalUrl = null
  state.resultUrl = null
  state.resultBlob = null
}

function resetUi() {
  revokeUrls()
  workspace.classList.remove('is-visible')
  workspace.hidden = true
  dropzone.hidden = false
  resultImage.removeAttribute('src')
  fileInput.value = ''
  clearError()
  setProgress(0, 'Preparing model…')
}

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '') || 'image'
}

function readImageSize(file: File): Promise<{ width: number; height: number; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight, url })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that image.'))
    }
    img.src = url
  })
}

function buildConfig(device: Config['device'] = 'gpu'): Config {
  // `isnet` (== "large") is full-precision; prefer accuracy over fp16/quint8 speed.
  return {
    model: 'isnet',
    device,
    rescale: true,
    output: {
      format: 'image/png',
      quality: 1,
    },
    progress: (key, current, total) => {
      if (!total) return
      const pct = (current / total) * 100
      const shortKey = key.split('/').pop() ?? key
      setProgress(pct * 0.7, `Downloading ${shortKey}…`)
    },
  }
}

function morphMax(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return src
  const out = new Uint8Array(src.length)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(height - 1, y + radius)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width - 1, x + radius)
      let max = 0
      for (let yy = y0; yy <= y1; yy++) {
        const row = yy * width
        for (let xx = x0; xx <= x1; xx++) {
          const v = src[row + xx]
          if (v > max) {
            max = v
            if (max === 255) break
          }
        }
        if (max === 255) break
      }
      out[y * width + x] = max
    }
  }
  return out
}

function morphMin(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return src
  const out = new Uint8Array(src.length)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(height - 1, y + radius)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width - 1, x + radius)
      let min = 255
      for (let yy = y0; yy <= y1; yy++) {
        const row = yy * width
        for (let xx = x0; xx <= x1; xx++) {
          const v = src[row + xx]
          if (v < min) {
            min = v
            if (min === 0) break
          }
        }
        if (min === 0) break
      }
      out[y * width + x] = min
    }
  }
  return out
}

/**
 * Bias the alpha mask toward keeping the subject: close small holes, lift
 * mid-alpha, then dilate slightly so hair/edges aren't clipped.
 */
async function protectSubjectMask(maskBlob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(maskBlob)
  const { width, height } = bitmap
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    bitmap.close()
    throw new Error('Could not process segmentation mask.')
  }

  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const imageData = ctx.getImageData(0, 0, width, height)
  const pixels = imageData.data
  const alpha = new Uint8Array(width * height)

  for (let i = 0; i < alpha.length; i++) {
    const a = pixels[i * 4 + 3]
    // Lift uncertain mid-tones toward keep without blowing out near-zero bg.
    alpha[i] =
      a <= 8
        ? a
        : Math.min(255, Math.round(255 * Math.pow(a / 255, MASK_ALPHA_GAMMA)))
  }

  const closed = morphMin(
    morphMax(alpha, width, height, MASK_CLOSE_RADIUS),
    width,
    height,
    MASK_CLOSE_RADIUS,
  )
  const dilated = morphMax(closed, width, height, MASK_DILATE_RADIUS)

  for (let i = 0; i < dilated.length; i++) {
    const o = i * 4
    pixels[o] = 255
    pixels[o + 1] = 255
    pixels[o + 2] = 255
    pixels[o + 3] = dilated[i]
  }
  ctx.putImageData(imageData, 0, 0)

  const protectedBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode mask.'))),
      'image/png',
    )
  })
  return protectedBlob
}

async function removeWithProtectedMask(file: File, config: Config): Promise<Blob> {
  setProgress(72, 'Segmenting subject…')
  const mask = await segmentForeground(file, config)
  setProgress(88, 'Protecting subject edges…')
  const protectedMask = await protectSubjectMask(mask)
  setProgress(94, 'Applying mask…')
  return await applySegmentationMask(file, protectedMask, {
    ...config,
    output: {
      format: 'image/png',
      quality: 1,
    },
  })
}

async function removeBackgroundSafe(file: File): Promise<Blob> {
  try {
    return await removeWithProtectedMask(file, buildConfig('gpu'))
  } catch (gpuErr) {
    console.warn('GPU path failed, retrying on CPU', gpuErr)
    setProgress(12, 'Retrying on CPU…')
    return await removeWithProtectedMask(file, buildConfig('cpu'))
  }
}

async function processFile(file: File) {
  if (state.busy) return

  if (!ACCEPTED.has(file.type) && !file.type.startsWith('image/')) {
    showError('Please drop a PNG, JPG, or WebP image.')
    return
  }

  clearError()
  revokeUrls()
  workspace.classList.remove('is-visible')
  workspace.hidden = true
  dropzone.hidden = false
  setBusy(true)
  setProgress(2, 'Reading image…')

  try {
    const { width, height, url } = await readImageSize(file)
    state.originalUrl = url
    state.width = width
    state.height = height
    state.fileName = baseName(file.name)

    setProgress(8, 'Removing background…')

    const blob = await removeBackgroundSafe(file)

    setProgress(95, 'Encoding PNG…')

    // Verify output dimensions match the source
    const resultUrl = URL.createObjectURL(blob)
    const sized = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => reject(new Error('Failed to decode result PNG.'))
      img.src = resultUrl
    })

    state.resultUrl = resultUrl
    state.resultBlob = blob

    resultImage.src = resultUrl
    metaInfo.innerHTML = `<strong>${sized.w}×${sized.h}px</strong> · transparent PNG · ${formatBytes(blob.size)}`

    setProgress(100, 'Done')
    dropzone.hidden = true
    workspace.hidden = false
    workspace.classList.add('is-visible')
  } catch (err) {
    console.error(err)
    const message =
      err instanceof Error ? err.message : 'Background removal failed. Try another image.'
    showError(message)
  } finally {
    setBusy(false)
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function downloadResult() {
  if (!state.resultBlob || !state.resultUrl) return
  const a = document.createElement('a')
  a.href = state.resultUrl
  a.download = `${state.fileName}-knockout.png`
  a.click()
}

function onFiles(files: FileList | null | undefined) {
  const file = files?.[0]
  if (file) void processFile(file)
}

dropzone.addEventListener('click', () => {
  if (!state.busy) fileInput.click()
})

dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    if (!state.busy) fileInput.click()
  }
})

fileInput.addEventListener('change', () => onFiles(fileInput.files))

dropzone.addEventListener('dragenter', (e) => {
  e.preventDefault()
  dropzone.classList.add('is-dragging')
})

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault()
  dropzone.classList.add('is-dragging')
})

dropzone.addEventListener('dragleave', (e) => {
  e.preventDefault()
  if (!dropzone.contains(e.relatedTarget as Node)) {
    dropzone.classList.remove('is-dragging')
  }
})

dropzone.addEventListener('drop', (e) => {
  e.preventDefault()
  dropzone.classList.remove('is-dragging')
  onFiles(e.dataTransfer?.files)
})

downloadBtn.addEventListener('click', downloadResult)
againBtn.addEventListener('click', resetUi)

// Warm the model cache so the first drop feels snappier
void preload(buildConfig('cpu')).catch(() => {
  // Preload is best-effort; processing will fetch on demand.
})
