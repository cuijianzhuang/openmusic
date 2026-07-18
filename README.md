# 🎵 OpenMusic

<p align="center">
  <strong>多人实时在线点歌</strong><br/>
  🎧 多音源搜索 · 🔄 同步听歌 · 💬 聊天互动 · ✨ 3D 视觉 / 沉浸模式
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="MIT" />
  <img src="https://img.shields.io/badge/Deploy-Docker%20%7C%20PM2%20%7C%20宝塔-ff6b6b" alt="Deploy" />
</p>

<p align="center">
  <a href="#-快速开始">🚀 快速开始</a> ·
  <a href="#-功能概览">✨ 功能</a> ·
  <a href="docs/DEPLOY.md">📖 部署文档</a> ·
  <a href="deploy/DEPLOY-BAOTA.md">🛠️ 宝塔部署</a>
</p>

---

## 📸 项目截图

| 🏠 房间大厅 | 🎤 房间点歌 | 🎶 歌词播放 |
|:---:|:---:|:---:|
| ![大厅](docs/screenshots/home.png) | ![房间](docs/screenshots/room.png) | ![歌词](docs/screenshots/lyrics.png) |

---

## 🚀 快速开始

> 💡 **要求**：Node.js ≥ 18

### 1️⃣ 启动 Meting-API（音源）

```bash
docker pull w3126197382/meting-api:latest
docker run -d --name meting -p 3000:3000 w3126197382/meting-api:latest
```

管理后台默认 `http://localhost:3000/admin`（`admin` / `admin123`），建议配置 🔴 红点渠道 Cookie。

### 2️⃣ 启动 OpenMusic

```bash
git clone https://github.com/wqqqqqq200/openmusic.git
cd openmusic

npm run install:all
cp server/.env.example server/.env   # ✏️ 编辑必填项
npm run build
npm start                            # 🌐 http://0.0.0.0:4000
```

🔧 开发模式（前后端热更新）：

```bash
npm run dev
```

| 服务 | 地址 |
|------|------|
| 🖥️ 前端 Vite | http://localhost:5173 |
| ⚡ 后端 API / WS | http://localhost:4000 |

> ⚠️ 生产环境由**同一 Node 进程**托管 API、WebSocket 与前端静态资源。请保持**单实例**（房间状态在进程内存中）。

### 🔑 最小环境变量

```env
PORT=4000
NODE_ENV=production
CLIENT_URL=https://your-domain.com
CLIENT_ID_SECRET=换成一段长随机字符串
TRUST_PROXY=1
METING_API_URL=http://127.0.0.1:3000
METING_API_AUTH=你的meting_token
```

> 💡 `METING_API_URL` 支持英文逗号分隔多个上游，自动做**轮询负载均衡**：请求失败或返回 5xx 的上游进入 60s 冷却并切换下一个。`METING_API_AUTH` 同样逗号分隔与之一一对应（只填一个则应用到所有上游）。

