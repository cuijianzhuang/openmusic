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

可在首次部署后到管理后台「运行配置」填写，或注册 [迟言 API](https://cyapi.top/) 获取 Key。

### 3. Redis（必需）

房间歌单、播放进度、个人收藏、管理员凭据、站点公告、封禁与审计均只存 Redis。

未配置 Redis 时服务进入**首次部署向导**（`/setup`）；配置完成并重启后，未连上 Redis 将拒绝启动。

---

## 快速开始

生产推荐流程：**构建 → 启动 Node → 打开站点走向导 → 配置 Nginx → 重启**。

```bash
npm run install:all
npm run build
# 可先不写 .env；首次访问会进入部署向导
npm start   # http://0.0.0.0:4000
```

浏览器访问站点（或直连 `:4000`）会自动进入 **首次部署页**：填 Redis / Meting / 站点地址即可，向导自动生成会话密钥、写入 `server/.env`、随机管理员账号密码、锁定安装入口，**完成页还会弹出推荐 Nginx 片段**。全程无需手改配置文件；本文档只作为向导之外的**参考**（环境变量、Nginx、API 等）。

> 本地开发：`npm run dev`（前端 `:5173`，后端 `:4000`）。若已存在有效 `.env` / 安装锁，不会再进向导。

---

## 环境变量

向导会自动写入 `server/.env`；下表供排查或手动微调时对照（也可参考 `server/.env.example`）：

| 变量 | 必填 | 说明 |
|------|:----:|------|
| `PORT` | | 服务端口，默认 `4000` |
| `NODE_ENV` | 生产推荐 | 设为 `production` |
| `CLIENT_URL` | 生产必填 | 允许的前端 Origin，多个用英文逗号分隔（必须 https） |
| `CLIENT_ID_SECRET` | 生产必填 | 浏览器会话签名密钥，**重启后不要变化**（向导自动生成） |
| `SESSION_TTL_SEC` | | 会话有效期（秒），默认 90 天；bootstrap 临近过期会静默续签 |
| `TRUST_PROXY` | 生产推荐 | 设为 `1`：信任反代/CDN 回源头做限流与定位 |
| `CLIENT_IP_HEADER` | 有 CDN 时必填 | CDN 回源真实客户端 IP 头名。Cloudflare：`CF-Connecting-IP`；EdgeOne：`iqp` |
| `DEPLOYMENT_MODE` | 推荐 | `production`（默认）强制安全 Cookie 和 API 签名；`test` 允许普通 HTTP 测试访问，禁止用于正式公网环境 |
| `ALLOW_INSECURE_HTTP_API` / `ALLOW_INSECURE_COOKIES` | 旧版兼容 | 细粒度 HTTP 兼容开关；新部署请改用 `DEPLOYMENT_MODE=test` |
| `METING_API_URL` | 必填 | Meting-API 地址（向导或后台可改） |
| `METING_API_AUTH` | 推荐 | Meting 的 `auth` 令牌 |
| `CYAPI_KEY` | 可选 | 迟言 API Key（蓝点 + 随机推荐）；建议在后台填 |
| `CYAPI_BASE` | 可选 | 迟言 API 根地址，默认 `https://cyapi.top/API` |
| `REDIS_URL` | 必需 | Redis 连接串（与下方分项二选一；向导写入） |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` 等 | 二选一 | 与 `REDIS_URL` 二选一 |

### 首页站点公告

在站点管理后台编辑与启停（管理员账号由部署向导创建，凭据存 Redis）。公告跨重启持久化。勾选「作为新公告发布」会生成新的 `id`，已读用户会再次弹窗。

### 传输安全说明

- **加密依赖 HTTPS/TLS**（由 Nginx 终止）。不要在业务层再套一层请求体加密。
- Node 进程只监听本机 HTTP；浏览器应始终走 `https://` / `wss://`。
- 身份为 HttpOnly Cookie + HMAC；设备恢复仅认 HttpOnly `openmusic_did`。
- `/api/media-proxy` 等开放代理需有效会话，且仅允许音乐 CDN 域名。

### 生产最小配置示例（向导等价结果）

```env
PORT=4000
NODE_ENV=production
CLIENT_URL=https://music.example.com
CLIENT_ID_SECRET=换成一段长随机字符串
TRUST_PROXY=1
REDIS_URL=redis://127.0.0.1:6379/0
METING_API_URL=http://127.0.0.1:3000
METING_API_AUTH=你的meting_token
```

---

## 部署方式

### 推荐架构（生产）

| 层级 | 职责 |
|------|------|
| **Nginx** | 直出 `client/dist` 静态资源；SPA `try_files`；HTTPS |
| **Node `:4000`** | 仅承接 `/api/*`、`/socket.io/`、`/downloads/`、`/wx-proxy`、`/cgi-bin/`、`robots.txt`、`sitemap.xml` |

**不要**再写 `location / { proxy_pass 4000; }` 把整站丢进 Node，否则前端会明显变慢。

### SEO

页面 `canonical`、Open Graph 等标签在浏览器端按**当前访问域名**自动写入；`/sitemap.xml` 与 `/robots.txt` 由 Node 动态生成（优先 `CLIENT_URL`）。

### 构建与发版

```bash
npm run install:all
npm run build
npm start
```

| 命令 | 说明 |
|------|------|
| `npm run build` | 构建前端 → `client/dist`（写入 `version.json`，资源带 hash） |
| `npm run package:build` | 录入更新说明后组装 `release/openmusic-build.zip` |

### 发版与更新提示

1. 编辑根目录 [`release-notes.json`](../release-notes.json)，或执行 `npm run package:build` 时按提示录入更新说明，并选择是否**强制提示**。
2. **`forcePrompt`**：`true` = 紧急更新，弹窗强制提示；`false`（默认）= 静默发版。
3. 构建会生成 `client/dist/version.json`（`buildId` + `notes` + `forcePrompt`）。
4. 用户轮询 `GET /api/app-version`；仅 `forcePrompt=true` 时弹窗「立即更新」硬刷新。
5. **EdgeOne / CDN**：请对 `/api/*` 动态回源；`index.html` 不要长期缓存。发版后建议刷新一次 HTML。

也可非交互打包：

```bash
# Windows PowerShell — 普通发版（不弹窗）
$env:RELEASE_NOTES="修复播放同步;聊天撤回优化"
$env:RELEASE_FORCE_PROMPT="0"
npm run package:build

# 紧急更新（强制弹窗）
$env:RELEASE_NOTES="重要安全修复"
$env:RELEASE_FORCE_PROMPT="1"
npm run package:build
```

### 宝塔 / PM2

详细步骤见 [deploy/DEPLOY-BAOTA.md](../deploy/DEPLOY-BAOTA.md)。

**请保持单实例运行**（房间实时状态在进程内存热缓存，多实例会导致同步异常；持久化依赖 Redis）。

### 一键部署脚本

[`deploy/deploy.sh`](../deploy/deploy.sh) 支持两种部署方式，交互选择或直接传参：

```bash
bash deploy/deploy.sh          # 交互式选择
bash deploy/deploy.sh docker   # Docker 部署（自带 Redis 容器，推荐）
bash deploy/deploy.sh source   # 源码部署（PM2 常驻进程，需自行提供 Redis）
```

**Docker 部署**：脚本会用根目录 [`Dockerfile`](../Dockerfile) 和 [`docker-compose.yml`](../docker-compose.yml) 构建镜像并拉起 `openmusic` + `redis` 两个容器。

- `.env`、`runtimeConfig.json`、`adminConfig.json`、`setup.lock`、`downloads/` 会挂载到宿主机的 `./data/` 目录，容器重建不丢配置
- 首次访问 `http://<服务器IP>:4000/setup` 完成向导时，**Redis 主机名填 `redis`、端口 `6379`**（compose 内部服务名，不是公网地址）
- 向导完成后需要手动重启一次容器才能生效：`docker compose restart openmusic`（因为 `.env` 只在进程启动时读取一次）
- 更新代码后重新部署：`git pull && bash deploy/deploy.sh docker`（等价于 `docker compose up -d --build`）
- 自定义端口：`OPENMUSIC_PORT=8080 bash deploy/deploy.sh docker`
- 音源（Meting-API / chksz）仍按需在向导或管理后台配置，Docker 编排本身不含音源容器

**源码部署**：脚本会执行 `npm run install:all && npm run build`，检测/安装 PM2，并用 [`deploy/ecosystem.config.cjs`](../deploy/ecosystem.config.cjs) 启动常驻进程；此模式下 Redis 需要你自行安装或另起容器，并在 `/setup` 向导中按实际地址填写。

---

## Nginx 反向代理

**原则**：静态 Nginx 直出，动态回 Node。

向导完成页会按你填写的站点域名生成一份可复制配置；仓库内完整示例：

- 宝塔完整版（推荐对照）：[deploy/nginx.baota-optimized.conf.example](../deploy/nginx.baota-optimized.conf.example)
- 精简通用版：[deploy/nginx.conf.example](../deploy/nginx.conf.example)

### 必配要点

1. **`/socket.io/`** 必须 WebSocket 升级，否则房间无法实时同步  
2. **`/api/media-proxy`** 写在 `/api/` 前面，关闭缓冲（蓝点 HTTP 音链流式转发）  
3. **`root`** 指向 `…/client/dist`；`location /` 用 `try_files`，不要全站 `proxy_pass`  
4. 有 CDN 时透传 `CLIENT_IP_HEADER`（如 EdgeOne 的 `iqp`）

### 宝塔示例（路径按实际修改）

下面以项目根目录 `/www/sjbmusic`、域名 `m.qqovo.cn`、Node `127.0.0.1:4000` 为例。保存后执行：`nginx -t && nginx -s reload`。

```nginx
# 基于你当前宝塔配置修改：静态 Nginx 直出，动态回 Node
# 前端：/www/sjbmusic/client/dist
# 后端：/www/sjbmusic/server → 127.0.0.1:4000
# 保存后执行：nginx -t && nginx -s reload

proxy_cache_path /www/sjbmusic/proxy_cache_dir levels=1:2 keys_zone=m_qqovo_cn_cache:20m inactive=1d max_size=5g;

server {
    listen 80;
    listen 443 ssl;
    listen 443 quic;
    http2 on;
    listen [::]:80;
    server_name m.qqovo.cn;

    # ★ 改成前端目录（你文件已在这里）
    root /www/sjbmusic/client/dist;
    index index.html;

    include /www/server/panel/vhost/nginx/extension/m.qqovo.cn/*.conf;

    #CERT-APPLY-CHECK--START
    # 用于SSL证书申请时的文件验证相关配置 -- 请勿删除
    include /www/server/panel/vhost/nginx/well-known/m.qqovo.cn.conf;
    #CERT-APPLY-CHECK--END

    #SSL-START SSL相关配置，请勿删除或修改下一行带注释的404规则
    #error_page 404/404.html;

    #HTTP_TO_HTTPS_START
    set $isRedcert 1;
    if ($server_port != 443) {
        set $isRedcert 2;
    }
    if ( $uri ~ /\.well-known/ ) {
        set $isRedcert 1;
    }
    if ($isRedcert != 1) {
        rewrite ^(/.*)$ https://$host$1 permanent;
    }
    #HTTP_TO_HTTPS_END

    ssl_certificate /www/server/panel/vhost/cert/m.qqovo.cn/fullchain.pem;
    ssl_certificate_key /www/server/panel/vhost/cert/m.qqovo.cn/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers EECDH+CHACHA20:EECDH+CHACHA20-draft:EECDH+AES128:RSA+AES128:EECDH+AES256:RSA+AES256:EECDH+3DES:RSA+3DES:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_tickets on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    add_header Strict-Transport-Security "max-age=31536000";
    add_header Alt-Svc 'quic=":443"; h3=":443"; h3-29=":443"; h3-27=":443";h3-25=":443"; h3-T050=":443"; h3-Q050=":443";h3-Q049=":443";h3-Q048=":443"; h3-Q046=":443"; h3-Q043=":443"';
    error_page 497 https://$host$request_uri;
    #SSL-END
	#引用重定向规则，注释后配置的重定向代理将无效
	include /www/server/panel/vhost/nginx/redirect/m.qqovo.cn/*.conf;


    #REDIRECT START
    #REDIRECT END

    #ERROR-PAGE-START
    #error_page 404 /404.html;
    #error_page 502 /502.html;
    #ERROR-PAGE-END

    #PHP-INFO-START  Node 站不需要 PHP，注释掉避免干扰
    # include enable-php-00.conf;
    #PHP-INFO-END

    #IP-RESTRICT-START
    #IP-RESTRICT-END

    #BASICAUTH START
    #BASICAUTH END

    #SUB_FILTER START
    #SUB_FILTER END

    #GZIP START
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 4;
    gzip_min_length 1024;
    gzip_types
        text/plain
        text/css
        text/xml
        application/javascript
        application/x-javascript
        application/json
        application/xml
        application/rss+xml
        image/svg+xml
        font/ttf
        font/otf
        application/font-woff
        application/font-woff2;
    #GZIP END

    #GLOBAL-CACHE START
    #GLOBAL-CACHE END

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;

    #WEBSOCKET-SUPPORT START
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    #WEBSOCKET-SUPPORT END

    #PROXY-CONF-START

    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header iqp $http_iqp;
        proxy_buffering off;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # 必须写在 /api 前面
    location ^~ /api/media-proxy {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Range $http_range;
        proxy_set_header If-Range $http_if_range;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_max_temp_file_size 0;
        proxy_force_ranges on;
        gzip off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location ^~ /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }

    location ^~ /downloads/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    location ^~ /wx-proxy {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ^~ /cgi-bin/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /robots.txt {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /sitemap.xml {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ★ 静态直出（本项目 assets 固定文件名，禁止长期缓存）
    location ^~ /assets/ {
    expires 1d;
    add_header Cache-Control "public, max-age=86400" always;
    access_log off;
    try_files $uri =404;
    }

    location ^~ /qface/ {
        expires 7d;
        add_header Cache-Control "public, max-age=604800" always;
        access_log off;
        try_files $uri =404;
    }

    location ^~ /vendor/ {
        expires 30d;
        add_header Cache-Control "public, max-age=2592000" always;
        access_log off;
        try_files $uri =404;
    }

    location = /favicon.svg {
        expires 7d;
        add_header Cache-Control "public, max-age=604800" always;
        access_log off;
    }

    location = /og-cover.png {
        expires 7d;
        add_header Cache-Control "public, max-age=604800" always;
        access_log off;
    }

    # ★ 删掉原来的 location ^~ / { proxy_pass 4000; }
    #    改成 SPA 静态回退，不再全站进 Node
    location / {
        add_header Cache-Control "no-cache, must-revalidate" always;
        try_files $uri $uri/ /index.html;
    }

    #PROXY-CONF-END

    #SERVER-BLOCK START
    #SERVER-BLOCK END

    # 禁止访问的敏感文件
    location ~* (\.user.ini|\.htaccess|\.htpasswd|\.env.*|\.project|\.bashrc|\.bash_profile|\.bash_logout|\.DS_Store|\.gitignore|\.gitattributes|LICENSE|README\.md|CLAUDE\.md|CHANGELOG\.md|CHANGELOG|CONTRIBUTING\.md|TODO\.md|FAQ\.md|composer\.json|composer\.lock|package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|\.\w+~|\.swp|\.swo|\.bak(up)?|\.old|\.tmp|\.temp|\.log|\.sql(\.gz)?|docker-compose\.yml|docker\.env|Dockerfile|\.csproj|\.sln|Cargo\.toml|Cargo\.lock|go\.mod|go\.sum|phpunit\.xml|phpunit\.xml|pom\.xml|build\.gradl|pyproject\.toml|requirements\.txt|application(-\w+)?\.(ya?ml|properties))$ {
        return 404;
    }

    # 禁止访问的敏感目录
    location ~* /(\.git|\.svn|\.bzr|\.vscode|\.claude|\.idea|\.ssh|\.github|\.npm|\.yarn|\.pnpm|\.cache|\.husky|\.turbo|\.next|\.nuxt|node_modules|runtime)/ {
        return 404;
    }

    #一键申请SSL证书验证目录相关设置
    location /.well-known {
        root /www/sjbmusic;
        allow all;
    }

    #禁止在证书验证目录放入敏感文件
    if ( $uri ~ "^/\.well-known/.*\.(php|jsp|py|js|css|lua|ts|go|zip|tar\.gz|rar|7z|sql|bak)$" ) {
        return 403;
    }

    #LOG START
    access_log /www/wwwlogs/m.qqovo.cn.log;
    error_log /www/wwwlogs/m.qqovo.cn.error.log;
    #LOG END
}
```

> 限流、IP 归属地等功能依赖反代正确转发客户端 IP。有 CDN 时在 `.env` 设置 `CLIENT_IP_HEADER`，并由 Nginx 原样透传该头。未配置时回退 `X-Real-IP` / `X-Forwarded-For`。

---

## HTTP API 速查

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/setup/status` | 是否仍需首次部署 |
| `GET` | `/api/app-version` | 前端版本与更新说明（no-store） |
| `GET` | `/api/rooms` | 房间列表 |
| `POST` | `/api/rooms` | 创建房间 |
| `GET` | `/api/music/toplist/netease` | 网易云热歌榜 |
| `POST` | `/api/music/playlist/import` | 导入歌单 |
| `GET` | `/api/media-proxy?url=` | HTTP 媒体同源代理 |

WebSocket 连接：`/socket.io`（与 HTTP 同端口）

主要事件：`join_room`、`add_song`、`toggle_play`、`seek`、`send_chat`、`toggle_chat_reaction`、`room_update`、`playback_state`、`chat_message`
