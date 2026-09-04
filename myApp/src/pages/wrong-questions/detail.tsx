import { Button, Text, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useEffect, useState } from 'react'
import {
  getWrongQuestionDetail,
  retryWrongQuestion,
  startPendingQuiz,
  type WrongQuestionDetail
} from '../../services/api'
import { difficultyText, formatDate, reviewStatusText } from '../../utils/format'
import './detail.scss'

export default function WrongQuestionDetailPage() {
  const router = useRouter()
  const wrongId = router.params.id ?? ''
  const [data, setData] = useState<WrongQuestionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const load = () => {
    if (!wrongId) return
    setLoading(true)
    setFailed(false)
    getWrongQuestionDetail(wrongId)
      .then(setData)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrongId])

  const onRetry = async () => {
    if (retrying || !data) return
    setRetrying(true)
    try {
      const reviewQuiz = await retryWrongQuestion(data.wrong_id)
      Taro.showToast({ title: '已创建复习闯关', icon: 'none' })
      startPendingQuiz(reviewQuiz.id)
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '创建复习失败，请重试', icon: 'none' })
      setRetrying(false)
    }
  }

  if (loading) {
    return (
      <View className='screen-shell'>
        <Text className='loading-text'>加载中...</Text>
      </View>
    )
  }

  if (failed || !data || !data.question) {
    return (
      <View className='screen-shell'>
        <View className='error-box'>
          <Text className='loading-text'>错题不存在或已掌握</Text>
          <Button className='back-btn' onClick={() => Taro.navigateBack()}>返回错题本</Button>
        </View>
      </View>
    )
  }

  const { question, user_answer } = data
  const review = reviewStatusText(data.review_at)
  const typeText = question.type === 'multiple' ? '多选题' : question.type === 'judge' ? '判断题' : '单选题'

  return (
    <View className='screen-shell'>
      {/* 题目 */}
      <View className='q-card card'>
        <View className='q-head'>
          <View className='q-tags'>
            <Text className='tag'>{typeText}</Text>
            <Text className='tag'>{difficultyText(question.difficulty)}</Text>
          </View>
          <Text className='wrong-badge'>错 {data.wrong_count} 次</Text>
        </View>
        <Text className='q-stem'>{question.stem}</Text>
        <Text className='q-kp'>知识点：{question.knowledge_point}</Text>

        <View className='q-options'>
          {question.options.map((opt) => {
            const isCorrectOpt = question.answer.includes(opt.key)
            const isMyPick = user_answer.includes(opt.key)
            let cls = 'opt'
            if (isCorrectOpt) cls += ' opt-correct'
            else if (isMyPick) cls += ' opt-wrong'
            return (
              <View key={opt.key} className={cls}>
                <Text className='opt-key'>【{opt.key}】</Text>
                <Text className='opt-text'>{opt.text}</Text>
                {isCorrectOpt && <Text className='opt-mark'>✓</Text>}
                {!isCorrectOpt && isMyPick && <Text className='opt-mark'>✕</Text>}
              </View>
            )
          })}
        </View>

        <View className='answer-row'>
          <Text className='answer-label'>你的答案：</Text>
          <Text className='answer-val wrong'>{user_answer.length ? user_answer.join('、').toUpperCase() : '未作答'}</Text>
          <Text className='answer-label'>正确答案：</Text>
          <Text className='answer-val right'>{question.answer.join('、').toUpperCase()}</Text>
        </View>

        {question.explanation && (
          <View className='explain-card'>
            <Text className='explain-label'>💡 解析：</Text>
            <Text className='explain-text'>{question.explanation}</Text>
          </View>
        )}
      </View>

      {/* 复习状态 */}
      <View className='review-card card'>
        <View className='review-row'>
          <Text className='review-label'>最近答错</Text>
          <Text className='review-value'>{formatDate(data.last_wrong_at)}</Text>
        </View>
        <View className='review-row'>
          <Text className='review-label'>累计答错</Text>
          <Text className='review-value'>{data.wrong_count} 次</Text>
        </View>
        <View className='review-row'>
          <Text className='review-label'>复习建议</Text>
          <Text className={`review-value ${review.due ? 'due' : ''}`}>{review.text}</Text>
        </View>
      </View>

      <View className='notice'>
        <Text className='notice-text'>重新挑战后，若答对将自动移出错题本；答错会更新复习时间。</Text>
      </View>

      <Button className='challenge-btn' loading={retrying} onClick={() => void onRetry()}>
        重新挑战这题
      </Button>
      <Button className='back-btn ghost' onClick={() => Taro.navigateBack()}>返回错题本</Button>
    </View>
  )
}
