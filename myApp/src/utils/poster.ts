import Taro from '@tarojs/taro'
import { getShareQrcode } from '../services/api'
import { formatMs } from './format'

export const POSTER_CANVAS_ID = 'share-poster'
export const POSTER_WIDTH = 300
export const POSTER_HEIGHT = 470

export interface PosterContent {
  /** The quiz topic the user typed (short label on the poster). */
  topic: string
  /** Number that goes into the accuracy text. */
  accuracy: number
  correctCount: number
  totalCount: number
  masteredCount: number
  /** Total quiz duration in milliseconds, shown as 本次用时. */
  durationMs: number
  /** AI-generated share quote. */
  quote: string
}

export type QrState =
  | { kind: 'loading' }
  | { kind: 'placeholder' }
  | { kind: 'image'; path: string }

type CanvasCtx = ReturnType<typeof Taro.createCanvasContext>

/**
 * Ask the backend for the mini-program code and store it as a local file so
 * the canvas can draw it without download-domain whitelists. Any failure
 * (unconfigured WeChat params, quota, network...) returns a placeholder state:
 * the poster itself is never blocked by the QR code.
 */
export async function loadPosterQrcode(scene = 'poster'): Promise<QrState> {
  try {
    const result = await getShareQrcode(scene)
    if (!result || !result.base64) return { kind: 'placeholder' }
    const filePath = `${Taro.env.USER_DATA_PATH}/poster-qr-${Date.now()}.jpg`
    Taro.getFileSystemManager().writeFileSync(filePath, result.base64, 'base64')
    // Ensure the file is a decodable image before drawing it.
    await Taro.getImageInfo({ src: filePath })
    return { kind: 'image', path: filePath }
  } catch (error) {
    return { kind: 'placeholder' }
  }
}

function ellipsize(text: string, maxChars: number): string {
  const value = String(text || '').trim()
  return value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value
}

/** Wrap a string into at most maxLines lines that fit maxWidth (measured). */
function wrapText(ctx: CanvasCtx, text: string, maxWidth: number, maxLines = 2): string[] {
  const result: string[] = []
  let remaining = String(text || '').trim()
  for (let index = 0; index < maxLines && remaining; index += 1) {
    let line = ''
    for (const char of remaining) {
      const next = line + char
      if (line && ctx.measureText(next).width > maxWidth) break
      line = next
    }
    remaining = remaining.slice(line.length)
    if (index === maxLines - 1 && remaining) {
      while (line && ctx.measureText(`${line}…`).width > maxWidth) {
        line = line.slice(0, -1)
      }
      line += '…'
    }
    result.push(line)
  }
  return result
}

