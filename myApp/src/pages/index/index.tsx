import { Button, Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import {
  PENDING_QUIZ_KEY,
  completeQuiz,
  ensureLogin,
  fetchQuizReport,
  generateQuiz,
  getHotTopics,
  getQuizDetail,
  getQuizInProgress,
  getUserOverview,
  submitQuizAnswer,
  type AnswerFeedback,
  type CompleteResult,
  type HotTopicItem,
  type InProgressItem,
  type QuizApiQuestion,
  type QuizApiResponse,
  type ReportData,
  type UserOverview,
  type UserProfile
} from '../../services/api'
import { difficultyText, formatMs } from '../../utils/format'
import './index.scss'

type QuestionType = 'single' | 'multiple' | 'judge'
type Screen = 'home' | 'loading' | 'quiz' | 'result' | 'report'

const demoTopics = ['什么是 RAG', '快速排序', '光合作用']

interface LocalAnswer {
  question_id: string
  selected_answers: string[]
  is_correct: boolean
}

const questionTypeText: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题'
}

export default function Index() {
  const [screen, setScreen] = useState<Screen>('home')
  const [loadingStep, setLoadingStep] = useState(1)

  // quiz payload state
  const [quizId, setQuizId] = useState('')
  const [quizTitle, setQuizTitle] = useState('')
  const [quizTopic, setQuizTopic] = useState('')
  const [questions, setQuestions] = useState<QuizApiQuestion[]>([])
  const [current, setCurrent] = useState(0)
  const [isReview, setIsReview] = useState(false)

  // answering state
  const [selected, setSelected] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null)
  const [answers, setAnswers] = useState<LocalAnswer[]>([])
  const questionStartedAt = useRef<Record<string, number>>({})

  // result / report state
  const [result, setResult] = useState<CompleteResult | null>(null)
  const [completing, setCompleting] = useState(false)
  const [report, setReport] = useState<ReportData | null>(null)
  const [reportLoading, setReportLoading] = useState(false)

  // home state (all real data)
  const [user, setUser] = useState<UserProfile | null>(null)
  const [overview, setOverview] = useState<UserOverview | null>(null)
  const [inProgress, setInProgress] = useState<InProgressItem[]>([])
  const [hotTopics, setHotTopics] = useState<HotTopicItem[] | null>(null)
  const [topicInput, setTopicInput] = useState('')
  const [generating, setGenerating] = useState(false)

  const currentQuestion = questions[current]

  const markStarted = (questionId: string) => {
    if (!questionStartedAt.current[questionId]) {
      questionStartedAt.current[questionId] = Date.now()
    }
  }

  // ---------- loading animation ----------
  useEffect(() => {
    if (screen !== 'loading') return undefined
    const step2 = setTimeout(() => setLoadingStep(2), 700)
    const step3 = setTimeout(() => setLoadingStep(3), 1500)
    return () => {
      clearTimeout(step2)
      clearTimeout(step3)
    }
  }, [screen])

  // ---------- home data ----------
  const refreshHome = () => {
    ensureLogin()
      .then(setUser)
      .catch(() => setUser(null))
    getQuizInProgress()
      .then((data) => setInProgress(data.items || []))
      .catch(() => undefined)
    getUserOverview()
      .then(setOverview)
      .catch(() => undefined)
    getHotTopics()
      .then((data) => setHotTopics(data.items || []))
      .catch(() => setHotTopics([]))
  }

  useDidShow(() => {
    const pending = Taro.getStorageSync<string>(PENDING_QUIZ_KEY)
    if (pending) {
      Taro.removeStorageSync(PENDING_QUIZ_KEY)
      void resumeQuiz(pending)
      return
    }
    refreshHome()
  })

  // ---------- navigation helpers ----------
  const goHomeTab = () => {
    Taro.switchTab({ url: '/pages/history/index' })
  }

  const reset = () => {
    setScreen('home')
    setQuizId('')
    setQuizTitle('')
    setQuizTopic('')
    setQuestions([])
    setCurrent(0)
    setIsReview(false)
    setSelected([])
    setSubmitted(false)
    setFeedback(null)
    setAnswers([])
    setResult(null)
    setReport(null)
    setReportLoading(false)
    setLoadingStep(1)
    setTopicInput('')
    refreshHome()
  }

  // ---------- start / resume ----------
  const startTopic = async (topic: string) => {
    if (!topic.trim() || generating) return
    setTopicInput(topic.trim())
    setScreen('loading')
    setLoadingStep(1)
    setGenerating(true)
    try {
      const user = await ensureLogin()
      setUser(user)
      const [quiz] = await Promise.all([
        generateQuiz(topic.trim()),
        new Promise((resolve) => setTimeout(resolve, 1800))
      ])
      applyGeneratedQuiz(quiz)
    } catch (error) {
      setScreen('home')
      Taro.showToast({ title: error instanceof Error ? error.message : '题目生成失败，请重试', icon: 'none' })
    } finally {
      setGenerating(false)
    }
  }

  const applyGeneratedQuiz = (quiz: QuizApiResponse) => {
    setQuizId(quiz.quiz_id)
    setQuizTitle(quiz.title)
    setQuizTopic(quiz.user_input || quiz.title)
    setQuestions(quiz.questions)
    setIsReview(false)
    setAnswers([])
    setReport(null)
    setResult(null)
    setCurrent(0)
    setSelected([])
    setSubmitted(false)
    setFeedback(null)
    setLoadingStep(3)
    questionStartedAt.current = {}
    if (quiz.questions[0]) markStarted(quiz.questions[0].id)
    setTimeout(() => setScreen('quiz'), 300)
  }

  const resumeQuiz = async (quizId: string) => {
    try {
      const detail = await getQuizDetail(quizId)
      if (detail.status === 'completed') {
        Taro.showToast({ title: '该闯关已完成，可在历史记录中查看', icon: 'none' })
        return
      }
      const answered = new Set(detail.answers.map((a) => a.question_id))
      const firstUnanswered = detail.questions.findIndex((q) => !answered.has(q.id))
      const startAt = detail.questions.length > 0 ? (firstUnanswered >= 0 ? firstUnanswered : 0) : 0
      setQuizId(detail.id)
      setQuizTitle(detail.title)
      setQuizTopic(detail.topic)
      setQuestions(detail.questions)
      setIsReview(detail.review)
      setAnswers(
        detail.answers.map((a) => ({
          question_id: a.question_id,
          selected_answers: a.selected_answers,
          is_correct: a.is_correct
        }))
      )
      setCurrent(startAt)
      setSelected([])
      setSubmitted(false)
      setFeedback(null)
      setResult(null)
      setReport(detail.report && detail.report.status === 'completed' ? detail.report : null)
      questionStartedAt.current = {}
      if (detail.questions[startAt]) markStarted(detail.questions[startAt].id)
      setScreen('quiz')
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '恢复闯关失败', icon: 'none' })
    }
  }

  const continueLatest = () => {
    const latest = inProgress[0]
    if (!latest) {
      Taro.showToast({ title: '没有进行中的闯关', icon: 'none' })
      return
    }
    void resumeQuiz(latest.id)
  }

  // ---------- answering ----------
  const answerCount = (questionId: string) => answers.find((a) => a.question_id === questionId)

  const toggleOption = (key: string) => {
    if (submitted || submitting || !currentQuestion) return
    if (currentQuestion.type === 'single' || currentQuestion.type === 'judge') {
      setSelected([key])
      return
    }
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    )
  }

  const onSubmitAnswer = async () => {
    if (!selected.length || !quizId || !currentQuestion || submitting) return
    const durationMs = Math.max(
      0,
      Math.floor(Date.now() - (questionStartedAt.current[currentQuestion.id] || Date.now()))
    )
    setSubmitting(true)
    try {
      const fb = await submitQuizAnswer(quizId, currentQuestion.id, selected, durationMs)
      setAnswers((prev) => [
        ...prev.filter((a) => a.question_id !== currentQuestion.id),
        { question_id: currentQuestion.id, selected_answers: selected, is_correct: fb.is_correct }
      ])
      setFeedback(fb)
      setSubmitted(true)
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '提交失败，请重试', icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }

  const nextQuestion = async () => {
    if (!quizId) return
    if (current >= questions.length - 1) {
      setCompleting(true)
      try {
        const res = await completeQuiz(quizId)
        setResult(res)
        setScreen('result')
      } catch (error) {
        Taro.showToast({ title: error instanceof Error ? error.message : '结算失败，请重试', icon: 'none' })
      } finally {
        setCompleting(false)
      }
      return
    }
    const nextIndex = current + 1
    const nextQuestion = questions[nextIndex]
    if (nextQuestion) markStarted(nextQuestion.id)
    setCurrent(nextIndex)
    setSelected([])
    setSubmitted(false)
    setFeedback(null)
  }

  const openReport = async () => {
    if (!quizId || reportLoading) return
    setReportLoading(true)
    try {
      const data = await fetchQuizReport(quizId)
      setReport(data)
      setScreen('report')
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '报告生成失败，请稍后重试', icon: 'none' })
    } finally {
      setReportLoading(false)
    }
  }

  const renderOptionState = (key: string) => {
    const isSelected = selected.includes(key)
    let className = 'option'
    if (isSelected && !submitted) className += ' sel'
    if (submitted) {
      if (feedback && feedback.correct_answers.includes(key)) className += ' correct'
      else if (isSelected) className += ' wrong'
    }
    return className
  }

  const renderHome = () => (
    <View className='screen-shell'>
      <View className='home-head'>
        <View className='mascot-wrap'>🐼</View>
        <View className='home-head-text'>
          <Text className='home-title'>阿衰闯关学习</Text>
          <Text className='home-sub'>{user?.nickname ? `Hi，${user.nickname}，今天想闯哪一关？` : '万物皆可闯关'}</Text>
        </View>
      </View>

      {inProgress.length > 0 && (
        <View className='card continue-card'>
          <View className='continue-head'>
            <Text className='continue-title'>🎯 有未完成的闯关</Text>
            <Text className='continue-go' onClick={continueLatest}>继续闯关 ›</Text>
          </View>
          <Text className='continue-sub'>{inProgress[0].title || inProgress[0].topic}</Text>
          <View className='continue-progress'>
            <View
              className='continue-fill'
              style={`width:${Math.min(100, Math.round((inProgress[0].answered_count / Math.max(1, inProgress[0].question_count)) * 100))}%`}
            />
          </View>
          <Text className='continue-meta'>已答 {inProgress[0].answered_count}/{inProgress[0].question_count} 题</Text>
        </View>
      )}

      <View className='card input-card'>
        <Text className='input-label'>想学点什么？输入一句话，AI 帮你出题</Text>
        <Input
          className='input-box'
          value={topicInput}
          placeholder='例如：什么是 RAG？它和传统搜索有什么区别…'
          onInput={(event) => setTopicInput(event.detail.value)}
        />
        <View className='chips'>
          {demoTopics.map((topic) => (
            <View key={topic} className='chip' onClick={() => setTopicInput(topic)}>
              {topic}
            </View>
          ))}
        </View>
      </View>

      {hotTopics !== null && (
        <View className='card hot-card'>
          <View className='hot-head'>
            <Text className='hot-title'>🔥 大家都在问</Text>
            <Text className='hot-sub'>按真实闯关次数统计</Text>
          </View>
          {hotTopics.length === 0 ? (
            <Text className='hot-empty'>
              还没有热门话题——完成一次闯关后，这里会统计大家真实在学的内容。
            </Text>
          ) : (
            hotTopics.map((item, index) => (
              <View
                key={`${item.topic}-${index}`}
                className='hot-row'
                onClick={() => void startTopic(item.topic)}
              >
                <Text className={`hot-rank ${index < 3 ? `rank-${index + 1}` : ''}`}>
                  {index < 3 ? ['🥇', '🥈', '🥉'][index] : index + 1}
                </Text>
                <Text className='hot-topic'>{item.topic}</Text>
                <Text className='hot-count'>{item.run_count} 次闯关</Text>
                <Text className='hot-go'>去闯关 ›</Text>
              </View>
            ))
          )}
        </View>
      )}

      <Button
        className={`btn btn-yellow start-btn ${topicInput.trim() && !generating ? '' : 'btn-disabled'}`}
        disabled={!topicInput.trim() || generating}
        onClick={() => void startTopic(topicInput.trim())}
      >
        {generating ? '生成中…' : '开始闯关'}
      </Button>
      <Text className='tip'>AI 生成 5 道闯关题，每答一题都会实时判定并生成讲解</Text>

      {overview && (
        <View className='stats-strip'>
          <View className='strip-item' onClick={() => Taro.switchTab({ url: '/pages/history/index' })}>
            <Text className='strip-num'>{overview.history_total}</Text>
            <Text className='strip-label'>累计闯关</Text>
          </View>
          <View className='strip-divider' />
          <View className='strip-item' onClick={() => Taro.switchTab({ url: '/pages/wrong-questions/index' })}>
            <Text className='strip-num'>{overview.wrong_total}</Text>
            <Text className='strip-label'>错题</Text>
          </View>
          <View className='strip-divider' />
          <View className='strip-item' onClick={() => Taro.switchTab({ url: '/pages/wrong-questions/index' })}>
            <Text className='strip-num'>{overview.due_review_total}</Text>
            <Text className='strip-label'>当天待复习</Text>
          </View>
        </View>
      )}
    </View>
  )

  const renderLoading = () => (
    <View className='loading-screen'>
      <View className='loading-mascot'>🤖</View>
      <Text className='loading-title'>阿衰正在把知识变成关卡…</Text>
      <View className='loading-steps'>
        <View className={`step ${loadingStep >= 1 ? 'done' : ''}`}>
          <Text className='step-num'>✓</Text>
          <Text>理解你的学习主题</Text>
        </View>
        <View className={`step ${loadingStep >= 2 ? 'done' : 'active'}`}>
          <Text className='step-num'>{loadingStep >= 2 ? '✓' : '2'}</Text>
          <Text>AI 生成闯关题目</Text>
        </View>
        <View className={`step ${loadingStep >= 3 ? 'done' : ''}`}>
          <Text className='step-num'>{loadingStep >= 3 ? '✓' : '3'}</Text>
          <Text>生成知识讲解</Text>
        </View>
      </View>
      <View className='loading-bar'>
        <View className='loading-fill' />
      </View>
      <Button className='btn btn-ghost btn-sm cancel-btn' onClick={reset}>取消</Button>
    </View>
  )

  const renderQuiz = () => {
    if (!currentQuestion) return null
    return (
      <View className='screen-shell'>
        <View className='quiz-top'>
          <View className='quiz-top-left'>
            <Text className='quiz-progress'>
              <Text className='strong'>{current + 1}</Text>/{questions.length}
            </Text>
            <Text className='quiz-title'>{quizTitle || quizTopic}</Text>
          </View>
          <Button className='btn btn-ghost btn-sm quiz-exit' onClick={reset}>退出</Button>
        </View>

        <View className='progress-dots'>
          {questions.map((q, index) => {
            const ans = answerCount(q.id)
            const state = ans
              ? ans.is_correct
                ? 'done'
                : 'wrong'
              : index === current
                ? 'on'
                : ''
            return <View key={q.id} className={`pdot ${state}`} />
          })}
        </View>

        <View className='card quiz-card'>
          <View className='quiz-tags'>
            <Text className='tag tag-type'>{questionTypeText[currentQuestion.type]}</Text>
            <Text className='tag tag-diff'>{difficultyText(currentQuestion.difficulty)}</Text>
            {isReview && <Text className='tag tag-review'>错题重温</Text>}
          </View>
          <Text className='quiz-stem'>{currentQuestion.stem}</Text>
          {!submitted && currentQuestion.type === 'multiple' && selected.length === 0 && (
            <Text className='quiz-hint'>可多选，请选择所有正确答案</Text>
          )}
          <View className='options'>
            {currentQuestion.options.map((option) => {
              const classState = renderOptionState(option.key)
              const isSelected = selected.includes(option.key)
              const isRight = submitted && feedback && feedback.correct_answers.includes(option.key)
              return (
                <View
                  key={option.key}
                  className={classState}
                  onClick={() => toggleOption(option.key)}
                >
                  <Text className='key'>{option.key}</Text>
                  <Text className='opt-text'>{option.text}</Text>
                  {isSelected && !submitted && <Text className='mark'>✓</Text>}
                  {submitted && isRight && <Text className='mark'>✓</Text>}
                  {submitted && isSelected && feedback && !feedback.correct_answers.includes(option.key) && (
                    <Text className='mark'>✕</Text>
                  )}
                </View>
              )
            })}
          </View>
        </View>

        {submitted && feedback && (
          <View className='card explain-card'>
            <Text className={`explain-head ${feedback.is_correct ? 'ok' : 'err'}`}>
              {feedback.is_correct
                ? '✅ 答对啦！'
                : `❌ 答错了 · 正确答案是 ${feedback.correct_answers.join('、')}`}
            </Text>
            <Text className='explain-body'>{feedback.explanation}</Text>
          </View>
        )}

        <View className='quiz-btn'>
          {!submitted ? (
            <Button
              className={`btn btn-yellow ${selected.length ? '' : 'btn-disabled'}`}
              disabled={!selected.length || submitting}
              onClick={() => void onSubmitAnswer()}
            >
              {submitting ? '提交中…' : '提交答案'}
            </Button>
          ) : (
            <Button className='btn btn-green' disabled={completing} onClick={() => void nextQuestion()}>
              {completing ? '结算中…' : current === questions.length - 1 ? '查看结算' : '下一题'}
            </Button>
          )}
        </View>
      </View>
    )
  }

  const renderResult = () => {
    if (!result) return null
    return (
      <View className='screen-shell win-screen'>
        <View className='win-mascot'>🎉</View>
        <Text className='win-title'>通关啦！</Text>
        <Text className='win-sub'>{quizTopic} · {questions.length} 题全部完成</Text>

        <View className='win-stats'>
          <View className='stat'>
            <Text className='stat-num'>{result.correct_count}/{result.question_count}</Text>
            <Text className='stat-label'>答对题数</Text>
          </View>
          <View className='stat'>
            <Text className='stat-num'>{Math.round(result.accuracy)}%</Text>
            <Text className='stat-label'>正确率</Text>
          </View>
          <View className='stat'>
            <Text className='stat-num'>{formatMs(result.total_duration_ms)}</Text>
            <Text className='stat-label'>用时</Text>
          </View>
        </View>

        {result.accuracy >= 80 && (
          <View className='win-praise'>掌握得不错！错题已自动收录到错题本，建议按提示时间复习。</View>
        )}

        <Button className='btn btn-yellow win-btn' loading={reportLoading} onClick={() => void openReport()}>
          {report ? '重新生成复盘报告' : '查看复盘报告'}
        </Button>
        <Button className='btn btn-ghost btn-sm win-ghost' onClick={reset}>再闯一关</Button>
        <Text className='tip'>复盘报告由 AI 根据答题记录生成</Text>
      </View>
    )
  }

  const renderReport = () => {
    const accuracy = report ? Math.round(report.accuracy) : result ? Math.round(result.accuracy) : 0
    const failed = report?.status === 'failed'
    return (
      <View className='screen-shell'>
        <Text className='report-head'>复盘报告</Text>
        <Text className='report-sub'>本次闯关 · {quizTopic}</Text>

        <View className='card ring-card'>
          <View className='ring' style={`--p:${accuracy}`}>
            <View className='ring-in'>
              <Text className='ring-num'>{accuracy}%</Text>
              <Text className='ring-label'>正确率</Text>
            </View>
          </View>
          <Text className='ring-desc'>掌握度评估 · 报告由 AI 根据你的答题记录生成</Text>
        </View>

        {failed && (
          <View className='report-error'>
            <Text className='report-error-text'>上次报告生成失败，请重试</Text>
            <Button className='btn btn-yellow btn-sm' onClick={() => void openReport()}>重新生成</Button>
          </View>
        )}

        {report && !failed && (
          <>
            <View className='card sec-card'>
              <Text className='sec-title'>✅ 掌握较好</Text>
              <View className='point-list'>
                {report.mastered_points.length ? (
                  report.mastered_points.map((point) => (
                    <Text key={point} className='point'>• {point}</Text>
                  ))
                ) : (
                  <Text className='point-empty'>暂无</Text>
                )}
              </View>
            </View>

            <View className='card sec-card'>
              <Text className='sec-title'>⚠️ 薄弱知识点</Text>
              <View className='point-list'>
                {report.weak_points.length ? (
                  report.weak_points.map((point) => (
                    <Text key={point} className='point'>• {point}</Text>
                  ))
                ) : (
                  <Text className='point-empty'>表现很好，暂无薄弱点</Text>
                )}
              </View>
            </View>

            <View className='card sec-card'>
              <Text className='sec-title'>📝 三句知识总结</Text>
              {report.three_line_summary.map((line, index) => (
                <Text key={`${index}-${line}`} className='summary-line'>{index + 1}. {line}</Text>
              ))}
            </View>

            <View className='card sec-card'>
              <Text className='sec-title'>💡 复习建议</Text>
              {report.advice.map((line, index) => (
                <Text key={`${index}-${line}`} className='summary-line'>• {line}</Text>
              ))}
            </View>

            {report.share_quote && (
              <View className='quote-card'>
                <Text className='quote-text'>「{report.share_quote}」</Text>
              </View>
            )}
          </>
        )}

        <Button className='btn btn-yellow report-btn' onClick={() => void openReport()}>
          {reportLoading ? '生成中…' : '重新生成报告'}
        </Button>
        <Button className='btn btn-ghost btn-sm report-ghost' onClick={goHomeTab}>查看历史记录</Button>
        <Button className='btn btn-home' onClick={reset}>🏠 返回首页</Button>
      </View>
    )
  }

  return (
    <View className='index-page'>
      {screen === 'home' && renderHome()}
      {screen === 'loading' && renderLoading()}
      {screen === 'quiz' && renderQuiz()}
      {screen === 'result' && renderResult()}
      {screen === 'report' && renderReport()}
    </View>
  )
}
