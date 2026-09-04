import { Button, Image, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import {
  getCurrentUser,
  getUserOverview,
  loginWithWechat,
  logoutApi,
  type UserOverview,
  type UserProfile
} from '../../services/api'
import './index.scss'

export default function Me() {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [overview, setOverview] = useState<UserOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)

  const load = () => {
    setLoading(true)
    setFailed(false)
    getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
    getUserOverview()
      .then(setOverview)
      .catch(() => setOverview(null))
  }

  useDidShow(() => {
    load()
  })

  const onLogin = async () => {
    if (loggingIn) return
    setLoggingIn(true)
    try {
      await loginWithWechat()
      load()
      Taro.showToast({ title: '登录成功', icon: 'success' })
    } catch (error) {
      setFailed(true)
      Taro.showToast({ title: error instanceof Error ? error.message : '登录失败，请重试', icon: 'none' })
    } finally {
      setLoggingIn(false)
    }
  }

  const onLogout = () => {
    Taro.showModal({
      title: '退出登录',
      content: '退出后本机学习数据将不再显示，云端记录不会删除。确定退出吗？',
      confirmColor: '#e85d5d',
      success: (result) => {
        if (!result.confirm) return
        logoutApi()
          .catch(() => undefined)
          .then(() => {
            setUser(null)
            setOverview(null)
            Taro.showToast({ title: '已退出登录', icon: 'none' })
          })
      }
    })
  }

  const navigateTo = (path: string) => {
    Taro.navigateTo({ url: path })
  }

  if (loading) {
    return (
      <View className='screen-shell loading-page'>
        <Text className='loading-text'>加载中...</Text>
      </View>
    )
  }

  if (!user) {
    return (
      <View className='screen-shell'>
        <View className='login-state'>
          <View className='login-avatar'>🐼</View>
          <Text className='login-title'>登录后开启闯关之旅</Text>
          <Text className='login-sub'>闯关记录、历史报告、错题本都会云端同步</Text>
          <Button className='login-btn' loading={loggingIn} onClick={() => void onLogin()}>
            {failed ? '重新登录' : '微信一键登录'}
          </Button>
        </View>
      </View>
    )
  }

  return (
    <View className='screen-shell'>
      {/* 头像区域 */}
      <View className='me-head'>
        <View className='me-row' onClick={() => navigateTo('/pages/me/edit')}>
          <View className='me-avatar'>
            {user.avatar_url ? (
              <Image src={user.avatar_url} mode='aspectFill' />
            ) : (
              <Text className='avatar-icon'>🐼</Text>
            )}
          </View>
          <View className='me-info'>
            <Text className='me-name'>{user.nickname || '阿衰学习者'}</Text>
            <Text className='me-rank'>已登录 · 点击编辑资料</Text>
          </View>
          <Text className='me-arrow'>›</Text>
        </View>
      </View>

      {/* 统计卡片（真实数据） */}
      <View className='me-stats-card card'>
        <View className='me-stat-item'>
          <Text className='me-stat-num'>{overview?.history_total ?? 0}</Text>
          <Text className='me-stat-label'>累计闯关</Text>
        </View>
        <View className='me-stat-divider' />
        <View className='me-stat-item'>
          <Text className='me-stat-num'>{overview?.wrong_total ?? 0}</Text>
          <Text className='me-stat-label'>错题数</Text>
        </View>
        <View className='me-stat-divider' />
        <View className='me-stat-item'>
          <Text className={`me-stat-num ${overview && overview.due_review_total > 0 ? 'due' : ''}`}>
            {overview?.due_review_total ?? 0}
          </Text>
          <Text className='me-stat-label'>当天待复习</Text>
        </View>
      </View>

      {/* 菜单列表 */}
      <View className='menu-card card'>
        <View className='menu-item' onClick={() => navigateTo('/pages/me/edit')}>
          <Text className='menu-icon'>✏️</Text>
          <Text className='menu-text'>编辑资料</Text>
          <Text className='menu-arrow'>›</Text>
        </View>
        <View className='menu-item' onClick={() => Taro.switchTab({ url: '/pages/history/index' })}>
          <Text className='menu-icon'>🎯</Text>
          <Text className='menu-text'>闯关历史</Text>
          <Text className='menu-arrow'>›</Text>
        </View>
        <View className='menu-item' onClick={() => Taro.switchTab({ url: '/pages/wrong-questions/index' })}>
          <Text className='menu-icon'>📕</Text>
          <Text className='menu-text'>错题本</Text>
          <Text className='menu-badge'>{overview && overview.wrong_total > 0 ? overview.wrong_total : ''}</Text>
          <Text className='menu-arrow'>›</Text>
        </View>
      </View>

      {/* 底部 */}
      <View className='me-footer'>
        <Button className='logout-btn' onClick={onLogout}>退出登录</Button>
        <Text className='me-version'>阿衰闯关学习 v1.0</Text>
      </View>
    </View>
  )
}
