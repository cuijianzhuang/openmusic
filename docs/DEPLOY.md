# OpenMusic 部署文档

## 快速开始

### Docker 部署（推荐）

无需克隆源码，直接拉镜像运行：

```bash
# 下载 compose 文件
curl -O https://raw.githubusercontent.com/qq01-hub/openmusic/main/docker-compose.full.yml

# 准备持久化目录
mkdir -p data/downloads
touch data/.env data/setup.lock
echo '{}' > data/runtimeConfig.json
echo '{}' > data/adminConfig.json

# 启动（全量版：Redis + Meting + OpenMusic）
docker compose -f docker-compose.full.yml up -d
```

打开 `http://<IP>:4000`，Redis / Meting 已自动填好，只需填站点域名。完成后自动重启。

> 不需要内置 Meting？下载 `docker-compose.yml` 代替。
> 更新：`docker compose pull && docker compose up -d`
> 宝塔用户：见 [宝塔部署指南](../deploy/DEPLOY-BAOTA.md)，可在 Docker 管理器里直接粘贴 compose。

有源码时也可用一键脚本：`bash deploy/deploy.sh`

### 源码部署

```bash
npm run install:all
npm run build
npm start   # http://0.0.0.0:4000
```

首次访问自动进入部署向导，填 Redis / Meting / 站点域名即可。向导自动生成密钥、管理员账号密码和 Nginx 配置片段。

> 开发模式：`npm run dev`（前端 `:5173`，后端 `:4000`）

---

## 前置依赖

| 依赖 | 必填 | 说明 |
|------|:----:|------|
| **Redis** | 必需 | 房间、收藏、管理凭据、公告、封禁均只存 Redis |
| **Meting-API** | 必填 | 红点 / 绿点搜索播放、歌词、封面、歌单导入。镜像：`w3126197382/meting-api:latest` |
| 迟言 API | 可选 | 蓝点搜索 / 播放、随机推荐。管理后台「运行配置」填写 |
| 七牛 OSS | 可选 | 聊天发图。管理后台填写 |

---

## 环境变量

向导会自动写入 `server/.env`，下表仅供参考（详见 `server/.env.example`）：

| 变量 | 必填 | 说明 |
|------|:----:|------|
| `PORT` | | 默认 `4000` |
| `NODE_ENV` | 推荐 | 生产设为 `production` |
| `CLIENT_URL` | 生产必填 | 前端 Origin（https） |
| `CLIENT_ID_SECRET` | 生产必填 | 会话签名密钥（向导自动生成） |
| `TRUST_PROXY` | 推荐 | 反代后设为 `1` |
| `CLIENT_IP_HEADER` | 有 CDN | Cloudflare：`CF-Connecting-IP`；EdgeOne：`iqp` |
| `REDIS_URL` | 必需 | Redis 连接串 |
| `METING_API_URL` | 必填 | Meting 地址，逗号分隔多上游支持负载均衡 |

生产最小配置示例：

```env
PORT=4000
NODE_ENV=production
CLIENT_URL=https://music.example.com
CLIENT_ID_SECRET=换成一段长随机字符串
TRUST_PROXY=1
REDIS_URL=redis://127.0.0.1:6379/0
METING_API_URL=http://127.0.0.1:3000
```

---

## Docker 部署细节

- 配置文件挂载到宿主机 `./data/`（`.env`、`runtimeConfig.json`、`adminConfig.json`、`setup.lock`、`downloads/`），容器重建不丢
- Docker 环境下向导自动预填 Redis / Meting，完成后自动重启
- 自定义端口：`OPENMUSIC_PORT=8080 docker compose up -d`
- 更新：`git pull && docker compose up -d --build`

---

## 推荐架构（生产）

| 层级 | 职责 |
|------|------|
| **Nginx** | 直出 `client/dist` 静态资源；SPA `try_files`；HTTPS |
| **Node `:4000`** | 仅承接 `/api/*`、`/socket.io/`、`/downloads/`、`/wx-proxy`、`/cgi-bin/`、SEO 文件 |

**不要** `location / { proxy_pass 4000; }` 全站进 Node。

---

## Nginx 配置

向导完成页会按站点域名生成可复制的 Nginx 配置。仓库内完整示例：

- 宝塔完整版：[deploy/nginx.baota-optimized.conf.example](../deploy/nginx.baota-optimized.conf.example)
- 精简通用版：[deploy/nginx.conf.example](../deploy/nginx.conf.example)

### 必配要点

1. `/socket.io/` 必须 WebSocket 升级
2. `/api/media-proxy` 写在 `/api/` 前面，关闭缓冲
3. `root` 指向 `client/dist`；`location /` 用 `try_files`
4. 有 CDN 时透传 `CLIENT_IP_HEADER`

宝塔详细步骤见 [deploy/DEPLOY-BAOTA.md](../deploy/DEPLOY-BAOTA.md)。

---

## 构建与发版

```bash
npm run build              # 构建前端 → client/dist
npm run package:build      # 交互式录入更新说明，组装 release zip
```

- `forcePrompt: true` = 强制弹窗更新；`false` = 静默发版
- CDN 勿长期缓存 `index.html` 与 `/api/*`

---

## HTTP API 速查

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/setup/status` | 是否需首次部署 |
| `GET` | `/api/app-version` | 前端版本与更新说明 |
| `GET` | `/api/rooms` | 房间列表 |
| `POST` | `/api/rooms` | 创建房间 |
| `GET` | `/api/music/toplist/netease` | 网易云热歌榜 |
| `POST` | `/api/music/playlist/import` | 导入歌单 |
| `GET` | `/api/media-proxy?url=` | HTTP 媒体代理 |

WebSocket：`/socket.io`（与 HTTP 同端口）
