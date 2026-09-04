import { Button, Image, Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import {
  ensureLogin,
  getCurrentUser,
  updateProfile,
  uploadAvatar,
  type UserProfile
} from '../../services/api'
import './edit.scss'

export default function ProfileEdit() {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [nickname, setNickname] = useState('')
  const [avatarPreview, setAvatarPreview] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    ensureLogin()
      .then((current) => {
        setUser(current)
        setNickname(current.nickname)
        setAvatarPreview(current.avatar_url)
      })
      .catch(() => {
        Taro.showToast({ title: '登录状态失效，请重试', icon: 'none' })
        setTimeout(() => Taro.navigateBack(), 800)
      })
  }, [])

  const onChooseAvatar = async (event: { detail: { avatarUrl: string } }) => {
    const filePath = event.detail.avatarUrl
    if (!filePath) return
    setUploading(true)
    try {
      const avatarUrl = await uploadAvatar(filePath)
      setAvatarPreview(avatarUrl)
      setUser((prev) => (prev ? { ...prev, avatar_url: avatarUrl } : prev))
      Taro.showToast({ title: '头像已更新', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '头像上传失败', icon: 'none' })
    } finally {
      setUploading(false)
    }
  }

  const clearAvatar = () => {
    setAvatarPreview('')
    setUser((prev) => (prev ? { ...prev, avatar_url: '' } : prev))
  }

  const onSave = async () => {
    const finalNickname = nickname.trim()
    if (!finalNickname) {
      Taro.showToast({ title: '昵称不能为空', icon: 'none' })
      return
    }
    if (finalNickname.length > 64) {
      Taro.showToast({ title: '昵称最长 64 个字符', icon: 'none' })
      return
    }
    setSaving(true)
    try {
      const avatarUrl = user?.avatar_url || ''
      await updateProfile({ nickname: finalNickname, avatar_url: avatarUrl })
      const updated = await getCurrentUser()
      setUser(updated)
      Taro.showToast({ title: '保存成功', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 600)
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '保存失败，请重试', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <View className='screen-shell'>
      {/* 头像 */}
      <View className='avatar-card card'>
        <Text className='field-label'>头像</Text>
        <View className='avatar-wrap'>
          {avatarPreview ? (
            <Image className='avatar-img' src={avatarPreview} mode='aspectFill' />
          ) : (
            <View className='avatar-default'>🐼</View>
          )}
          <Button className='avatar-btn' openType='chooseAvatar' loading={uploading} onChooseAvatar={onChooseAvatar}>
            {uploading ? '上传中…' : '选择微信头像'}
          </Button>
          {avatarPreview && (
            <Text className='clear-avatar' onClick={clearAvatar}>使用默认头像</Text>
          )}
        </View>
      </View>

      {/* 昵称 */}
      <View className='nick-card card'>
        <Text className='field-label'>昵称</Text>
        <Input
          className='nick-input'
          type='nickname'
          value={nickname}
          placeholder='请输入昵称'
          maxlength={64}
          onInput={(event) => setNickname(event.detail.value)}
        />
      </View>

      <Text className='tip'>使用微信昵称/头像需要你的授权；头像会通过安全接口上传保存。</Text>

      <Button className='save-btn' loading={saving} disabled={saving} onClick={() => void onSave()}>
        保存
      </Button>
    </View>
  )
}
