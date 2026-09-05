import Taro from '@tarojs/taro'

const API_BASE_URL = ['http:', '', '127.0.0.1:8000'].join('/')
const TOKEN_KEY = 'yu_ai_learn_token'
const USER_KEY = 'yu_ai_learn_user'

/** Storage key used to ask the index page to resume a quiz (continue a run or a wrong-question review session). */
export const PENDING_QUIZ_KEY = 'pending_quiz_id'

export type QuestionType = 'single' | 'multiple' | 'judge'
export type Difficulty = 'easy' | 'medium' | 'hard'

export interface QuizOption {
  key: string
  text: string
}

export interface QuizApiQuestion {
  id: string
  type: QuestionType
  stem: string
  options: QuizOption[]
  answer: string[]
  explanation: string
  knowledge_point: string
  difficulty: Difficulty
}

export interface QuizApiResponse {
  quiz_id: string
  title: string
  summary: string
  source_type: string
  user_input: string
  questions: QuizApiQuestion[]
}

export interface ReportData {
  status: 'pending' | 'completed' | 'failed'
  accuracy: number
  mastered_points: string[]
  weak_points: string[]
  three_line_summary: string[]
  advice: string[]
  share_quote: string
  generation_attempts: number
  created_at: string
  updated_at: string
}

export interface AnswerFeedback {
  is_correct: boolean
  already_submitted: boolean
  correct_answers: string[]
  explanation: string
}

export interface CompleteResult {
  id: string
  correct_count: number
  question_count: number
  accuracy: number
  total_duration_ms: number
}

export type QuizStatus = 'in_progress' | 'completed'

export interface QuizSummary {
  id: string
  topic: string
  title: string
  status: QuizStatus
  correct_count: number
  question_count: number
  accuracy: number
  total_duration_ms: number
  created_at: string
  completed_at: string | null
  review: boolean
}

export type InProgressItem = QuizSummary & { answered_count: number }

export interface QuizAnswerRecord {
  question_id: string
  selected_answers: string[]
  is_correct: boolean
  duration_ms: number
  submitted_at: string
}

export interface QuizDetailResponse {
  id: string
  topic: string
  title: string
  summary: string
  status: QuizStatus
  correct_count: number
  question_count: number
  accuracy: number
  total_duration_ms: number
  created_at: string
  started_at: string | null
  completed_at: string | null
  updated_at: string
  review: boolean
  questions: QuizApiQuestion[]
  answers: QuizAnswerRecord[]
  report: ReportData | null
}

export interface WrongQuestionItem {
  wrong_id: string
  question_snapshot_id: string
  wrong_count: number
  first_wrong_at: string
  last_wrong_at: string
  review_at: string | null
  question: QuizApiQuestion | null
}

export type WrongQuestionDetail = WrongQuestionItem & { user_answer: string[] }

export interface UserProfile {
  id: string
  nickname: string
  avatar_url: string
}

export interface UserOverview {
  history_total: number
  wrong_total: number
  due_review_total: number
}

export interface HotTopicItem {
  topic: string
  run_count: number
  last_completed_at: string | null
}

export interface Paged<T> {
  items: T[]
  page: number
  page_size: number
  has_more: boolean
  total: number
}

/** Unified backend envelope: { code, message, data }. code === 0 means success. */
export interface Envelope<T> {
  code: number
  message: string
  data: T
}

export class ApiError extends Error {
  readonly statusCode: number
  readonly code: number

  constructor(message: string, statusCode: number, code: number) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

export function getToken() {
  return Taro.getStorageSync<string>(TOKEN_KEY) || ''
}

export function setToken(token: string) {
  Taro.setStorageSync(TOKEN_KEY, token)
}

export function clearAuth() {
  Taro.removeStorageSync(TOKEN_KEY)
  Taro.removeStorageSync(USER_KEY)
}

export function getStoredUser(): UserProfile | null {
  const user = Taro.getStorageSync<UserProfile | ''>(USER_KEY)
  return user || null
}

function setStoredUser(user: UserProfile) {
  Taro.setStorageSync(USER_KEY, user)
}

interface RequestOptions {
  method?: 'POST' | 'GET' | 'PATCH'
  retry?: boolean
  withAuth?: boolean
}

let loginPromise: Promise<UserProfile> | null = null

async function login(): Promise<UserProfile> {
  if (loginPromise) return loginPromise
  loginPromise = (async () => {
    try {
      const result = await Taro.login()
      if (!result.code) {
        throw new ApiError('微信登录失败，请重试', 0, -1)
      }
      const data = await request<{ token: string; user: UserProfile }>(
        '/api/v1/auth/wechat-login',
        { code: result.code },
        { method: 'POST', retry: false, withAuth: false }
      )
      setToken(data.token)
      setStoredUser(data.user)
      return data.user
    } finally {
      loginPromise = null
    }
  })()
  return loginPromise
}

/**
 * Make an authenticated request against the unified-envelope API.
 * data is the unwrapped payload. A single automatic re-login happens on 401.
 */
export async function request<T>(
  path: string,
  data?: unknown,
  options: RequestOptions = {}
): Promise<T> {
  const { method = 'POST', retry = true, withAuth = true } = options
  const url = `${API_BASE_URL}${path}`

  // Ensure we have a token before sending an authenticated request, so the
  // first launch of the mini program does not fire a batch of 401s.
  let token = getToken()
  if (withAuth && !token && path !== '/api/v1/auth/wechat-login') {
    await login()
    token = getToken()
  }

  const response = await Taro.request<Envelope<T>>({
    url,
    method,
    data: method === 'GET' ? undefined : data,
    header: {
      'content-type': 'application/json',
      ...(withAuth && token ? { Authorization: `Bearer ${token}` } : {})
    }
  })

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const body = parseEnvelope(response.data as Envelope<T> | undefined)
    if (response.statusCode === 401 && retry && path !== '/api/v1/auth/wechat-login') {
      clearAuth()
      await login()
      return request<T>(path, data, { ...options, retry: false })
    }
    throw new ApiError(
      body?.message || `请求失败（${response.statusCode}）`,
      response.statusCode,
      body?.code ?? response.statusCode * 10
    )
  }

