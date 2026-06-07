# 微行动教练

一个面向 Android 快速迭代的个人版 AI 行动教练：前端用 React/Vite PWA，Android 侧用 Capacitor 壳，后端用 FastAPI + SQLite 代理大模型 API。

## 架构

```text
Android 手机
  -> Capacitor App 壳 / PWA
  -> Web 前端
  -> FastAPI 后端
  -> 大模型 API + SQLite
```

## 当前完成度

已实现首批闭环，并继续补上下一批核心场景：

- 四个底部 Tab：首页、对话、复盘、我的
- 首次引导：产品边界、本地保存、AI 调用上下文说明
- 首页五个场景入口全部可进入：拖延急救、每日复盘、鼓励师、创造动力、人际关系分析
- 拖延急救：输入任务、选择拖延原因、生成 3 分钟内行动、完成/没做时降低难度、保存行动结果
- 鼓励师：把自我否定拆成真实担心、中性证据和低风险行动
- 创造动力：从刷手机和空转切出一个小的主动输出
- 人际关系分析：分清事实、猜测、情绪、需求，生成温和/直接/边界三版表达
- 每日复盘：表单、AI 总结、本地模板兜底、编辑保存、历史列表
- 我的/设置：历史记录开关、服务端记录开关、每日复盘提醒时间、安全支持入口、本地数据 JSON 导出
- 本地画像摘要：高频场景、情绪标签、需求标签、近期模式和建议关注点
- 更多提醒类型：首次引导完成后默认设置每日 21:30 复盘提醒；另支持启动行动、鼓励提醒；点击 Android 本地通知会进入对应复盘或对话场景
- Capacitor 插件：Preferences、Local Notifications、Network
- IndexedDB/Dexie：Conversation、Message、ActionTask、DailyReview、最近记录
- FastAPI：统一 AI 代理接口、DeepSeek/OpenAI-compatible 适配、SQLite 服务端记录、记录查询和服务端画像摘要
- 安全与隐私：邮箱/手机号脱敏，高风险输入前端和后端双重拦截，不发往模型，不保存原文
- 本地隐私控制：可导出本地 JSON，也可在“我的 -> 安全支持”卡片里清理 IndexedDB 中的本地记录、对话、行动卡和复盘历史；设置偏好和服务端记录不会被一起删除
- 服务端记录控制：可在“我的 -> 服务端记录”关闭后端写入；AI 请求仍会发送脱敏后的当前输入，但会带上 `serverRecordEnabled=false`，FastAPI 不写入 SQLite
- 安全支持：可信任联系人建议、12356、110、120 拨号入口
- 体验优化：PWA/Android 壳共用玻璃拟态卡片、柔和渐变背景、触控按压反馈和安全区底部导航；Vite 拆分 React、数据层、UI 和 Capacitor vendor chunk
- PWA 快速迭代：Service Worker 发现新前端版本时会在应用内提示“立即更新”；离线资源准备完成后也会提示，减少 Android 壳重复安装
- 运行时后端地址：Web/PWA/Android 壳可在“我的 -> 后端连接”修改 FastAPI API Base URL，适合内网调试、换服务器和远程前端快速迭代
- 后端连接诊断：可在“我的 -> 后端连接”一键检查 FastAPI 版本、响应耗时、当前模型、SQLite WAL/busy timeout、页数/空闲页、记录保存开关、provider 配置状态和部署预检
- 无 Key 引导：当前 provider 未配置 API Key 或 base URL 时，Web/PWA/Android 会提示进入“模型代理”查看配置；教练流程只使用本地兜底，不发起云端模型请求
- 后端流畅度：SQLite 使用 WAL、busy timeout、常用索引、分页 offset/limit 保护和 `PRAGMA user_version` schema 版本；FastAPI 中数据库读写放入线程池；前端服务端记录列表按 offset 增量加载，减少重复拉取
- 后端提示词管理：SQLite 保存 prompt override，支持按 system/scene 查询和更新；可用 `SERVER_RECORD_ENABLED=false` 关闭服务端记录
- 前端 Prompt 编辑器：Web/PWA/Android 壳可在“我的 -> 提示词管理”选择场景、编辑提示词并保存到后端
- 运行时模型切换：可在“我的 -> 模型代理”选择 provider 和 model，保存后后端下一次 AI 调用立即生效
- 服务端数据管理：可在“我的 -> 服务端数据”查看 FastAPI/SQLite 画像和最近记录，并清理服务端记录

