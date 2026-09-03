import Taro from '@tarojs/taro'

const API_BASE_URL = ['http:', '', '127.0.0.1:8000'].join('/')

export type QuizApiQuestion = {
  id: string
  type: 'single' | 'multiple' | 'judge'
  stem: string
  options: Array<{ key: string; text: string }>
  answer: string[]
  explanation: string
  knowledge_point: string
  difficulty: 'easy' | 'medium' | 'hard'
}

export type QuizApiResponse = {
  quiz_id: string
  title: string
  summary: string
  source_type: 'text'
  user_input: string
  questions: QuizApiQuestion[]
}

export type ReportApiResponse = {
  accuracy: number
  mastered_points: string[]
  weak_points: string[]
  three_line_summary: string[]
  advice: string[]
  share_quote: string
}

async function request<T>(path: string, data: Record<string, unknown>): Promise<T> {
  console.log('[api] request', `${API_BASE_URL}${path}`, data)
  const response = await Taro.request<T>({
    url: `${API_BASE_URL}${path}`,
    method: 'POST',
    data,
    header: {
      'content-type': 'application/json'
    }
  })

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`请求失败（${response.statusCode}）`)
  }

  return response.data
}

export function generateQuiz(topic: string) {
  return request<QuizApiResponse>('/api/v1/quiz/generate', {
    user_input: topic,
    question_count: 5,
    difficulty: 'mixed'
  })
}

export function generateReport(
  quiz: QuizApiResponse,
  answers: Array<{ question_id: string; selected_answers: string[]; is_correct: boolean; duration_ms: number }>
) {
  return request<ReportApiResponse>('/api/v1/report/generate', {
    quiz_id: quiz.quiz_id,
    topic: quiz.title,
    questions: quiz.questions,
    answer_records: answers
  })
}