import { Button, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useEffect, useMemo, useState } from 'react'
import {
  getWrongQuestions,
  getUserOverview,
  retryWrongQuestion,
  startPendingQuiz,
  type WrongQuestionItem
} from '../../services/api'
import { formatTime, reviewStatusText } from '../../utils/format'
import './index.scss'

interface Group {
  knowledgePoint: string
  items: WrongQuestionItem[]
}

function groupByKnowledge(items: WrongQuestionItem[]): Group[] {
  const map = new Map<string, WrongQuestionItem[]>()
  for (const item of items) {
    const kp = item.question?.knowledge_point || '其他'
    const group = map.get(kp) || []
    group.push(item)
    map.set(kp, group)
  }
  return Array.from(map.entries())
    .map(([knowledgePoint, groupItems]) => ({ knowledgePoint, items: groupItems }))
    .sort((a, b) => b.items.length - a.items.length)
}

export default function WrongQuestions() {
  const [list, setList] = useState<WrongQuestionItem[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [empty, setEmpty] = useState(false)
  const [failed, setFailed] = useState(false)
  const [wrongTotal, setWrongTotal] = useState(0)
  const [dueTotal, setDueTotal] = useState(0)
  const [retryingId, setRetryingId] = useState('')

  const load = async (p = 1) => {
    setLoading(true)
    setFailed(false)
    try {
      const res = await getWrongQuestions(p, 15)
      if (p === 1) setList(res.items)
      else setList((prev) => [...prev, ...res.items])
      setHasMore(res.has_more)
      setEmpty(res.items.length === 0 && p === 1)
      setPage(p)
    } catch {
      if (p === 1) setFailed(true)
      else Taro.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  const loadOverview = () => {
    getUserOverview()
      .then((overview) => {
        setWrongTotal(overview.wrong_total)
        setDueTotal(overview.due_review_total)
      })
      .catch(() => undefined)
  }

  useDidShow(() => {
    loadOverview()
    void load(1)
  })

  useEffect(() => {
    if (page === 1 && list.length > 0) {
      loadOverview()
    }
  }, [list.length, page])

  const onLoadMore = () => {
    if (!loading && hasMore) void load(page + 1)
  }

  const navigateDetail = (wrongId: string) => {
    Taro.navigateTo({ url: `/pages/wrong-questions/detail?id=${wrongId}` })
  }

  const onRetry = async (item: WrongQuestionItem, event: { stopPropagation: () => void }) => {
    event.stopPropagation()
    if (retryingId) return
    setRetryingId(item.wrong_id)
    try {
      const reviewQuiz = await retryWrongQuestion(item.wrong_id)
      Taro.showToast({ title: '已创建复习闯关', icon: 'none' })
      startPendingQuiz(reviewQuiz.id)
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '创建复习失败，请重试', icon: 'none' })
    } finally {
      setRetryingId('')
    }
  }

  const groups = useMemo(() => groupByKnowledge(list), [list])

  return (
    <View className='screen-shell'>
      {/* 错题宝箱（真实统计） */}
      <View className='treasure-card card'>
        <Text className='treasure-icon'>📕</Text>
        <Text className='treasure-title'>错题本</Text>
        <Text className='treasure-hint'>共 {wrongTotal} 道错题 · {dueTotal} 道当天待复习</Text>
      </View>

      {failed ? (
        <View className='empty-state'>
          <Text className='empty-icon'>📡</Text>
          <Text className='empty-text'>加载失败</Text>
          <Text className='empty-hint'>请检查网络后重试</Text>
          <Button className='retry-btn' onClick={() => void load(1)}>重新加载</Button>
        </View>
      ) : empty ? (
        <View className='empty-state'>
          <Text className='empty-icon'>🎉</Text>
          <Text className='empty-text'>错题本是空的！</Text>
          <Text className='empty-hint'>太棒了，继续保持！答错的题会自动收录到这里。</Text>
        </View>
      ) : (
        <>
          {groups.map((group) => (
            <View key={group.knowledgePoint} className='kp-group'>
              <Text className='kp-label'>
                📌 {group.knowledgePoint}
                <Text className='kp-count'> · {group.items.length} 题</Text>
              </Text>
              {group.items.map((item) => {
                if (!item.question) return null
                const review = reviewStatusText(item.review_at)
                return (
                  <View
                    key={item.wrong_id}
                    className='q-card card'
                    onClick={() => navigateDetail(item.wrong_id)}
                  >
                    <View className='q-header'>
                      <Text className='q-stem'>{item.question.stem}</Text>
                      <Text className='wrong-badge'>错 {item.wrong_count} 次</Text>
                    </View>
                    <View className='q-options'>
                      {item.question.options.map((opt) => (
                        <View
                          key={opt.key}
                          className={`opt ${item.question!.answer.includes(opt.key) ? 'opt-correct' : ''}`}
                        >
                          <Text className='opt-key'>【{opt.key}】</Text>
                          <Text className='opt-text'>{opt.text}</Text>
                        </View>
                      ))}
                    </View>
                    <View className='q-meta'>
                      <Text className='wrong-date'>最近答错：{formatTime(item.last_wrong_at)}</Text>
                      <Text className={`review-chip ${review.due ? 'due' : ''}`}>{review.text}</Text>
                    </View>
                    <View className='q-actions'>
                      <Button className='detail-btn' onClick={() => navigateDetail(item.wrong_id)}>
                        查看解析
                      </Button>
                      <Button
                        className='retry-btn'
                        loading={retryingId === item.wrong_id}
                        onClick={(event) => void onRetry(item, event)}
                      >
                        重新挑战
                      </Button>
                    </View>
                  </View>
                )
              })}
            </View>
          ))}
          {hasMore ? (
            <View className='load-more' onClick={onLoadMore}>
              <Text className='load-more-text'>{loading ? '加载中...' : '加载更多'}</Text>
            </View>
          ) : (
            <View className='load-more'>
              <Text className='load-more-text'>已显示全部错题</Text>
            </View>
          )}
        </>
      )}
    </View>
  )
}
