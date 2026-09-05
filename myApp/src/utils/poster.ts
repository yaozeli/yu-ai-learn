import Taro from '@tarojs/taro'
import { getShareQrcode } from '../services/api'

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

/** Draw the whole share poster. Call ctx.draw() afterwards. */
export function drawPoster(ctx: CanvasCtx, content: PosterContent, qr: QrState): void {
  const W = POSTER_WIDTH
  const H = POSTER_HEIGHT
  const goldDeep = '#B57A0E'
  const gold = '#E08A00'
  const ink = '#4E3A22'
  const muted = '#8A5A16'

  // Warm golden background.
  const gradient = ctx.createLinearGradient(0, 0, 0, H)
  gradient.addColorStop(0, '#FFF8E2')
  gradient.addColorStop(1, '#FFE4AA')
  ctx.setFillStyle(gradient)
  ctx.fillRect(0, 0, W, H)

  ctx.setTextAlign('center')
  ctx.setTextBaseline('middle')

  // Brand header.
  ctx.setFillStyle(goldDeep)
  ctx.setFontSize(18)
  ctx.fillText('阿衰闯关学习', W / 2, 44)

  ctx.setFontSize(10)
  ctx.setFillStyle(goldDeep)
  ctx.fillText(`今日闯关 · ${ellipsize(content.topic, 18)}`, W / 2, 66)

  // Small divider under the header.
  ctx.setStrokeStyle('rgba(181,122,14,0.3)')
  ctx.setLineWidth(1)
  ctx.beginPath()
  ctx.moveTo(W / 2 - 56, 84)
  ctx.lineTo(W / 2 + 56, 84)
  ctx.stroke()

  // Accuracy headline.
  ctx.setFillStyle(gold)
  ctx.setFontSize(54)
  ctx.fillText(`${Math.round(content.accuracy)}%`, W / 2, 132)

  ctx.setFontSize(11)
  ctx.setFillStyle(muted)
  ctx.fillText('正确率', W / 2, 158)

  ctx.setFontSize(12)
  ctx.fillText(
    `答对 ${content.correctCount}/${content.totalCount} 题 · 掌握 ${content.masteredCount} 个知识点`,
    W / 2,
    188
  )

  // Quote area (fixed two lines keeps the QR block position stable).
  const quote = content.quote ? `「${content.quote}」` : '「把知识做成关卡，记忆会更深。」'
  const quoteLines = wrapText(ctx, quote, W - 52, 2)
  ctx.setFillStyle(ink)
  ctx.setFontSize(14)
  let quoteY = 226
  for (const line of quoteLines) {
    ctx.fillText(line, W / 2, quoteY)
    quoteY += 24
  }

  // QR code block.
  const codeSize = 104
  const codeLeft = (W - codeSize) / 2
  const codeTop = quoteY + 14
  ctx.setFillStyle('#ffffff')
  roundRectPath(ctx, codeLeft, codeTop, codeSize, codeSize, 10)
  ctx.fill()
  ctx.setStrokeStyle('rgba(181,122,14,0.35)')
  ctx.setLineWidth(1)
  roundRectPath(ctx, codeLeft, codeTop, codeSize, codeSize, 10)
  ctx.stroke()

  if (qr.kind === 'image') {
    ctx.drawImage(qr.path, codeLeft + 6, codeTop + 6, codeSize - 12, codeSize - 12)
  } else {
    ctx.setFontSize(11)
    ctx.setFillStyle('#B57A0E')
    ctx.fillText(qr.kind === 'loading' ? '二维码生成中…' : '小程序码', W / 2, codeTop + codeSize / 2 - 6)
    ctx.setFontSize(9)
    ctx.setFillStyle('#C8A25F')
    ctx.fillText('发布后扫码即可使用', W / 2, codeTop + codeSize / 2 + 14)
  }

  // Footer slogan.
  ctx.setFontSize(11)
  ctx.setFillStyle(muted)
  ctx.fillText('阿衰闯关学习 · 扫码一起闯关', W / 2, H - 24)
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