## 目录

```text
apps/web       React PWA + Capacitor Android
services/api   FastAPI 后端
```

## 环境

- Node.js + npm
- Python 3.10+
- JDK 17
- Android SDK 35/36

说明：当前锁定 Capacitor 6，是为了兼容本机 JDK 17。Capacitor 7/8 的 Android 库会要求 Java 21。

## 配置

后端配置：

```powershell
Copy-Item .env.example .env
```

然后在 `.env` 中填写：

```text
DEEPSEEK_API_KEY=你的 key
AI_PROVIDER=deepseek
AI_MODEL=deepseek-v4-flash
```

模型切换：后端统一走 OpenAI-compatible `chat/completions` 代理。`AI_PROVIDER` 当前支持 `deepseek`、`openai`、`qwen`、`moonshot`、`zhipu`、`claude`、`gemini`、`custom`。

DeepSeek、OpenAI、Qwen、Moonshot、智谱已提供默认 base URL；Claude/Gemini 第一版按 OpenAI-compatible 网关接入，需要自行配置对应 `*_BASE_URL`。轻量健康检查 `GET /health` 会返回当前 provider/model、当前 provider 是否已配置以及已配置 provider 数量；可用状态接口 `GET /api/models/providers` 只返回 provider、base URL、是否已配置和当前激活状态，不返回 API Key。

运行时模型配置接口：

```text
GET /api/models/config
PUT /api/models/config
```

`PUT` 请求体为 `{ "provider": "deepseek", "model": "deepseek-v4-flash" }`；如果配置了 `ADMIN_TOKEN`，请求需要携带 `X-Admin-Token`。应用内可在“我的 -> 模型代理”直接修改。

客户端不会保存或展示模型 API Key。`GET /api/models/providers` 只返回 provider 是否已配置；如果当前 provider 未配置，前端会提示去模型设置，并在拖延急救、复盘和其他对话场景中直接使用本地兜底，不调用 AI 请求接口。

后端提示词管理：

```text
GET /api/prompts
GET /api/prompts/{key}
PUT /api/prompts/{key}
```

`key` 支持 `system`、`procrastination`、`encouragement`、`creation`、`relationship`、`daily_review`。`PUT` 会保存覆盖版本到 SQLite；如果配置了 `ADMIN_TOKEN`，请求需要携带 `X-Admin-Token`。服务端记录可用 `SERVER_RECORD_ENABLED=false` 关闭。

当单次 AI 请求上下文包含 `historyEnabled=false` 或 `serverRecordEnabled=false` 时，即使 `SERVER_RECORD_ENABLED=true`，后端也不会写入该次服务端记录。

也可以直接在应用内修改：进入“我的 -> 提示词管理”，选择场景，编辑提示词内容并保存。如果后端配置了 `ADMIN_TOKEN`，在保存前填写 Admin Token。

服务端记录接口：

```text
GET /readyz
GET /api/diagnostics
GET /api/records
GET /api/records/page
GET /api/records/export
GET /api/records/stats
GET /api/admin/backup
POST /api/admin/restore
POST /api/admin/maintenance
GET /api/profile/summary
DELETE /api/records
```

`POST /api/admin/maintenance` 会执行 SQLite `PRAGMA optimize` 和 WAL checkpoint，也可通过 `{ "vacuum": true }` 请求完整 `VACUUM`；如果配置了 `ADMIN_TOKEN`，请求需要携带 `X-Admin-Token`。应用内可在“我的 -> 服务端数据”点击“优化数据库”触发。

