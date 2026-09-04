/** Shared date/duration formatting helpers for quiz UI. */

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function formatTime(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatDate(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

export function formatMs(ms?: number | null): string {
  if (!ms || ms <= 0) return '--'
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    return `${hours}小时${pad(minutes % 60)}分`
  }
  return `${minutes}:${pad(seconds)}`
}

export function reviewStatusText(reviewAt: string | null): { text: string; due: boolean } {
  if (!reviewAt) return { text: '待安排复习', due: false }
  const due = new Date(reviewAt).getTime() <= Date.now()
  return {
    text: due ? `已到复习时间（${formatDate(reviewAt)}）` : `建议 ${formatDate(reviewAt)} 前复习`,
    due
  }
}

export function difficultyText(difficulty: string): string {
  const map: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' }
  return map[difficulty] || difficulty
}
