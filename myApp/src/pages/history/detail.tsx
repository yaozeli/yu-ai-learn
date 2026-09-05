import { Button, Text, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useEffect, useState } from 'react'
import {
  fetchQuizReport,
  getQuizDetail,
  startPendingQuiz,
  type QuizApiQuestion,
  type QuizAnswerRecord,
  type QuizDetailResponse,
  type ReportData
} from '../../services/api'
import { difficultyText, formatDate, formatMs, formatTime } from '../../utils/format'
import './detail.scss'

export default function HistoryDetail() {
  const router = useRouter()
  const quizId = router.params.id ?? ''
  const [data, setData] = useState<QuizDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [reportLoading, setReportLoading] = useState(false)

  const load = () => {
    if (!quizId) return
    setLoading(true)
    setFailed(false)
    getQuizDetail(quizId)
      .then(setData)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId])

  const generateReport = async () => {
    if (!quizId || reportLoading) return
    setReportLoading(true)
    try {
      const report = await fetchQuizReport(quizId)
      setData((prev) => (prev ? { ...prev, report } : prev))
      Taro.showToast({ title: '报告生成成功', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '生成失败，请重试', icon: 'none' })
    } finally {
      setReportLoading(false)
    }
  }

  const goPoster = () => {
    if (!quizId) return
    Taro.navigateTo({ url: `/pages/poster/index?quizId=${quizId}` })
  }

  const answerByQuestion = (questions: QuizApiQuestion[], answers: QuizAnswerRecord[]) => {
    const map: Record<string, QuizAnswerRecord> = {}
    for (const record of answers) {
      map[record.question_id] = record
    }
    return questions.map((q) => ({ question: q, record: map[q.id] || null }))
  }

  const renderQuestion = (q: QuizApiQuestion, record: QuizAnswerRecord | null, index: number) => {
    const answered = Boolean(record)
    const completed = data?.status === 'completed'
    const showResult = completed && answered

    return (
      <View key={q.id} className='q-card card'>
        <View className='q-header'>
          <Text className='q-num'>第 {index + 1} 题</Text>
          <View className='q-tags'>
            <Text className='diff-tag diff-plain'>{difficultyText(q.difficulty)}</Text>
            {!answered && <Text className='diff-tag undone-tag'>未作答</Text>}
            {showResult && (
              <Text className={`diff-tag ${record!.is_correct ? 'ok-tag' : 'err-tag'}`}>
                {record!.is_correct ? '✓ 答对' : '✕ 答错'}
              </Text>
            )}
          </View>
        </View>
        <Text className='q-stem'>{q.stem}</Text>
        <Text className='q-kp'>知识点：{q.knowledge_point}</Text>

        <View className='q-options'>
          {q.options.map((opt) => {
            const isCorrectOpt = q.answer.includes(opt.key)
            const isMyPick = record?.selected_answers.includes(opt.key)
            let cls = 'opt'
            if (showResult && isCorrectOpt) cls += ' opt-correct'
            if (showResult && isMyPick && !isCorrectOpt) cls += ' opt-wrong'
            if (completed && isMyPick) cls += ' opt-picked'
            return (
              <View key={opt.key} className={cls}>
                <Text className='opt-key'>【{opt.key}】</Text>
                <Text className='opt-text'>{opt.text}</Text>
                {showResult && isCorrectOpt && <Text className='opt-mark'>✓</Text>}
                {showResult && isMyPick && !isCorrectOpt && <Text className='opt-mark'>✕</Text>}
              </View>
            )
          })}
        </View>

        {showResult && record && (
          <>
            <View className='q-answer'>
              <Text className='q-answer-label'>你的答案：</Text>
              <Text className='q-answer-val'>
                {record.selected_answers.length ? record.selected_answers.join('、').toUpperCase() : '未作答'}
              </Text>
              <Text className='q-answer-label'>正确答案：</Text>
              <Text className='q-answer-val'>{q.answer.join('、').toUpperCase()}</Text>
            </View>
            {q.explanation && (
              <View className='q-explain'>
                <Text className='q-explain-label'>💡 解析：</Text>
                <Text className='q-explain-text'>{q.explanation}</Text>
              </View>
            )}
          </>
        )}
      </View>
    )
  }

  const renderReportSection = () => {
    const report: ReportData | null = data?.report && data.report.status === 'completed' ? data.report : null
    const failedReport = data?.report?.status === 'failed'
    const needGenerate = data && data.status === 'completed' && !report && !data.report

    return (
      <>
        {needGenerate && (
          <View className='report-cta card'>
            <Text className='report-cta-title'>📊 复盘报告</Text>
            <Text className='report-cta-text'>本关报告尚未生成，AI 将根据答题记录为你生成掌握度与复习建议。</Text>
            <Button className='gen-btn' loading={reportLoading} onClick={() => void generateReport()}>
              生成复盘报告
            </Button>
          </View>
        )}

        {failedReport && (
          <View className='report-cta card'>
            <Text className='report-cta-title'>📊 复盘报告</Text>
            <Text className='report-cta-text err-text'>上次生成失败，可重新尝试。</Text>
            <Button className='gen-btn' loading={reportLoading} onClick={() => void generateReport()}>
              重新生成报告
            </Button>
          </View>
        )}

        {report && (
          <View className='report card'>
            <View className='report-head-row'>
              <Text className='report-title'>📊 复盘报告</Text>
              <Text className='report-time'>生成于 {formatDate(report.updated_at)}</Text>
            </View>
            <View className='report-accuracy'>
              <Text className='report-acc-num'>{Math.round(report.accuracy)}%</Text>
              <Text className='report-acc-label'>正确率</Text>
            </View>

            <View className='report-sec'>
              <Text className='report-sec-title'>✅ 掌握较好</Text>
              {report.mastered_points.length ? (
                report.mastered_points.map((point) => (
                  <Text key={point} className='report-line'>• {point}</Text>
                ))
              ) : (
                <Text className='report-line muted'>暂无</Text>
              )}
            </View>

            <View className='report-sec'>
              <Text className='report-sec-title'>⚠️ 薄弱知识点</Text>
              {report.weak_points.length ? (
                report.weak_points.map((point) => (
                  <Text key={point} className='report-line'>• {point}</Text>
                ))
              ) : (
                <Text className='report-line muted'>表现很好，暂无薄弱点</Text>
              )}
            </View>

            <View className='report-sec'>
              <Text className='report-sec-title'>📝 三句知识总结</Text>
              {report.three_line_summary.map((line, i) => (
                <Text key={`${i}-${line}`} className='report-line'>{i + 1}. {line}</Text>
              ))}
            </View>

            <View className='report-sec'>
              <Text className='report-sec-title'>💡 复习建议</Text>
              {report.advice.map((line, i) => (
                <Text key={`${i}-${line}`} className='report-line'>• {line}</Text>
              ))}
            </View>

            {report.share_quote && (
              <View className='report-quote'>「{report.share_quote}」</View>
            )}

            <Button className='share-poster-btn' onClick={goPoster}>🖼 生成分享海报</Button>

            <Button className='regenerate-btn' loading={reportLoading} onClick={() => void generateReport()}>
              重新生成报告
            </Button>
          </View>
        )}
      </>
    )
  }

  if (loading) {
    return (
      <View className='screen-shell'>
        <Text className='loading-text'>加载中...</Text>
      </View>
    )
  }

  if (failed || !data) {
    return (
      <View className='screen-shell'>
        <View className='error-box'>
          <Text className='loading-text'>记录加载失败</Text>
          <Button className='retry-btn' onClick={load}>重新加载</Button>
        </View>
      </View>
    )
  }

  const completed = data.status === 'completed'
  const item = answerByQuestion(data.questions, data.answers)

  return (
    <View className='screen-shell'>
      {/* 头部摘要 */}
      <View className='header card'>
        <View className='header-top'>
          <Text className={`header-status ${completed ? 'done' : 'running'}`}>
            {completed ? '已完成' : '未完成'}
            {data.review ? ' · 错题重温' : ''}
          </Text>
          <Text className='header-time'>{formatTime(data.created_at)}</Text>
        </View>
        <Text className='header-topic'>{data.topic}</Text>
        <Text className='header-title'>{data.title}</Text>
        <View className='header-stats'>
          <View className='stat'>
            <Text className='stat-num'>{completed ? `${Math.round(data.accuracy)}%` : `${data.answers.length}/${data.question_count}`}</Text>
            <Text className='stat-label'>{completed ? '正确率' : '已答题数'}</Text>
          </View>
          <View className='stat'>
            <Text className='stat-num'>{completed ? `${data.correct_count}/${data.question_count}` : data.question_count}</Text>
            <Text className='stat-label'>正确题数 / 总题数</Text>
          </View>
          <View className='stat'>
            <Text className='stat-num'>{formatMs(data.total_duration_ms)}</Text>
            <Text className='stat-label'>用时</Text>
          </View>
        </View>
        {completed && data.summary && (
          <View className='header-summary'>
            <Text className='summary-label'>AI 点评：</Text>
            <Text className='summary-text'>{data.summary}</Text>
          </View>
        )}
        {!completed && (
          <Button className='continue-btn' onClick={() => startPendingQuiz(data.id)}>
            继续闯关 ›
          </Button>
        )}
      </View>

      {/* 题目列表 */}
      <Text className='section-label'>答题情况</Text>
      <View className='questions'>
        {item.map(({ question, record }, index) => renderQuestion(question, record, index))}
      </View>

      {completed && renderReportSection()}
    </View>
  )
}
