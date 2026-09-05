# 鱼皮 AI 闯关学习 - 项目说明

## 项目概述

基于微信小程序的 AI 驱动闯关学习应用。用户输入想学的主题，AI（DeepSeek）生成 5 道闯关题（单选/多选/判断），逐题作答并即时判题、展示解析；通关后生成 AI 复盘报告。已完成「用户系统与用户功能扩展」阶段：微信静默登录 + JWT、学习数据持久化、闯关历史、错题本与错题复习。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Taro 4.2.1 + React 18 + TypeScript + 微信小程序 |
| 后端 | Python FastAPI + SQLAlchemy 2.0 + PyMySQL（同步 Session） |
| AI | langchain-openai（ChatOpenAI）→ DeepSeek API，Pydantic v2 结构化输出 |
| 数据库 | MySQL 8.x (utf8mb4) |
| 认证 | JWT (PyJWT HS256, 120 分钟有效期)，Bearer 头注入 |

所有接口统一返回信封格式：

```json
{ "code": 0, "message": "ok", "data": { } }
```

成功 `code=0`；失败按业务返回非 0 业务码（4010 未登录 / 4040 不存在 / 4090 状态冲突 / 5030 上游 AI 不可用等），HTTP 状态码保留原语义，前端在非 2xx 或 `code!=0` 时抛出带 message 的错误。

---

## 后端启动

```bash
# 1. 创建虚拟环境并安装依赖
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
source venv/bin/activate    # macOS/Linux
pip install -r requirements.txt

# 2. 配置环境变量
copy .env.example .env      # Windows
cp .env.example .env        # macOS/Linux
# 编辑 .env，至少设置 DEEPSEEK_API_KEY、MYSQL_*、JWT_SECRET_KEY；
# 开发环境可开 ENABLE_MOCK_LOGIN=true（配合 APP_ENV=development），微信登录走 mock。

# 3. 初始化数据库（首次运行）
#    导入 backend/database/init.sql（含全部表与索引），
#    后续表结构变更放在 backend/database/migrations/ 下按序执行。

# 4. 启动服务
python -m uvicorn app.main:app --reload
```

访问 http://127.0.0.1:8000/docs 查看 API 文档。

> 头像上传接口会把图片写入 `backend/uploads/avatars/`，并通过 `/static/avatars/...` 提供访问；
> `.env` 中 `PUBLIC_BASE_URL` 必须是小程序可访问的地址（默认 `http://127.0.0.1:8000`）。

---

## 前端构建

```bash
cd myApp
npm install

# 微信开发者工具实时预览
npm run dev:weapp

# 生产构建
npm run build:weapp
```

> `myApp/src/services/api.ts` 顶部 `API_BASE_URL` 默认指向 `http://127.0.0.1:8000`，真机调试需改为 HTTPS 域名。

---

## 测试

```bash
# 后端测试
cd backend
python -m pytest tests/ -q

# 预期结果：11 passed（认证 + mock AI 出题报告 + 闯关/历史/错题/复习全流程集成）
```

---

## API 接口

### 统一信封
`{ code, message, data }`，`data` 为各接口返回体。业务码：4000 参数/业务拒绝、4010 未登录或失效、4040 不存在、4090 状态冲突、4220 校验失败、5030 上游不可用。

### 认证与用户
- `POST /api/v1/auth/wechat-login` - 微信 code 静默登录（mock 模式返回开发用户），返回 `{token, user}`
- `POST /api/v1/auth/logout` - 退出登录
- `GET /api/v1/users/me` - 当前用户资料
- `PATCH /api/v1/users/me` - 修改昵称/头像（`{nickname?, avatar_url?}`）
- `POST /api/v1/users/me/avatar` - 上传头像图片（multipart `file`，≤2MB，返回 `{avatar_url}`）
- `GET /api/v1/users/me/overview` - 个人统计 `{history_total, wrong_total, due_review_total}`
- `GET /api/v1/users/me/share-qrcode?scene=poster` - 分享海报用小程序码（微信 `getwxacodeunlimit`，返回 base64 PNG/JPEG；未配置 AppID/Secret 或调用失败时返回 5030，前端自动降级为占位码）

### 闯关
- `POST /api/v1/quiz/generate` - AI 生成题目并立即创建会话与题目快照（需要 JWT）
- `POST /api/v1/quiz/{quiz_id}/answers` - 提交单题答案 `{question_id, selected_answers, duration_ms}`；服务端按快照判题，幂等，答错自动写入错题本（复习闯关答对则移除错题）
- `POST /api/v1/quiz/{quiz_id}/complete` - 结算（全部答完才可，同事务统计）
- `POST /api/v1/quiz/{quiz_id}/report` - 生成/重生成已完成闯关的 AI 复盘报告；失败落库为 failed，可重试
- `GET /api/v1/quiz/in-progress` - 进行中闯关列表（含已答题数），用于「继续闯关」
- `GET /api/v1/quiz/{quiz_id}` - 闯关详情（题目快照 + 我的作答 + 报告）

### 历史
- `GET /api/v1/history/quizzes?page=&page_size=` - 分页历史（含 total/has_more，复习闯关不出现）
- `GET /api/v1/history/quizzes/{quiz_id}` - 历史详情（等价 `/quiz/{quiz_id}`）

### 热门话题
- `GET /api/v1/hot-topics?limit=` - 真实热度：按全部用户**已完成**闯关的 topic 分组统计次数（排除复习闯关），按次数/最近完成倒序；无虚构数据