`GET /readyz` 用于部署 readiness 检查，会确认 SQLite 可连接且 schema 版本符合后端预期，不返回 API Key 或数据库路径。

`GET /api/diagnostics` 返回 API 版本、服务器时间、当前 provider/model、已配置 provider 数量、当前 provider 是否可调用、SQLite 连接状态、schema version、WAL/busy timeout、外键状态、页数/空闲页、服务端记录开关和部署预检；不会返回任何 API Key 或绝对数据库路径。

`GET /api/records` 支持 `limit`、`offset` 和可选 `scene` 分页筛选；`GET /api/records/page` 返回同样的记录列表，并附带 `total_records`、`next_offset` 和 `has_more`，供前端做更顺滑的增量加载；`GET /api/records/export` 会导出最多 200 条服务端记录，支持同样的 `scene` 筛选；`GET /api/admin/backup` 会导出完整服务端备份，包含全部记录、统计、提示词覆盖和运行时模型配置，不受 200 条分页上限截断；`POST /api/admin/restore` 可用 `merge` 或 `replace` 模式恢复完整备份；`GET /api/records/stats` 返回总量、最新写入时间、场景分布、风险分布和单页上限。`DELETE /api/records` 会清理服务端 SQLite 中的 AI 记录，并执行 `PRAGMA optimize` 与 WAL checkpoint，减少长期个人版使用中的数据库膨胀；如果配置了 `ADMIN_TOKEN`，导出、备份、恢复和清理请求都需要携带 `X-Admin-Token`。应用内可在“我的 -> 服务端数据”查看最近服务端记录、按场景筛选、导出当前筛选、导出/导入完整备份、查看数据库健康状态和画像摘要，并按 offset 追加加载更多记录。

前端 API 地址：

```powershell
Copy-Item apps\web\.env.example apps\web\.env.local
```

默认是 `http://localhost:8000`。

Android 壳和 PWA 支持运行时修改后端地址：进入“我的 -> 后端连接”，填写新的 API Base URL 后点击“保存并重连”。例如手机访问同一局域网电脑上的后端时，可填：

```text
192.168.1.5:8000
```

应用会自动规范化为 `http://192.168.1.5:8000`，并刷新后端健康检查和模型代理状态。

Android 通知：壳工程显式声明 `POST_NOTIFICATIONS`。首次引导完成或已完成引导的用户重新打开应用时，会按当前设置恢复每日复盘提醒；如果系统拒绝通知权限，设置页再次开启提醒时会显示权限错误。

## 开发运行

启动后端：

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r services\api\requirements.txt
$env:PYTHONPATH='services/api'
.\.venv\Scripts\python -m uvicorn app.main:app --reload
```

启动前端：

```powershell
npm install
npm run dev:web
```

## Android 打包

先构建并同步 Web 产物：

```powershell
npm run build:web
npm run cap:sync
```

再打 debug APK：

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot'
$env:ANDROID_HOME='D:\Android\Sdk'
$env:Path="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
cd apps\web\android
.\gradlew.bat assembleDebug --no-daemon
```

APK 输出位置：

```text
apps/web/android/app/build/outputs/apk/debug/app-debug.apk
```

## 部署

部署说明见：

```text
docs/DEPLOYMENT.md
```

完整验收清单见：

```text
docs/ACCEPTANCE.md
```

已提供：

- `services/api/Dockerfile`
- `docker-compose.yml`
- `render.yaml`
- `apps/web/vercel.json`
- `apps/web/public/_headers`
- `apps/web/public/_redirects`
- `scripts/smoke_deploy.py`
- `scripts/smoke_static_config.py`
- `scripts/generate_pwa_icons.py`
- `scripts/smoke_apk_assets.py`
- `scripts/verify_local.ps1`

Android 壳支持远程 Web 模式：

```powershell
$env:CAP_SERVER_URL='https://your-frontend-domain.example'
npm run cap:sync
```

清除 `CAP_SERVER_URL` 后重新 `cap:sync` 会回到打包本地 Web 资产模式。