| 变量 | 说明 |
|------|------|
| `CYAPI_KEY` | 🔵 可选；蓝点搜索、空队列随机推荐、聊天图片审核（[迟言 API](https://cyapi.top/)） |
| `REDIS_URL` | 🗄️ 可选；房间与热榜持久化，**强烈推荐** |
| `QINIU_*` | 🖼️ 可选；聊天发图 |
| `APIHZ_BASE_URL` | 可选；接口盒子 API 根地址，默认 `https://cn.apihz.cn/api` |
| `APIHZ_ID` / `APIHZ_KEY` | 可选；接口盒子凭证（表情包搜索、敏感词检测共用） |
| `APIHZ_IMG_*` | 可选；与 `APIHZ_ID` / `APIHZ_KEY` 等价，兼容旧配置名 |

📚 完整说明 → [docs/DEPLOY.md](docs/DEPLOY.md)

---

## ✨ 功能概览

### 🎧 听歌

- 🔴🟢🔵 多音源搜索：红点 / 绿点 / 蓝点，自选音质
- 🔄 多人实时同步播放、歌词滚动
- 🔥 网易云热歌榜（服务端缓存每 **3 小时**刷新；封面使用原图，不拼接缩略参数）
- 📋 歌单导入、个人收藏与点歌历史（JSON 导入 / 导出）
- 📺 TV 大屏：`/tv/:roomId`
- ↕️ 队列拖拽排序、🎛️ 媒体键（耳机 / 锁屏控件）
- 📱 移动端后台播放（Capacitor）

### 🏠 房间

- 🚪 大厅、🔒 密码房、🕐 最近访问、🔗 分享链接（密码可直达）
- 📢 公告、📻 FM 漫游、👑 贵宾角标、💬 聊天历史可见性
- ⚙️ 点歌规则、🚫 禁播、👎 踩歌切歌、🧹 离房清歌
- 🌿 纯净模式：隐藏动效与热榜，标签页低调伪装

### 💬 互动

- 💬 实时聊天：贴纸、发图、点评、回复 / @ / @全体、消息撤回
- 😺 微信表情包采集（本机 IndexedDB，单张 ≤ 5MB）
- 🔍 表情包搜索（接口盒子，可选）

### 🌌 视觉与客户端

- ✨ 星河 / 声波地形等 3D 背景与桌面沉浸模式
- 📱 Android / iOS（Capacitor 远程 URL 壳，前端发版无需重打包）
- 🆕 发版更新：轮询 `/api/app-version`；「立即更新」在当前页硬刷新，同一版本不会重复强弹

### ⚙️ 点歌规则（房主 / 管理员）

房间设置 → **点歌**：

| 规则 | 说明 |
|------|------|
| 🎤 允许成员点歌 | 关闭后仅房主与管理员可点 |
| ⏫ 允许成员插队 | 成员可对自己的点歌插队；管理始终可 |
| ⏳ 进房等待时间 | 新成员停留满时长后才能点歌 |
| 📊 每人最多点歌 | 队列中每人上限（含正在播放），`0` = 不限 |
| 🕐 点歌冷却 | 不限制 / 10s / 30s / 60s / 120s |
| 📏 队列长度上限 | 50 / 100 / 200 |
| 🚫 禁播歌曲 | 按歌名；同名跨平台均不可点 |
| 👎 踩歌切歌 | 按人数或在线比例切掉当前曲 |
| 🧹 退出后清除已点 | 离房超时后清除其待播 |

---

## 😺 微信表情包

1. 表情面板 →「微信表情包」→「开始采集」
2. 📱 微信扫码登录文件传输助手
3. 把表情发到文件传输助手，网页端自动入库
4. 面板中点击即可发送 🎉

| 项目 | 说明 |
|------|------|
| 💾 存储 | 本机 IndexedDB，按客户端 ID 隔离 |
| 📦 上限 | 单张 **5MB** |
| 🔌 代理 | 内置 `/wx-proxy`、`/cgi-bin`，无需额外环境变量 |
| 🌐 Nginx | `/wx-proxy/*` 勿缓存；`/cgi-bin/*` 与 `/api` 同反代 |

---

## 📱 Android / iOS

**Capacitor 远程 URL**：App 打开线上站点（与 `CLIENT_URL` 一致）。前端部署即可更新，不必每次重打安装包。iOS 用 Sideloadly / AltStore 侧载即可。

```bash
cd client
cp .env.capacitor.example .env.capacitor
# CAPACITOR_SERVER_URL=https://your-domain.com
```

| 方式 | 说明 |
|------|------|
| ☁️ GitHub Actions | **Android APK** / **iOS IPA** Workflow，填 `server_url` 后下载产物 |
| 📥 本地下载位 | 放到 `server/downloads/openmusic.apk` / `.ipa`，访问 `/downloads/...` |

```bash
cd client
npm run cap:sync:android   # 或 cap:sync:ios
npm run cap:open:android   # iOS 需 Mac + Xcode
```

---

## 🛠️ 运维要点

```nginx
# WebSocket 必须升级，否则实时同步失效
location /socket.io/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
}
```

- 🌍 限流与 IP 归属地：`TRUST_PROXY=1`；有 CDN 时设置 `CLIENT_IP_HEADER`（Cloudflare：`CF-Connecting-IP`；EdgeOne：`iqp`），并由 Nginx 透传该头
- 🆕 发版：编辑 `release-notes.json` 或执行 `npm run package:build`；CDN 勿长期缓存 `index.html` 与 `/api/*`
- 🔍 `/sitemap.xml`、`/robots.txt` 由服务端动态生成（优先 `CLIENT_URL`）
- 📄 完整 Nginx / 宝塔示例：[deploy/nginx.conf.example](deploy/nginx.conf.example)、[deploy/DEPLOY-BAOTA.md](deploy/DEPLOY-BAOTA.md)

---

## 🧱 技术栈

| 层级 | 技术 |
|------|------|
| 🖥️ 前端 | React · Vite · Tailwind CSS · Socket.IO Client · Three.js / R3F · Capacitor |
| ⚙️ 后端 | Node.js · Express · Socket.IO · Redis（可选） |

---

## 🙏 致谢

房间视觉与沉浸体验参考并融合了以下开源作品：

| 项目 | 作者 | 说明 |
|------|------|------|
| [Mineradio](https://github.com/XxHuberrr/Mineradio) | [@XxHuberrr](https://github.com/XxHuberrr) | ✨ 星河粒子、沉浸玻璃质感、舞台歌词等 |
| [sonic-topography](https://github.com/yin-yizhen/sonic-topography) | [@yin-yizhen](https://github.com/yin-yizhen) | 🌊「声波地形」着色器（请遵循原项目许可，仅限个人 / 非商业） |

## 🔗 友情链接

- [Linux.do](https://linux.do/) — 新的理想型社区 🐧

## ⚠️ 免责声明

本项目仅供学习与技术交流。不存储音频文件，音乐版权归相关权利人所有。请遵守法律法规及平台协议，不得用于商业用途。

## 📄 License

[MIT](LICENSE)
