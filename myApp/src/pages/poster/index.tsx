import { Button, Canvas, Text, View } from '@tarojs/components'
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro'
import { useCallback, useEffect, useState } from 'react'
import { getQuizDetail, type QuizDetailResponse, type ReportData } from '../../services/api'
import {
  POSTER_CANVAS_ID,
  drawPoster,
  loadPosterQrcode,
  savePosterToAlbum,
  type PosterContent,
  type QrState
} from '../../utils/poster'
import './index.scss'

export default function PosterPage() {
  const router = useRouter()
  const quizId = router.params.quizId ?? ''
  const [data, setData] = useState<QuizDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [qr, setQr] = useState<QrState>({ kind: 'loading' })
  const [saving, setSaving] = useState(false)

  const report: ReportData | null =
    data?.report && data.report.status === 'completed' ? data.report : null
  const canPoster = Boolean(data && data.status === 'completed' && report)

  const buildContent = useCallback((): PosterContent | null => {
    if (!data || !report) return null
    return {
      topic: data.topic || data.title,
      accuracy: report.accuracy > 0 ? report.accuracy : data.accuracy,
      correctCount: data.correct_count,
      totalCount: data.question_count,
      masteredCount: report.mastered_points.length,
      quote: report.share_quote || ''
    }
  }, [data, report])

  const performDraw = useCallback(
    (qrState: QrState) =>
      new Promise<void>((resolve) => {
        const content = buildContent()
        if (!content) {
          resolve()
          return
        }
        const ctx = Taro.createCanvasContext(POSTER_CANVAS_ID)
        drawPoster(ctx, content, qrState)
        ctx.draw(false, () => resolve())
      }),
    [buildContent]
  )

  // Load the quiz detail on entry.
  useEffect(() => {
    if (!quizId) {
      setLoading(false)
      setFailed(true)
      return
    }
    setLoading(true)
    setFailed(false)
    getQuizDetail(quizId)
      .then(setData)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [quizId])

  // Ask the backend for the mini-program code (independent of the quiz data).
  useEffect(() => {
    let alive = true
    loadPosterQrcode().then((state) => {
      if (alive) setQr(state)
    })
    return () => {
      alive = false
    }
  }, [])

  // (Re)draw once the content and/or the QR code become ready. The canvas must
  // be mounted already, so defer a tick to let it register.
  useEffect(() => {
    if (!canPoster) return
    const timer = setTimeout(() => {
      void performDraw(qr)
    }, 100)
    return () => clearTimeout(timer)
  }, [canPoster, qr, performDraw])

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      await performDraw(qr)
      const result = await savePosterToAlbum()
      if (result === 'saved') {
        Taro.showToast({ title: '海报已保存到相册', icon: 'success' })
      }
    } catch (error) {
      Taro.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  const reload = () => {
    if (!quizId) return
    setLoading(true)
    setFailed(false)
    getQuizDetail(quizId)
      .then(setData)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }

  useShareAppMessage(() => {
    const accuracy = Math.round(report ? report.accuracy : data ? data.accuracy : 0)
    return {
      title: `我在「阿衰闯关学习」闯关拿到 ${accuracy}% 正确率，敢来挑战吗？`,
      path: '/pages/index/index'
    }
  })

  if (loading) {
    return (
      <View className='screen-shell'>
        <Text className='loading-text'>加载中…</Text>
      </View>
    )
  }

  if (failed || !data) {
    return (
      <View className='screen-shell'>
        <View className='empty-box'>
          <Text className='empty-title'>内容加载失败</Text>
          <Button className='retry-btn' onClick={reload}>
            重新加载
          </Button>
        </View>
      </View>
    )
  }

  if (!canPoster) {
    return (
      <View className='screen-shell'>
        <View className='empty-box'>
          <Text className='empty-title'>还没有复盘报告</Text>
          <Text className='empty-sub'>完成闯关并生成复盘报告后，才能制作分享海报。</Text>
        </View>
      </View>
    )
  }

  return (
    <View className='poster-page'>
      <Text className='poster-intro'>生成一张精美海报，分享给好友</Text>
      <View className='poster-preview'>
        <Canvas id={POSTER_CANVAS_ID} canvasId={POSTER_CANVAS_ID} className='poster-canvas' />
      </View>
      <View className='poster-actions'>
        <Button className='poster-btn primary' loading={saving} onClick={() => void handleSave()}>
          保存海报
        </Button>
        <Button className='poster-btn' openType='share'>
          转发给好友
        </Button>
      </View>
      <Text className='poster-tip'>保存后可以把海报发到朋友圈或分享给好友</Text>
    </View>
  )
}