也可以直接跑自动验收：它会临时切到远程 Web 模式、构建并检查 APK 中的 `server.url`，然后恢复到 bundled 模式：
```powershell
npm run smoke:android:remote-assets
```

部署后可跑远程 smoke：

```powershell
$env:SMOKE_FRONTEND_URL='https://your-frontend-domain.example'
$env:SMOKE_BACKEND_URL='https://your-backend-domain.example'
npm run smoke:deploy
```

这个检查会验证 hosted PWA 入口、manifest、service worker、FastAPI health/diagnostics、provider 注册表、服务端记录分页元信息、CORS 预检和高风险拦截。若要额外验证部署环境里的普通 AI 行动接口，可设置：

```powershell
$env:SMOKE_DEPLOY_AI='true'
npm run smoke:deploy
```

## 验证

推荐先跑完整本地验收：

```powershell
npm run verify:local
```

它会按顺序执行 Web lint、Web tests、FastAPI tests、API smoke、Web/PWA build、Android manifest smoke、Capacitor sync、Android debug APK build 和 APK asset smoke。若设置了 `DEEPSEEK_API_KEY`，会额外跑真实 DeepSeek smoke；若设置了 `SMOKE_FRONTEND_URL` 和 `SMOKE_BACKEND_URL`，会额外跑部署 smoke。

手动分步命令如下：

```powershell
npm run build:web
npm run lint:web
npm run test:web
npm run smoke:api
npm run smoke:local-deploy
npm run smoke:android:manifest
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot'
$env:ANDROID_HOME='D:\Android\Sdk'
cd apps\web\android
.\gradlew.bat assembleDebug --no-daemon
cd ..\..\..
npm run smoke:apk
$env:PYTHONPATH='services/api'
.\.venv\Scripts\python -m pytest services\api\tests
```

本机已验证：

- Web build 通过
- Web lint 通过
- Web tests 33 passed
- FastAPI tests 32 passed
- FastAPI smoke checks 通过：真实 uvicorn 进程、临时 SQLite、健康检查、兜底 AI、记录写入/不写入、分页、导出和删除
- Local deployment smoke checks 通过：构建后的静态前端、临时 FastAPI/SQLite、CORS、PWA 资源、高风险拦截和 admin 备份/恢复
- 部署 smoke 脚本已提供；需要部署后的 `SMOKE_FRONTEND_URL` 和 `SMOKE_BACKEND_URL` 才能运行
- Android manifest smoke checks 通过：`INTERNET`、`POST_NOTIFICATIONS`、不申请 `CALL_PHONE`
- Android emulator smoke checks 通过：已在 `emulator-5554` 安装 debug APK、启动应用、确认应用进入前台，并检查安装后权限
- APK asset smoke checks 通过：最终 APK 包含 Capacitor 配置、Preferences/Network/Local Notifications 插件、PWA manifest、service worker、入口 HTML 和引用的 JS/CSS 资产
- Android remote frontend asset smoke 已提供：`npm run smoke:android:remote-assets` 会验证 `CAP_SERVER_URL` 远程模式并恢复 bundled APK
- Local verification 脚本已提供：`npm run verify:local` 会按安全顺序执行本地验收，避免 `cap:sync` 与 Gradle 并行竞争
- Capacitor Android debug APK 构建通过

有真实 DeepSeek Key 时，可额外运行：

```powershell
$env:DEEPSEEK_API_KEY='...'
npm run smoke:deepseek
```

## 已知取舍

- 前端先以 Tailwind 自写组件实现 shadcn/ui 思路，暂未引入 shadcn 代码生成。
- 服务端 SQLite 已接入记录表，用户账号、云同步、多用户权限暂未做。
- 画像摘要和更多提醒类型已有基础版本，后续可继续做更细的趋势图和提醒规则。
- `npm audit` 对 Capacitor 6 依赖链报告 2 个 high severity；这是为了兼容 JDK 17 的阶段性取舍。升级 Capacitor 7/8 需要同步升级到 JDK 21。