function roundRectPath(ctx: CanvasCtx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

/** Draw the whole share poster (dark-green premium style, 方案 A). Call ctx.draw() afterwards. */
export function drawPoster(ctx: CanvasCtx, content: PosterContent, qr: QrState): void {
  const W = POSTER_WIDTH
  const H = POSTER_HEIGHT
  const gold = '#FFD97A'
  const goldSoft = '#C9BFA8'
  const muted = '#B9AF98'
  const green = '#8FD16A'

  // Dark-green gradient background.
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#1F2A24')
  bg.addColorStop(0.55, '#16211C')
  bg.addColorStop(1, '#0F1713')
  ctx.setFillStyle(bg)
  ctx.fillRect(0, 0, W, H)

  // Decorative glows: gold at top-right, green at bottom-left.
  // (Layered translucent circles — safe fallback since the legacy canvas
  // context does not expose createRadialGradient in its typings.)
  const drawGlow = (gx: number, gy: number, maxR: number, rgb: string) => {
    const layers = [0.1, 0.08, 0.05, 0.03]
    layers.forEach((alpha, index) => {
      ctx.beginPath()
      ctx.arc(gx, gy, (maxR * (index + 1)) / layers.length, 0, Math.PI * 2)
      ctx.setFillStyle(`rgba(${rgb},${alpha})`)
      ctx.fill()
    })
  }
  drawGlow(W, 0, 120, '242,169,0')
  drawGlow(0, H, 110, '91,191,74')

  ctx.setTextBaseline('middle')

  // --- Header: brand left + "今日战报" pill right ---
  ctx.setTextAlign('left')
  ctx.setFillStyle(gold)
  ctx.setFontSize(15)
  ctx.fillText('阿衰闯关学习', 18, 36)

  roundRectPath(ctx, W - 74, 25, 56, 21, 10)
  ctx.setStrokeStyle('rgba(255,217,122,0.35)')
  ctx.setLineWidth(1)
  ctx.stroke()
  ctx.setTextAlign('center')
  ctx.setFillStyle(goldSoft)
  ctx.setFontSize(9)
  ctx.fillText('今日战报', W - 46, 36)

  // --- Topic line: 今日闯关 · <topic> ---
  ctx.setTextAlign('left')
  ctx.setFontSize(10)
  ctx.setFillStyle(muted)
  const prefix = '今日闯关 · '
  ctx.fillText(prefix, 18, 62)
  const prefixWidth = ctx.measureText(prefix).width
  const topicMaxChars = Math.max(6, Math.floor((W - 36 - prefixWidth) / 10))
  ctx.setFillStyle(gold)
  ctx.setFontSize(11)
  ctx.fillText(ellipsize(content.topic, topicMaxChars), 18 + prefixWidth, 62)

  // --- Progress ring (left) ---
  const cx = 72
  const cy = 134
  const ringR = 50
  ctx.setLineCap('round')
  ctx.beginPath()
  ctx.arc(cx, cy, ringR, 0, Math.PI * 2)
  ctx.setStrokeStyle('rgba(255,255,255,0.12)')
  ctx.setLineWidth(9)
  ctx.stroke()
  const ratio = Math.max(0, Math.min(100, content.accuracy)) / 100
  if (ratio > 0) {
    ctx.beginPath()
    ctx.arc(cx, cy, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio)
    ctx.setStrokeStyle(gold)
    ctx.stroke()
  }
  ctx.setLineCap('butt')
  ctx.beginPath()
  ctx.arc(cx, cy, ringR - 10, 0, Math.PI * 2)
  ctx.setFillStyle('#141D18')
  ctx.fill()

  ctx.setTextAlign('center')
  ctx.setFillStyle(gold)
  ctx.setFontSize(21)
  ctx.fillText(`${Math.round(content.accuracy)}%`, cx, cy - 7)
  ctx.setFillStyle(muted)
  ctx.setFontSize(9)
  ctx.fillText('正确率', cx, cy + 14)

  // --- Stat cards (right): 答对 / 掌握 / 用时 ---
  const stats: Array<{ num: string; label: string }> = [
    { num: `${content.correctCount}/${content.totalCount}`, label: '答对题数' },
    { num: `${content.masteredCount}`, label: '掌握知识点' },
    { num: formatMs(content.durationMs), label: '本次用时' }
  ]
  const cardX = 138
  const cardW = W - cardX - 18
  stats.forEach((stat, index) => {
    const cardY = 76 + index * 38
    roundRectPath(ctx, cardX, cardY, cardW, 30, 8)
    ctx.setFillStyle('rgba(255,255,255,0.07)')
    ctx.fill()
    ctx.setStrokeStyle('rgba(255,255,255,0.1)')
    ctx.setLineWidth(1)
    ctx.stroke()
    ctx.setTextAlign('left')
    ctx.setFillStyle(green)
    ctx.setFontSize(13)
    ctx.fillText(stat.num, cardX + 10, cardY + 15)
    const numWidth = ctx.measureText(stat.num).width
    ctx.setFillStyle(muted)
    ctx.setFontSize(9)
    ctx.fillText(stat.label, cardX + 10 + numWidth + 6, cardY + 16)
  })

  // --- Quote card with gold accent bar ---
  const quoteTop = 204
  roundRectPath(ctx, 14, quoteTop, W - 28, 64, 10)
  ctx.setFillStyle('rgba(255,217,122,0.08)')
  ctx.fill()
  roundRectPath(ctx, 14, quoteTop, 4, 64, 2)
  ctx.setFillStyle(gold)
  ctx.fill()

  const quote = content.quote ? `「${content.quote}」` : '「把知识做成关卡，记忆会更深。」'
  ctx.setTextAlign('left')
  ctx.setFillStyle('#EFE6D2')
  ctx.setFontSize(11)
  const quoteLines = wrapText(ctx, quote, W - 32 - 24, 2)
  let quoteY = quoteTop + (quoteLines.length > 1 ? 21 : 32)
  for (const line of quoteLines) {
    ctx.fillText(line, 30, quoteY)
    quoteY += 22
  }

  // --- QR code (left) + call to action (right) ---
  const codeSize = 86
  const codeTop = 296
  ctx.setFillStyle('#ffffff')
  roundRectPath(ctx, 14, codeTop, codeSize, codeSize, 12)
  ctx.fill()
  if (qr.kind === 'image') {
    ctx.drawImage(qr.path, 20, codeTop + 6, codeSize - 12, codeSize - 12)
  } else {
    ctx.setTextAlign('center')
    ctx.setFontSize(11)
    ctx.setFillStyle('#8A8A8A')
    ctx.fillText(
      qr.kind === 'loading' ? '二维码生成中…' : '小程序码',
      14 + codeSize / 2,
      codeTop + codeSize / 2 - 6
    )
    ctx.setFontSize(9)
    ctx.setFillStyle('#B5AFA2')
    ctx.fillText('发布后扫码即可使用', 14 + codeSize / 2, codeTop + codeSize / 2 + 12)
  }

  ctx.setTextAlign('left')
  ctx.setFillStyle(gold)
  ctx.setFontSize(13)
  ctx.fillText('扫码一起闯关 →', 116, codeTop + 26)
  ctx.setFillStyle(muted)
  ctx.setFontSize(9)
  ctx.fillText('把知识做成关卡，每天进步一点点', 116, codeTop + 50)

  // --- Bottom divider + slogan ---
  ctx.setStrokeStyle('rgba(255,255,255,0.08)')
  ctx.setLineWidth(1)
  ctx.beginPath()
  ctx.moveTo(70, 414)
  ctx.lineTo(W - 70, 414)
  ctx.stroke()
  ctx.setTextAlign('center')
  ctx.setFillStyle('#8F866F')
  ctx.setFontSize(10)
  ctx.fillText('阿衰闯关学习 · 万物皆可闯关', W / 2, 438)
}

/** Export the current canvas into a local image file. */
export function exportPosterImage(): Promise<string> {
  return new Promise((resolve, reject) => {
    Taro.canvasToTempFilePath({
      canvasId: POSTER_CANVAS_ID,
      fileType: 'jpg',
      quality: 0.92,
      success: (res) => resolve(res.tempFilePath),
      fail: (error) => reject(error),
    })
  })
}

function isAuthDenied(errMsg: unknown): boolean {
  const message = String((errMsg as { errMsg?: string })?.errMsg || errMsg || '')
  return /auth|deny|authorize/i.test(message)
}

/** Save the poster to the photo album, handling the write-photos permission. */
export async function savePosterToAlbum(): Promise<'saved' | 'denied'> {
  const filePath = await exportPosterImage()
  try {
    await Taro.saveImageToPhotosAlbum({ filePath })
    return 'saved'
  } catch (error) {
    if (!isAuthDenied(error)) throw error
    const modal = await Taro.showModal({
      title: '需要相册权限',
      content: '保存海报需要访问你的相册，请在设置中开启权限',
      confirmText: '去设置',
      cancelText: '取消',
    })
    if (!modal.confirm) return 'denied'
    const setting = await Taro.openSetting()
    if (!setting.authSetting['scope.writePhotosAlbum']) return 'denied'
    await Taro.saveImageToPhotosAlbum({ filePath })
    return 'saved'
  }
}