### 错题本
- `GET /api/v1/wrong-questions?page=&page_size=` - 错题列表（含题目快照明细）
- `GET /api/v1/wrong-questions/detail` - 同上（兼容别名）
- `GET /api/v1/wrong-questions/{wrong_question_id}` - 错题详情（含我的作答）
- `POST /api/v1/wrong-questions/{wrong_question_id}/retry` - 创建单题复习闯关（答对自动移出错题本，答错刷新复习时间）

> 遗留兼容：`POST /api/v1/report/generate` 无状态版仍保留；`POST /api/v1/quiz/generate` 已是落库版。

---

## 数据库表

| 表名 | 说明 |
|------|------|
| users | 用户（openid 唯一） |
| quiz_sessions | 闯关会话（含 `review_for_wrong_question_id`：非空代表错题复习闯关） |
| question_snapshots | 题目快照（AI 生成内容持久化，判题/展示都读快照） |
| answer_records | 答题记录（服务端判题结果；`(quiz, question_snapshot)` 唯一） |
| reports | 复盘报告（pending/completed/failed + generation_attempts） |
| wrong_questions | 错题（`(user, question_snapshot)` 唯一，含复习建议时间 review_at） |

表结构定义见 `backend/database/init.sql`，后续变更见 `backend/database/migrations/`。

---

## 目录结构

```
backend/
├── app/
│   ├── main.py             # FastAPI 入口：挂载路由、信封异常处理、/static
│   ├── api_auth.py         # 认证与用户资料/头像接口
│   ├── api_learning.py     # 闯关/历史/错题/复习接口
│   ├── llm.py / prompts.py # DeepSeek 对话与提示词
│   ├── models.py           # AI 出入参 Pydantic 模型
│   ├── models_user.py / models_learning.py  # ORM 模型
│   ├── core/
│   │   ├── config.py       # pydantic-settings
│   │   ├── database.py     # SQLAlchemy session
│   │   ├── security.py     # JWT
│   │   └── errors.py       # 统一信封与业务码
│   └── services/
│       ├── auth_service.py     # 微信 code 交换 + upsert 用户
│       ├── quiz_service.py     # AI 出题
│       ├── report_service.py   # AI 报告
│       └── learning_service.py # 闯关/判题/错题/复习/统计服务逻辑
├── database/
│   ├── init.sql            # 建表脚本
│   └── migrations/         # 增量迁移（002 增加 quiz_sessions.review_for_wrong_question_id）
├── tests/
│   ├── test_auth.py
│   ├── test_mock_ai_flow.py
│   └── test_learning_flow.py
├── uploads/avatars/        # 运行时创建：用户头像
├── .env.example
└── requirements.txt

myApp/
├── src/
│   ├── pages/
│   │   ├── index/            # 首页：输入主题 + 开始闯关 + 继续闯关 + 答题/结算/报告（单页流程）
│   │   ├── me/               # 我的：真实统计、编辑资料入口、退出登录（+ me/edit 资料页）
│   │   ├── history/          # 闯关历史列表 + 详情（答题情况、复盘报告、继续闯关）
│   │   └── wrong-questions/  # 错题本（按知识点分组）+ 错题详情（重新挑战）
│   ├── services/api.ts       # 请求封装：信封解包、JWT 注入、401 自动重登、类型化接口
│   ├── utils/format.ts       # 时间/时长/复习文案格式化
│   ├── assets/               # TabBar 图标
│   └── app.config.ts         # 页面注册与 TabBar（首页/闯关/错题本/我的）
```

---

## 关键约定与偏差说明

1. 前端答题不再本地判题：每题把选择提交后端，由服务端按题目快照判题并返回对错/解析；结算由 `complete` 完成。
2. 页面只展示真实数据：首页/我的页面不再出现「连续打卡」「Lv.5」「经验值」等虚构统计；首页「大家都在问」区块改为真实统计（`GET /hot-topics`，按用户实际完成闯关的 topic 聚合），无数据时显示引导文案。演示话题 chips 仅为输入建议。
3. 头像编辑通过微信 `chooseAvatar` 选取后上传 `/users/me/avatar`，返回静态 URL 再 PATCH 保存；无上传后端无法持久化头像（本仓库已实现）。
4. 错题复习：错题「重新挑战」会创建单题复习会话并跳回首页答题；答对在同一事务内删除错题记录、答错更新错题次数与 `review_at`。
5. 报告生成为「按需/可重试」：结算页点「查看复盘报告」触发，失败落库 failed 并在详情页/报告页提供重试；报告内容按真实答题记录生成。
6. 中途退出：会话保持 in_progress，首页展示「继续闯关」横幅、历史列表与详情提供继续入口，恢复时用服务端快照与已提交记录。
7. 分享海报（已实现）：结算报告页与闯关历史详情页提供「生成分享海报」，进入独立海报页用真实数据（正确率/答对题数/掌握知识点/AI 金句）在 Canvas 绘制金色分享卡，支持保存到相册与转发好友；海报内嵌小程序码优先取微信 `getwxacodeunlimit` 真码（`env_version` 默认 `develop`，配置 `WECHAT_APP_ID/SECRET` 后可用，实测测试号可正常返回），失败自动降级为占位码，不阻塞保存。
8. 遗留差异：金币/徽章/经验值等游戏化元素本轮未实现（不虚构数据）；原型 2/3 中分析、排行榜、PK、会员等页面不在本次范围。
