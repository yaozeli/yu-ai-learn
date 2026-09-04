import { PropsWithChildren } from 'react'
import { useLaunch } from '@tarojs/taro'

import './app.scss'
import { ensureLogin } from './services/api'

function App({ children }: PropsWithChildren<any>) {
  useLaunch(() => {
    ensureLogin().catch(() => undefined)
  })

  // children 是将要会渲染的页面
  return children
}
  


export default App
