import { Button, Input, View, Text } from '@tarojs/components'
import Taro, { useLoad } from '@tarojs/taro'
import { useEffect, useMemo, useState } from 'react'
import { generateQuiz, generateReport, type QuizApiResponse, type ReportApiResponse } from '../../services/api'
import './index.scss'

type QuestionType = 'single' | 'multi' | 'judge'

type Question = {
  id: string | number
  type: QuestionType
  difficulty: '简单' | '中等' | '困难'
  title: string
  options: { key: string; label: string }[]
  answer: string[]
  explanation: string
}

type Screen = 'home' | 'loading' | 'quiz' | 'result' | 'report' | 'poster'

const optionKeys = ['A', 'B', 'C', 'D']

const demoTopics = ['什么是 RAG', '快速排序', '光合作用']

export default function Index() {
  const [screen, setScreen] = useState<Screen>('home')
  const [loadingStep, setLoadingStep] = useState(1)
  const [questions, setQuestions] = useState<Question[]>([])
  const [quizPayload, setQuizPayload] = useState<QuizApiResponse | null>(null)
  const [reportData, setReportData] = useState<ReportApiResponse | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [currentTopic, setCurrentTopic] = useState(demoTopics[0])
  const [topicInput, setTopicInput] = useState('')
  const [answers, setAnswers] = useState<Array<{ questionId: string | number; selected: string[]; isCorrect: boolean }>>([])

  useLoad(() => {
    console.log('Page loaded')
  })

  const currentQuestion = questions[currentIndex]

  useEffect(() => {
    if (screen !== 'loading') return undefined

    const secondStepTimer = setTimeout(() => setLoadingStep(2), 700)
    const thirdStepTimer = setTimeout(() => setLoadingStep(3), 1400)

    return () => {
      clearTimeout(secondStepTimer)
      clearTimeout(thirdStepTimer)
    }
  }, [screen])

  const stats = useMemo(() => {
    const total = questions.length
    const correct = answers.filter((item) => item.isCorrect).length
    return {
      total,
      correct,
      percent: Math.round((correct / total) * 100),
      xp: 20 * correct + 30 * Math.max(0, total - correct),
      coins: 10 * correct + 5 * Math.max(0, total - correct)
    }
  }, [answers, questions.length])

  const selectTopic = (topic: string) => {
    setTopicInput(topic)
    setCurrentTopic(topic)
  }

  const startTopic = async (topic: string) => {
    console.log('[quiz] start topic', topic)
    selectTopic(topic)
    setCurrentTopic(topic)
    setScreen('loading')
    setLoadingStep(1)
    setSelectedKeys([])
    setSubmitted(false)
    setCurrentIndex(0)
    setAnswers([])
    setReportData(null)

    try {
      const [quiz] = await Promise.all([
        generateQuiz(topic),
        new Promise((resolve) => setTimeout(resolve, 1800))
      ])
      const normalizedQuestions: Question[] = quiz.questions.map((question) => ({
        id: question.id,
        type: (question.type === 'multiple' ? 'multi' : question.type) as QuestionType,
        difficulty: '简单' as const,
        title: question.stem,
        options: question.options.map((option, index) => ({
          key: option.key || optionKeys[index],
          label: option.text
        })),
        answer: question.answer,
        explanation: question.explanation
      }))

      setQuizPayload(quiz)
      setQuestions(normalizedQuestions)
      setCurrentTopic(quiz.title)
      setLoadingStep(3)
      await new Promise((resolve) => setTimeout(resolve, 350))
      setScreen('quiz')
    } catch (error) {
      setScreen('home')
      Taro.showToast({ title: error instanceof Error ? error.message : '题目生成失败', icon: 'none' })
    }
  }

  const toggleOption = (key: string) => {
    if (submitted) return

    if (currentQuestion.type === 'single') {
      setSelectedKeys([key])
      return
    }

    setSelectedKeys((prev) => {
      if (prev.includes(key)) {
        return prev.filter((item) => item !== key)
      }
      return [...prev, key]
    })
  }

  const submitAnswer = () => {
    if (!selectedKeys.length) return

    const isCorrect =
      currentQuestion.answer.length === selectedKeys.length &&
      currentQuestion.answer.every((item) => selectedKeys.includes(item)) &&
      selectedKeys.every((item) => currentQuestion.answer.includes(item))

    setAnswers((prev) => [...prev, {
      questionId: currentQuestion.id,
      selected: [...selectedKeys],
      isCorrect
    }])
    setSubmitted(true)
  }

  const nextQuestion = () => {
    if (currentIndex >= questions.length - 1) {
      if (quizPayload) {
        generateReport(
          quizPayload,
          answers.map((answer) => ({
            question_id: String(answer.questionId),
            selected_answers: answer.selected,
            is_correct: answer.isCorrect,
            duration_ms: 0
          }))
        )
          .then(setReportData)
          .catch(() => Taro.showToast({ title: '复盘报告生成失败', icon: 'none' }))
      }
      setScreen('result')
      return
    }

    setCurrentIndex((prev) => prev + 1)
    setSelectedKeys([])
    setSubmitted(false)
  }

  const openReport = () => setScreen('report')
  const openPoster = () => setScreen('poster')
  const reset = () => {
    setScreen('home')
    setCurrentIndex(0)
    setSelectedKeys([])
    setSubmitted(false)
    setAnswers([])
    setQuizPayload(null)
    setReportData(null)
    setLoadingStep(1)
    setCurrentTopic(demoTopics[0])
    setTopicInput('')
  }

  const renderOption = (option: { key: string; label: string }) => {
    const isSelected = selectedKeys.includes(option.key)
    const isCorrect = currentQuestion.answer.includes(option.key)
    const answerState = submitted

    let className = 'option'
    if (isSelected && !answerState) className += ' sel'
    if (answerState && isCorrect) className += ' correct'
    if (answerState && isSelected && !isCorrect) className += ' wrong'

    return (
      <View
        key={option.key}
        className={className}
        onClick={() => toggleOption(option.key)}
      >
        <Text className='key'>{option.key}</Text>
        <Text>{option.label}</Text>
        {answerState && isCorrect && <Text className='mark'>✓</Text>}
        {answerState && isSelected && !isCorrect && <Text className='mark'>✕</Text>}
      </View>
    )
  }

  const questionTypeText: Record<QuestionType, string> = {
    single: '单选',
    multi: '多选',
    judge: '判断'
  }

  const renderHome = () => (
    <View className='screen-shell'>
      <View className='home-head'>
        <View className='mascot-wrap'>🐼</View>
        <View>
          <Text className='home-title'>阿衰闯关</Text>
          <Text className='home-sub'>万物皆可闯关</Text>
        </View>
        <View className='streak'>🔥 连续 7 天</View>
      </View>

      <View className='xp-bar'>
        <Text className='xp-label'>经验值</Text>
        <View className='xp-track'>
          <View className='xp-fill' style='width:64%' />
        </View>
        <Text className='xp-num'>1280</Text>
        <Text className='xp-lv'>Lv.5</Text>
      </View>

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
            <View key={topic} className='chip' onClick={() => selectTopic(topic)}>
              {topic}
            </View>
          ))}
        </View>
      </View>

      <View className='card rec-card'>
        <View className='rec-head'>
          <Text>🔥 大家都在闯</Text>
          <Text className='rec-more'>更多 ›</Text>
        </View>
        <View className='rec-row'>
          <View className='rec-item' onClick={() => startTopic('量子计算')}>
            <Text className='rec-name'>量子计算</Text>
            <Text className='rec-count'>3.2w 人已闯</Text>
            <Text className='rec-go'>去闯关 ›</Text>
          </View>
          <View className='rec-item' onClick={() => startTopic('机器学习')}>
            <Text className='rec-name'>机器学习</Text>
            <Text className='rec-count'>1.8w 人已闯</Text>
            <Text className='rec-go'>去闯关 ›</Text>
          </View>
          <View className='rec-item' onClick={() => startTopic('区块链')}>
            <Text className='rec-name'>区块链</Text>
            <Text className='rec-count'>9.6k 人已闯</Text>
            <Text className='rec-go'>去闯关 ›</Text>
          </View>
        </View>
      </View>

      <View className='home-btn'>
        <Button
          className={`btn btn-yellow btn-lg ${topicInput.trim() ? '' : 'btn-disabled'}`}
          disabled={!topicInput.trim()}
          onClick={() => startTopic(topicInput.trim())}
        >
          开始闯关
        </Button>
      </View>
      <Text className='tip'>AI 会自动联网检索知识，生成 5 道闯关题</Text>

      <View className='card today-card'>
        <View className='today-head'>
          <Text className='today-title'>今日学习</Text>
          <Text className='today-goal'>目标 20 分钟</Text>
        </View>
        <View className='today-progress'>
          <View className='today-fill' />
        </View>
        <View className='today-foot'>
          <Text>已学习 8 分钟</Text>
          <Text className='today-streak'>连续打卡 7 天</Text>
        </View>
      </View>
    </View>
  )

  const renderLoading = () => (
    <View className='loading-screen'>
      <View className='loading-mascot'>🤖</View>
      <Text className='loading-title'>阿衰正在把知识变成关卡…</Text>

      <View className='loading-steps'>
        <View className={`step ${loadingStep >= 1 ? 'done' : ''}`}>
          <Text className='step-num'>✓</Text>
          <Text>联网检索知识</Text>
        </View>
        <View className={`step ${loadingStep >= 2 ? 'done' : 'active'}`}>
          <Text className='step-num'>{loadingStep >= 2 ? '✓' : '2'}</Text>
          <Text>AI 生成题目</Text>
        </View>
        <View className={`step ${loadingStep >= 3 ? 'done' : ''}`}>
          <Text className='step-num'>{loadingStep >= 3 ? '✓' : '3'}</Text>
          <Text>生成知识讲解</Text>
        </View>
      </View>

      <View className='loading-bar'>
        <View className='loading-fill' />
      </View>

      <View className='loading-cancel'>
        <Button className='btn btn-ghost btn-sm' onClick={reset}>取消</Button>
      </View>
    </View>
  )

  const renderQuiz = () => {
    const lastAnswer = answers[answers.length - 1]

    return (
      <View className='screen-shell'>
        <View className='quiz-top'>
          <Text className='quiz-progress'><Text className='strong'>{currentIndex + 1}</Text>/{questions.length}</Text>
          <Text className='quiz-title'>{currentTopic}</Text>
          <Text className='quiz-xp'>+20 XP</Text>
        </View>

        <View className='quiz-progress-bar'>
          <View className='progress-dots'>
            {questions.map((question, index) => {
              const answer = answers.find((item) => String(item.questionId) === String(question.id))
              const state = answer ? (answer.isCorrect ? 'done' : 'wrong') : index === currentIndex ? 'on' : ''

              return <View key={index} className={`pdot ${state}`} />
            })}
          </View>
        </View>

        <View className='card quiz-card'>
          <View className='quiz-tags'>
            <Text className={`tag ${currentQuestion.type === 'single' ? 'tag-single' : currentQuestion.type === 'multi' ? 'tag-multi' : 'tag-judge'}`}>
              {questionTypeText[currentQuestion.type]}
            </Text>
            <Text className={`tag ${currentQuestion.difficulty === '简单' ? 'tag-easy' : currentQuestion.difficulty === '中等' ? 'tag-mid' : 'tag-judge'}`}>
              {currentQuestion.difficulty}
            </Text>
          </View>

          <Text className='quiz-stem'>{currentQuestion.title}</Text>

          {!submitted && currentQuestion.type === 'multi' && selectedKeys.length === 0 && (
            <Text className='quiz-hint'>请选择多个正确答案</Text>
          )}

          <View className='options'>
            {currentQuestion.options.map((option) => renderOption(option))}
          </View>
        </View>

        {submitted && lastAnswer && (
          <View className='card explain-card'>
            <Text className={`explain-head ${lastAnswer.isCorrect ? 'ok' : 'err'}`}>
              {lastAnswer.isCorrect ? '✅ 答对啦！+20 XP · +10 金币' : `❌ 哎哟，答错了 · 正确答案是 ${currentQuestion.answer.join('、')}`}
            </Text>
            <Text className='explain-body'>{currentQuestion.explanation}</Text>
            <Text className='explain-collapse'>收起讲解 ▲</Text>
          </View>
        )}

        <View className='quiz-btn'>
          {!submitted ? (
            <Button className='btn btn-yellow' onClick={submitAnswer}>提交答案</Button>
          ) : (
            <Button className='btn btn-green' onClick={nextQuestion}>
              {currentIndex === questions.length - 1 ? '查看结算' : '下一题'}
            </Button>
          )}
        </View>
      </View>
    )
  }

  const renderResult = () => (
    <View className='screen-shell win-screen'>
      <View className='win-mascot'>🎉</View>
      <Text className='win-title'>通关啦！</Text>
      <Text className='win-sub'>{currentTopic} · {questions.length} 题完成</Text>

      <View className='win-stats'>
        <View className='stat'>
          <Text className='stat-num'>{stats.correct}/{stats.total}</Text>
          <Text className='stat-label'>答对题数</Text>
        </View>
        <View className='stat'>
          <Text className='stat-num'>{reportData?.accuracy ?? stats.percent}%</Text>
          <Text className='stat-label'>正确率</Text>
        </View>
        <View className='stat'>
          <Text className='stat-num'>2:35</Text>
          <Text className='stat-label'>用时</Text>
        </View>
      </View>

      <View className='card reward-card'>
        <View className='reward-item'>
          <Text className='r-ic yellow'>⚡</Text>
          <Text>经验值 +{stats.xp} XP</Text>
        </View>
        <View className='reward-item'>
          <Text className='r-ic deep'>🪙</Text>
          <Text>金币 +{stats.coins}</Text>
        </View>
        <View className='reward-item'>
          <Text className='r-ic green'>🏅</Text>
          <Text>解锁徽章「初出茅庐」</Text>
        </View>
      </View>

      <Button className='btn btn-yellow win-btn' onClick={openReport}>查看复盘报告</Button>
      <Button className='btn btn-ghost btn-sm' onClick={reset}>再闯一关</Button>
    </View>
  )

  const renderReport = () => (
    <View className='screen-shell'>
      <Text className='report-head'>复盘报告</Text>
      <Text className='report-sub'>本次闯关 · {currentTopic}</Text>

      <View className='card ring-card'>
        <View className='ring'>
          <View className='ring-in'>
            <Text className='ring-num'>{reportData?.accuracy ?? stats.percent}%</Text>
            <Text className='ring-label'>正确率</Text>
          </View>
        </View>
        <Text className='ring-desc'>掌握度评估 · {reportData?.mastered_points.length || 0} 个知识点已掌握</Text>
      </View>

      <View className='card sec-card'>
        <Text className='sec-title'>✅ 掌握较好</Text>
        <View className='point-list'>
          {(reportData?.mastered_points || ['等待报告生成']).map((point) => (
            <Text key={point} className='point'>{point}</Text>
          ))}
        </View>
      </View>

      <View className='card sec-card'>
        <Text className='sec-title'>⚠️ 薄弱知识点</Text>
        <View className='point-list'>
          {(reportData?.weak_points || ['等待报告生成']).map((point) => (
            <Text key={point} className='point'>{point}</Text>
          ))}
        </View>
      </View>

      <View className='card sec-card'>
        <Text className='sec-title'>📝 三句知识总结</Text>
        <Text className='summary-list'>{reportData?.three_line_summary.join('\n') || '报告生成中，请稍候。'}</Text>
      </View>

      <View className='card sec-card'>
        <Text className='sec-title'>💡 复习建议</Text>
        <Text className='summary-list'>建议 3 天后重温「RAG 与搜索引擎」相关题目，错题已加入错题本。</Text>
      </View>

      <Button className='btn btn-yellow report-btn' onClick={openPoster}>生成分享海报</Button>
    </View>
  )

  const renderPoster = () => (
    <View className='screen-shell'>
      <Text className='report-head'>分享学习成果</Text>
      <Text className='report-sub'>生成一张精美海报，分享给好友</Text>

      <View className='poster'>
        <Text className='poster-top'>今天我又闯过一个知识关卡！</Text>
        <Text className='poster-data'>正确率 {stats.percent}% · 掌握 4 个知识点</Text>
        <View className='poster-mascot'>🐼</View>
        <Text className='poster-quote'>「把知识做成关卡，记忆会更深。」</Text>
        <View className='poster-code'>小程序码</View>
        <Text className='poster-brand'>阿衰闯关学习 · 扫码一起闯关</Text>
      </View>

      <Button className='btn btn-yellow poster-btn' onClick={() => setScreen('poster')}>保存海报</Button>
      <Button className='btn btn-green' onClick={() => setScreen('poster')}>转发给好友</Button>
    </View>
  )

  return (
    <View className='index-page'>
      <View className='screen'>
        {screen === 'home' && renderHome()}
        {screen === 'loading' && renderLoading()}
        {screen === 'quiz' && renderQuiz()}
        {screen === 'result' && renderResult()}
        {screen === 'report' && renderReport()}
        {screen === 'poster' && renderPoster()}
      </View>

      <View className='tabbar'>
        <View className={`tab ${screen === 'home' ? 'on' : ''}`} onClick={reset}>
          <Text className='ic'>🏠</Text>
          <Text>首页</Text>
        </View>
        <View className={`tab ${screen === 'quiz' ? 'on' : ''}`} onClick={() => startTopic(currentTopic)}>
          <Text className='ic'>🎯</Text>
          <Text>闯关</Text>
        </View>
        <View className={`tab ${screen === 'report' || screen === 'poster' ? 'on' : ''}`} onClick={openReport}>
          <Text className='ic'>📊</Text>
          <Text>报告</Text>
        </View>
        <View className='tab' onClick={reset}>
          <Text className='ic'>👤</Text>
          <Text>我的</Text>
        </View>
      </View>
    </View>
  )
}
