# 宝塔面板部署指南

## 一、本地构建

在项目根目录执行：

```bash
npm run install:all   # 首次需要
npm run package:build # 录入更新说明并打包（推荐）
# 或仅构建前端：
# npm run build         # → client/dist + version.json
```

发版后若使用 **EdgeOne**：`/api/*` 动态回源；刷新 HTML 缓存。仅当 `release-notes.json` 中 `forcePrompt: true` 时，用户会收到站内「发现新版本」弹窗；非紧急可设为 `false` 静默发版。

需要上传的文件/目录：

- `server/` — 后端代码（不含 `node_modules`、`.env`）
- `client/dist/` — 前端静态文件
- `deploy/` — PM2 与 Nginx 配置示例

---

## 二、上传到服务器

1. 宝塔 → **文件** → 上传到例如 `/www/wwwroot/openmusic`
2. 确保目录结构如下：

```
/www/wwwroot/openmusic/
├── server/          # Node 后端
├── client/dist/     # 前端（已构建）
└── deploy/          # PM2、Nginx 示例
```

---

## 三、安装 Node 依赖并完成首次配置

宝塔 → **终端**（或 SSH）：

```bash
cd /www/wwwroot/openmusic/server
npm install --production
```

用 PM2 / 宝塔先把 Node 跑起来（见下一节），浏览器打开域名会进入**首次部署向导**：填写 Redis、Meting、站点地址即可，**无需手写 `.env`**。完成后页会弹出推荐 Nginx 配置。

若坚持手改环境变量：

```bash
cp .env.example .env
nano .env
```

### `.env` 关键项（向导通常已写好）

```env
PORT=4000
CLIENT_URL=https://你的域名.com
CLIENT_ID_SECRET=换成一段长随机字符串
TRUST_PROXY=1
REDIS_URL=redis://127.0.0.1:6379/0
METING_API_URL=http://你的meting地址:3000
METING_API_AUTH=你的token
```

> `CLIENT_URL` 填最终访问的 **https 域名**，不要带末尾斜杠。

---

## 四、用 PM2 启动

```bash
cd /www/wwwroot/openmusic
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup   # 按提示设置开机自启
```

或在宝塔 → **Node 项目 / PM2** 添加（二选一）：

**方式 A（推荐，最省事）**

| 项 | 填写 |
|----|------|
| 运行目录 | `/www/openmusic/server` |
| 启动文件 | `index.js` |
| 项目名称 | `openmusic` |
| 端口 | `4000` |

**方式 B（使用 PM2 配置文件）**

| 项 | 填写 |
|----|------|
| 运行目录 | `/www/openmusic/deploy` |
| 启动文件 | `ecosystem.config.cjs` |
| 项目名称 | `openmusic`（不要叫 deploy） |

> 方式 B 要求宝塔用 `pm2 start` 加载配置文件，而不是 `node` 直接执行。若启动报错，请改用方式 A。

或在宝塔 → **Node 项目** → 添加项目（方式 A）：

- 项目路径：`/www/wwwroot/openmusic/server`
- 启动文件：`index.js`
- 端口：`4000`（与 `.env` 一致）

---

## 五、Nginx：静态直出 + 动态回 Node

宝塔 → **网站** → 添加站点（你的域名）→ **设置** → **配置文件**

**推荐**：用首次部署完成页弹出的 Nginx 配置（可改项目根目录后一键复制），或对照：

- [deploy/nginx.baota-optimized.conf.example](nginx.baota-optimized.conf.example)（完整宝塔版）
- [deploy/nginx.conf.example](nginx.conf.example)（精简版）
- 说明文档：[docs/DEPLOY.md](../docs/DEPLOY.md)

要点：

1. `root` 指向 `…/client/dist`，**不要** `location / { proxy_pass 4000; }`
2. **必须**配置 `/socket.io/` 的 WebSocket，否则房间无法实时同步
3. `/api/media-proxy` 写在 `/api/` 前并关闭缓冲（蓝点 HTTP 音链）
4. `/api/`、`/downloads/`、`/wx-proxy`、`/cgi-bin/`、`robots.txt`、`sitemap.xml` 反代到 `127.0.0.1:4000`

若使用 HTTPS，在宝塔申请 SSL 即可，反代地址仍用 `http://127.0.0.1:4000`。

保存后执行：`nginx -t && nginx -s reload`。

---

## 六、验证

1. 浏览器打开 `https://你的域名.com`
2. 创建房间、搜索点歌
3. 电视投屏页：`https://你的域名.com/tv/房间号`

---

## 常见问题

| 问题 | 处理 |
|------|------|
| 页面能开但无法加入房间 | 检查 Nginx 是否配置 `socket.io` WebSocket |
| 蓝点（酷狗）播放卡顿 | ① `/api/media-proxy` 加 `proxy_buffering off`（示例已写）② EdgeOne 对 `/api/*` 动态回源、不缓存 ③ 部署含 `mediaProxy.js` 流式 `no-store` 头的服务端版本 ④ 勿把酷狗链升 https |
| `ERR_HTTP2_PROTOCOL_ERROR` + 206 | ① 更新 `mediaProxy.js`（流式不写 `Content-Length`）② Nginx 加 `proxy_set_header Connection ""`、`gzip off`、`proxy_force_ranges on` ③ EdgeOne 对 `/api/media-proxy` 动态回源、不缓存 206 |
| 搜不到歌 / 无法播放 | 检查 `METING_API_URL`、`CYAPI_KEY` |
| 502 | PM2 是否运行：`pm2 list` |
| 端口冲突 | 修改 `.env` 的 `PORT` 和 Nginx 反代端口 |
| 浏览器提示「部分内容不安全」 | 确保用 **https** 访问；重新 `npm run build` 部署最新前端（已走同源媒体代理） |

---

## 更新部署

本地重新 `npm run build`，上传覆盖 `server/` 和 `client/dist/`，然后：

```bash
cd /www/wwwroot/openmusic/server
npm install --production
pm2 restart openmusic
```

前端静态资源已改为**固定文件名**（如 `assets/Room.js`），源站对 `index.html` 与 `/assets/*` 返回 `Cache-Control: no-cache`。  
若挂了 EO / CDN 缓存，建议在控制台将 **HTML 与 `/assets/*` 设为跟随源站** 或 **不缓存**，发版后无需每次手动清缓存。
