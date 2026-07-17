# OpenMusic 部署文档

## 前置依赖

### 1. Meting-API（必填）

红点 / 绿点播放、歌词、封面、歌单搜索与导入均依赖 Meting-API。

接口项目：[qq01-hub/Meting-API](https://github.com/qq01-hub/Meting-API)

```bash
docker pull w3126197382/meting-api:latest
docker run -d --name meting -p 3000:3000 w3126197382/meting-api:latest
```

建议在 Meting 管理后台（`/admin`，默认 `admin` / `admin123`）配置红点渠道 Cookie。

### 2. 迟言 API Key（可选）

用于**蓝点**搜索/播放、**队列为空随机推荐**（wyrp）。不配置时红点与绿点仍可用，蓝点与随机推荐不可用。

在 [迟言 API](https://cyapi.top/) 注册获取 `CYAPI_KEY`。

### 3. Redis（推荐）

配置后启用房间歌单、播放进度、个人收藏持久化；未配置则仅内存，重启后丢失。

---

## 环境变量

在 `server/.env` 中配置（参考 `server/.env.example`）：

| 变量 | 必填 | 说明 |
|------|:----:|------|
| `PORT` | | 服务端口，默认 `4000` |
| `NODE_ENV` | 生产推荐 | 设为 `production` |
| `CLIENT_URL` | 生产必填 | 允许的前端 Origin，多个用英文逗号分隔（必须 https） |
| `CLIENT_ID_SECRET` | 生产必填 | 浏览器会话签名密钥，**重启后不要变化** |
| `SESSION_TTL_SEC` | | 会话有效期（秒），默认 90 天；bootstrap 临近过期会静默续签 |
| `TRUST_PROXY` | 生产推荐 | 设为 `1`：信任反代/CDN 回源头做限流与定位 |
| `CLIENT_IP_HEADER` | EdgeOne 等 CDN | 自定义客户端 IP 头名，默认 `iqp`（优先于 `X-Real-IP`） |
| `METING_API_URL` | 必填 | Meting-API 地址 |
| `METING_API_AUTH` | 推荐 | Meting 的 `auth` 令牌 |
| `CYAPI_KEY` | 可选 | 迟言 API Key（蓝点 + 随机推荐） |
| `CYAPI_BASE` | 可选 | 迟言 API 根地址，默认 `https://cyapi.top/API` |
| `REDIS_URL` | 可选 | Redis 连接串 |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` 等 | 可选 | 与 `REDIS_URL` 二选一 |

### 传输安全说明

- **加密依赖 HTTPS/TLS**（由 Nginx 终止）。不要在业务层再套一层请求体加密：徒增 CPU，且密钥分发难，收益低于正确配置 TLS。
- Node 进程只监听本机 HTTP；浏览器应始终走 `https://` / `wss://`。
- 身份为 HttpOnly Cookie + HMAC（带签发时间）；设备恢复仅认 HttpOnly `openmusic_did`，localStorage 中的 deviceId **不能**单独领回账号。
- `/api/media-proxy` 等开放代理需有效会话，且仅允许音乐 CDN 域名，并手动校验重定向以防 SSRF。

### 生产最小配置（仅红点）

```env
PORT=4000
NODE_ENV=production
CLIENT_URL=https://music.example.com
CLIENT_ID_SECRET=换成一段长随机字符串
TRUST_PROXY=1
METING_API_URL=http://127.0.0.1:3000
METING_API_AUTH=你的meting_token
```

### 三平台完整配置

```env
PORT=4000
NODE_ENV=production
CLIENT_URL=https://your-domain.com
CLIENT_ID_SECRET=换成一段长随机字符串
TRUST_PROXY=1
METING_API_URL=http://127.0.0.1:3000
METING_API_AUTH=你的meting_token
CYAPI_KEY=你的迟言apikey
REDIS_URL=redis://127.0.0.1:6379/0
```

---

## 部署方式

### Node 直接托管

生产环境由 **同一 Node 进程** 托管 API、WebSocket 与 `client/dist` 静态资源。

### SEO

页面 `canonical`、Open Graph 等标签在浏览器端按**当前访问域名**自动写入；`/sitemap.xml` 与 `/robots.txt` 由 Node 服务动态生成（优先 `CLIENT_URL`），无需单独配置前端环境变量。

```bash
npm run install:all
npm run build
cp server/.env.example server/.env
# 编辑 server/.env

npm start
```

打包命令：

| 命令 | 说明 |
|------|------|
| `npm run build` | 构建前端 → `client/dist`（写入 `version.json`，资源带 hash） |
| `npm run package:build` | 录入更新说明后组装 `release/openmusic-build.zip` |

### 发版与更新提示

1. 编辑根目录 [`release-notes.json`](../release-notes.json)，或执行 `npm run package:build` 时按提示逐行输入更新内容。
2. 构建会生成 `client/dist/version.json`（`buildId` + `notes`），并注入到前端。
3. 用户打开站点后会轮询 `GET /api/app-version`（走 API、禁止缓存）；发现新版本弹窗提示「立即更新」强制刷新。
4. **EdgeOne / CDN**：请对 `/api/*` 动态回源；`index.html` 不要长期缓存。资源已带 content hash，发版后旧 JS 不会被当成新文件。发版后建议在 EdgeOne 刷新一次 HTML。

也可非交互打包：

```bash
# Windows PowerShell
$env:RELEASE_NOTES="修复播放同步;聊天撤回优化"; npm run package:build
```

### 宝塔 / PM2

详细步骤见 [deploy/DEPLOY-BAOTA.md](../deploy/DEPLOY-BAOTA.md)。

**请保持单实例运行**（房间状态在进程内存中，多实例会导致同步异常）。

---

## Nginx 反向代理

**必须**为 `/socket.io` 配置 WebSocket 升级，否则实时同步失效：

```nginx
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

完整示例：[deploy/nginx.conf.example](../deploy/nginx.conf.example)

> 限流、IP 归属地等功能依赖反代正确转发客户端 IP。EdgeOne 请在控制台开启「客户端 IP 头部」并设为 `iqp`（或与 `CLIENT_IP_HEADER` 一致）；Nginx 需原样透传该头。否则回退 `X-Real-IP` / `X-Forwarded-For`。

---

## HTTP API 速查

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/app-version` | 前端版本与更新说明（no-store） |
| `GET` | `/api/rooms` | 房间列表 |
| `POST` | `/api/rooms` | 创建房间 |
| `GET` | `/api/music/toplist/netease` | 网易云热歌榜 |
| `POST` | `/api/music/playlist/import` | 导入歌单 |
| `GET` | `/api/media-proxy?url=` | HTTP 媒体同源代理 |

WebSocket 连接：`/socket.io`（与 HTTP 同端口）

主要事件：`join_room`、`add_song`、`toggle_play`、`seek`、`send_chat`、`toggle_chat_reaction`、`room_update`、`playback_state`、`chat_message`
