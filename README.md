# OpenMusic

多人实时在线点歌系统。

支持多音源搜索点歌，房间成员实时同步播放、歌词同步、聊天互动；可选星河 / 声波地形等 3D 视觉背景与桌面端沉浸模式。

---

## 特性

* 多音源音乐搜索（红点 / 绿点 / 蓝点）与自选音质
* 多人实时同步听歌、歌词同步滚动
* 房间大厅、密码保护、最近访问、分享链接（密码房可带密码直达）
* 歌单导入与热榜、个人收藏与点歌历史（JSON 导入 / 导出）
* TV 大屏模式（`/tv/:roomId`）
* 实时聊天：表情贴纸、发图、消息点评、回复 / @ 提及与 @全体
* 聊天表情包搜索（接口盒子，可选）、微信表情包采集（本机存储）
* 纯净模式（隐藏动效与热榜、标签页低调伪装）
* 房间设置：公告、FM 漫游、贵宾角标、点歌规则与禁播
* 点歌防刷：冷却、每人待播上限、队列长度上限；支持成员插队、踩歌切歌、离房清歌
* 队列手动排序（拖拽锁定顺序）、系统媒体键绑定（耳机键 / 锁屏控件）
* 房间视觉背景与沉浸模式（全屏视觉、边缘滑出面板）
* Redis 持久化（可选）
* Android / iOS 客户端（Capacitor 远程 URL 壳）

### 房间点歌规则（房主 / 管理员）

在 **房间设置 → 点歌** 中可配置：

| 规则 | 说明 |
|------|------|
| 允许成员点歌 | 关闭后仅房主与管理员可点歌 |
| 允许成员插队 | 开启后成员可对自己的点歌插队；房主 / 管理员始终可 |
| 进房等待时间 | 新成员需停留一定时间后才能点歌 |
| 每人最多点歌 | 队列中每人最多保留几首（含正在播放），0 为不限制 |
| 点歌冷却 | 不限制 / 10秒 / 30秒 / 60秒 / 120秒 |
| 队列长度上限 | 50 / 100 / 200 首 |
| 禁播歌曲 | 按歌名禁播；同名跨平台均不可点入 |
| 踩歌切歌 | 按固定人数或在线比例切掉当前曲 |
| 退出后清除已点 | 成员离房超过等待时间后清除其待播点歌 |

### 微信表情包

聊天表情面板提供 **微信表情包** Tab，可将手机微信里的表情采集到本机，并在房间内发送。

1. 打开表情面板 →「微信表情包」→「开始采集」
2. 用微信扫一扫登录「文件传输助手」
3. 在手机微信把表情发给文件传输助手，网页端自动保存
4. 采集完成后在面板中点击即可发送

| 项目 | 说明 |
|------|------|
| 存储 | 本机 IndexedDB，按客户端 ID 隔离；换浏览器或清缓存需重新采集 |
| 大小限制 | 单张发送上限 **5MB** |
| 服务端 | 内置 `/wx-proxy` 与 `/cgi-bin` 代理，无需额外环境变量 |
| CDN / Nginx | `/wx-proxy/*` 勿缓存；`/cgi-bin/*` 需反代到 Node（与 `/api` 相同） |

---

## 项目截图

### 房间大厅

![大厅](docs/screenshots/home.png)

### 房间点歌

![房间](docs/screenshots/room.png)

### 歌词播放

![歌词](docs/screenshots/lyrics.png)

---

## 快速部署

**要求**：Node.js >= 18

### Docker（Meting-API）