  const envelope = parseEnvelope<T>(response.data)
  if (envelope && envelope.code !== 0) {
    throw new ApiError(envelope.message || '请求失败', response.statusCode, envelope.code)
  }
  return (envelope ? envelope.data : (response.data as T))
}

function parseEnvelope<T>(body: unknown): Envelope<T> | null {
  if (!body) return null
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      return null
    }
  }
  if (typeof body !== 'object') return null
  const candidate = body as Envelope<T>
  if (typeof candidate.code === 'number' && typeof candidate.message === 'string') return candidate
  return null
}

export function ensureLogin(): Promise<UserProfile> {
  if (getToken()) {
    return getCurrentUser().catch(() => login())
  }
  return login()
}

export async function loginWithWechat(): Promise<UserProfile> {
  return login()
}

export async function logoutApi(): Promise<void> {
  try {
    await request<null>('/api/v1/auth/logout', {}, { method: 'POST' })
  } finally {
    clearAuth()
  }
}

// ---------- users ----------

export async function getCurrentUser() {
  const user = await request<UserProfile>('/api/v1/users/me', {}, { method: 'GET' })
  setStoredUser(user)
  return user
}

export function getUserOverview() {
  return request<UserOverview>('/api/v1/users/me/overview', {}, { method: 'GET' })
}

export function updateProfile(patch: { nickname?: string; avatar_url?: string }) {
  return request<UserProfile>('/api/v1/users/me', patch, { method: 'PATCH' })
}

export async function uploadAvatar(filePath: string): Promise<string> {
  const token = getToken()
  const response = await Taro.uploadFile({
    url: `${API_BASE_URL}/api/v1/users/me/avatar`,
    filePath,
    name: 'file',
    header: token ? { Authorization: `Bearer ${token}` } : {}
  })
  const body = parseEnvelope<{ avatar_url: string }>(response.data)
  if (response.statusCode < 200 || response.statusCode >= 300 || !body || body.code !== 0) {
    throw new ApiError(
      body?.message || `头像上传失败（${response.statusCode}）`,
      response.statusCode,
      body?.code ?? -1
    )
  }
  return body.data.avatar_url
}

// ---------- quiz flow ----------

export function generateQuiz(topic: string) {
  return request<QuizApiResponse>('/api/v1/quiz/generate', {
    user_input: topic,
    question_count: 5,
    difficulty: 'mixed'
  })
}

export function submitQuizAnswer(
  quizId: string,
  questionId: string,
  selectedAnswers: string[],
  durationMs: number
) {
  return request<AnswerFeedback>(`/api/v1/quiz/${quizId}/answers`, {
    question_id: questionId,
    selected_answers: selectedAnswers,
    duration_ms: durationMs
  })
}

export function completeQuiz(quizId: string) {
  return request<CompleteResult>(`/api/v1/quiz/${quizId}/complete`, {})
}

export function fetchQuizReport(quizId: string) {
  return request<ReportData>(`/api/v1/quiz/${quizId}/report`, {})
}

export function getQuizInProgress() {
  return request<{ items: InProgressItem[] }>('/api/v1/quiz/in-progress', {}, { method: 'GET' })
}

export function getQuizDetail(quizId: string) {
  return request<QuizDetailResponse>(`/api/v1/quiz/${quizId}`, {}, { method: 'GET' })
}

export function getQuizHistory(page = 1, pageSize = 20) {
  return request<Paged<QuizSummary>>(
    `/api/v1/history/quizzes?page=${page}&page_size=${pageSize}`,
    {},
    { method: 'GET' }
  )
}

export function getHotTopics(limit = 5) {
  return request<{ items: HotTopicItem[] }>(
    `/api/v1/hot-topics?limit=${limit}`,
    {},
    { method: 'GET' }
  )
}

// ---------- wrong questions ----------

export function getWrongQuestions(page = 1, pageSize = 20) {
  return request<Paged<WrongQuestionItem>>(
    `/api/v1/wrong-questions/detail?page=${page}&page_size=${pageSize}`,
    {},
    { method: 'GET' }
  )
}

export function getWrongQuestionDetail(wrongId: string) {
  return request<WrongQuestionDetail>(`/api/v1/wrong-questions/${wrongId}`, {}, { method: 'GET' })
}

export function retryWrongQuestion(wrongId: string) {
  return request<QuizDetailResponse>(`/api/v1/wrong-questions/${wrongId}/retry`, {})
}

export interface ShareQrcodeResult {
  base64: string
}

/** Mini-program code (wxacode) as base64 for the share poster. Falls back to
 * the caller drawing a placeholder when WeChat returns an error. */
export function getShareQrcode(scene = 'poster') {
  return request<ShareQrcodeResult>(
    `/api/v1/users/me/share-qrcode?scene=${encodeURIComponent(scene)}`,
    {},
    { method: 'GET' }
  )
}

// ---------- cross-page helpers ----------

export function startPendingQuiz(quizId: string) {
  Taro.setStorageSync(PENDING_QUIZ_KEY, quizId)
  Taro.switchTab({ url: '/pages/index/index' })
}
