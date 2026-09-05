export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/me/index',
    'pages/me/edit',
    'pages/history/index',
    'pages/history/detail',
    'pages/wrong-questions/index',
    'pages/wrong-questions/detail',
    'pages/poster/index'
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fff4dc',
    navigationBarTitleText: '阿衰闯关学习',
    navigationBarTextStyle: 'black'
  },
  tabBar: {
    color: '#8a8a8a',
    selectedColor: '#d18f00',
    backgroundColor: '#fff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '首页',
        iconPath: 'assets/tab-home.png',
        selectedIconPath: 'assets/tab-home-active.png'
      },
      {
        pagePath: 'pages/history/index',
        text: '闯关历史',
        iconPath: 'assets/tab-quiz.png',
        selectedIconPath: 'assets/tab-quiz-active.png'
      },
      {
        pagePath: 'pages/wrong-questions/index',
        text: '错题本',
        iconPath: 'assets/tab-wrong.png',
        selectedIconPath: 'assets/tab-wrong-active.png'
      },
      {
        pagePath: 'pages/me/index',
        text: '我的',
        iconPath: 'assets/tab-me.png',
        selectedIconPath: 'assets/tab-me-active.png'
      }
    ]
  }
})