音源接口使用 [qq01-hub/Meting-API](https://github.com/qq01-hub/Meting-API)：

```bash
docker pull w3126197382/meting-api:latest
docker run -d --name meting -p 3000:3000 w3126197382/meting-api:latest
```

建议在管理后台（`/admin`，默认 `admin` / `admin123`）配置红点渠道 Cookie。  
蓝点与空队列随机推荐需配置 `CYAPI_KEY`（[迟言 API](https://cyapi.top/)）。Redis 推荐开启，用于房间与热榜持久化。

### 启动 OpenMusic

```bash
git clone https://github.com/wqqqqqq200/openmusic.git
cd openmusic

npm run install:all
cp server/.env.example server/.env
npm run build
npm start
```

生产环境由同一 Node 进程托管 API、WebSocket 与前端静态资源，默认 `http://0.0.0.0:4000`。

开发模式：

```bash
npm run dev
```

| 服务 | 地址 |
|------|------|
| 前端（Vite） | http://localhost:5173 |
| 后端 | http://localhost:4000 |

### 环境变量

```env
PORT=4000
NODE_ENV=production
CLIENT_URL=https://your-domain.com
CLIENT_ID_SECRET=your-secret
METING_API_URL=http://127.0.0.1:3000
METING_API_AUTH=your-meting-token
CYAPI_KEY=your-cyapi-key          # 可选，蓝点 + 随机推荐
REDIS_URL=redis://127.0.0.1:6379/0 # 可选，房间持久化

# 聊天发图（可选）
# QINIU_ACCESS_KEY=
# QINIU_SECRET_KEY=
# QINIU_BUCKET=
# QINIU_DOMAIN=https://cdn.example.com
# QINIU_ZONE=z0

# 聊天表情包搜索（可选，接口盒子）
# APIHZ_IMG_ID=
# APIHZ_IMG_KEY=
```

完整配置、Nginx、宝塔部署见 [docs/DEPLOY.md](docs/DEPLOY.md)、[deploy/DEPLOY-BAOTA.md](deploy/DEPLOY-BAOTA.md)。

> 请保持**单实例**运行（房间状态在进程内存中）。Nginx 须为 `/socket.io` 配置 WebSocket 升级，并正确转发 `X-Forwarded-For`。

`/sitemap.xml` 与 `/robots.txt` 由服务端动态生成，优先使用 `CLIENT_URL`，无需额外配置。

---

## Android / iOS 客户端

采用 **Capacitor 远程 URL 模式**：App 内 WebView 打开线上站点（与 `CLIENT_URL` 一致）。前端更新只需部署服务器，不必每次重打安装包。iOS 不上架 App Store，用 Sideloadly / AltStore 侧载即可。

### 1. 配置远程地址

```bash
cd client
cp .env.capacitor.example .env.capacitor
```

编辑 `CAPACITOR_SERVER_URL=https://your-domain.com`（须 HTTPS；Android 局域网调试可用 `http://`）。

### 2. GitHub Actions 云端打包（推荐）

- **Android**：Actions → **Android APK** → 填 `server_url`，选 `debug`，下载 Artifacts 中的 `openmusic.apk`
- **iOS**：Actions → **iOS IPA** → 下载未签名 IPA，用 [Sideloadly](https://sideloadly.io/) 安装并信任开发者（免费证书约 7 天过期，重签即可）

### 3. 部署供用户下载

将安装包放到：

```text
server/downloads/openmusic.apk
server/downloads/openmusic.ipa
```

访问地址：`/downloads/openmusic.apk`、`/downloads/openmusic.ipa`。首页桌面端显示下载按钮。

### 4. 本地同步（可选）

```bash
cd client
npm run cap:sync:android   # 或 cap:sync:ios
npm run cap:open:android   # 或 cap:open:ios（需 Mac + Xcode）
```

---

## 技术栈

**Frontend**：React · Vite · TailwindCSS · Socket.IO Client · Three.js / R3F · Capacitor  

**Backend**：Node.js · Express · Socket.IO · Redis（可选）

---

## 致谢

本项目的房间视觉与沉浸体验，参考并融合了以下开源作品：

| 项目 | 作者 | 说明 |
|------|------|------|
| [Mineradio](https://github.com/XxHuberrr/Mineradio) | [@XxHuberrr](https://github.com/XxHuberrr) | 星河粒子、沉浸玻璃质感、舞台歌词等视觉方案参考 |
| [sonic-topography](https://github.com/yin-yizhen/sonic-topography) | [@yin-yizhen](https://github.com/yin-yizhen) | 「声波地形」着色器与音频地形逻辑参考（请遵循原项目许可，仅限个人 / 非商业使用） |

---

## 友情链接

* [Linux.do](https://linux.do/) — 新的理想型社区

---

## 免责声明

本项目仅供学习与技术交流使用。不存储任何音频文件，音乐版权归相关权利人所有。请遵守相关法律法规及平台服务协议，不得用于商业用途。

## License

MIT
