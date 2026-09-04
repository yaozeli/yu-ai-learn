import { Button, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import {
  getQuizHistory,
  startPendingQuiz,
  type QuizSummary
} from '../../services/api'
import { formatMs, formatTime } from '../../utils/format'
import './index.scss'

export default function History() {
  const [list, setList] = useState<QuizSummary[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [empty, setEmpty] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = async (p = 1) => {
    setLoading(true)
    setFailed(false)
    try {
      const res = await getQuizHistory(p, 10)
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

  useDidShow(() => {
    void load(1)
  })

  const onLoadMore = () => {
    if (!loading && hasMore) void load(page + 1)
  }

  const navigateDetail = (id: string) => {
    Taro.navigateTo({ url: `/pages/history/detail?id=${id}` })
  }

  const renderStatus = (item: QuizSummary) => {
    if (item.status === 'in_progress') {
      return <Text className='status-chip status-running'>未完成</Text>
    }
    return <Text className='status-chip status-done'>已完成</Text>
  }

  return (
    <View className='screen-shell'>
      <View className='page-head'>
        <Text className='page-title'>闯关历史</Text>
        <Text className='page-sub'>学习足迹都保存在这里</Text>
      </View>

      {failed ? (
        <View className='error-state'>
          <Text className='empty-icon'>📡</Text>
          <Text className='empty-text'>加载失败</Text>
          <Text className='empty-hint'>请检查网络后重试</Text>
          <Button className='retry-btn' onClick={() => void load(1)}>重新加载</Button>
        </View>
      ) : empty ? (
        <View className='empty-state'>
          <Text className='empty-icon'>📝</Text>
          <Text className='empty-text'>还没有闯关记录</Text>
          <Text className='empty-hint'>去首页输入主题，开始你的第一关吧！</Text>
        </View>
      ) : (
        <>
          <View className='list'>
            {list.map((item) => (
              <View key={item.id} className='item card' onClick={() => navigateDetail(item.id)}>
                <View className='item-top'>
                  <Text className='item-title'>{item.title || item.topic}</Text>
                  {renderStatus(item)}
                </View>
                {item.status === 'completed' ? (
                  <View className='item-score-row'>
                    <Text className='item-score'>{Math.round(item.accuracy)}%</Text>
                    <Text className='item-score-label'>正确率</Text>
                  </View>
                ) : null}
                <View className='item-meta'>
                  <Text className='item-tag'>
                    {item.status === 'completed'
                      ? `${item.correct_count}/${item.question_count} 题正确`
                      : `${item.question_count} 题 · 进行中`}
                  </Text>
                  <Text className='item-time'>
                    {item.status === 'completed' ? formatMs(item.total_duration_ms) : ''}
                  </Text>
                </View>
                <View className='item-meta'>
                  <Text className='item-time'>{formatTime(item.created_at)}</Text>
                  {item.status === 'in_progress' ? (
                    <Text
                      className='continue-link'
                      onClick={(event) => {
                        event.stopPropagation()
                        startPendingQuiz(item.id)
                      }}
                    >
                      继续闯关 ›
                    </Text>
                  ) : (
                    <Text className='detail-link'>查看详情 ›</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
          {hasMore ? (
            <View className='load-more' onClick={onLoadMore}>
              <Text className='load-more-text'>{loading ? '加载中...' : '加载更多'}</Text>
            </View>
          ) : (
            <View className='load-more'>
              <Text className='load-more-text'>已显示全部记录</Text>
            </View>
          )}
        </>
      )}
    </View>
  )
}
