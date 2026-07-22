<h1 align="center">🎵 OpenMusic</h1>

<p align="center">
  <strong>多人实时在线点歌</strong><br/>
  多音源搜索 · 同步听歌 · 聊天互动 · 3D 视觉 / 沉浸模式
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/License-MIT%20with%20Attribution-blue" alt="MIT with Attribution" />
  <img src="https://img.shields.io/badge/Deploy-Docker%20%7C%20PM2%20%7C%20宝塔-ff6b6b" alt="Deploy" />
</p>

<p align="center">
  <a href="#-快速开始">🚀 快速开始</a> ·
  <a href="#-功能概览">✨ 功能</a> ·
  <a href="#-站点管理后台">🛡️ 管理后台</a> ·
  <a href="docs/DEPLOY.md">📖 部署文档</a> ·
  <a href="deploy/DEPLOY-BAOTA.md">🛠️ 宝塔部署</a>
</p>

---

## 📸 项目截图

<p align="center">
  <a href="docs/screenshots/home.png">
    <img src="docs/screenshots/home.png" alt="首页大厅" width="78%" />
  </a>
  <br/>
  <sub><b>首页大厅</b></sub>
</p>

<table>
  <tr>
    <td align="center" width="50%">
      <a href="docs/screenshots/room.png"><img src="docs/screenshots/room.png" alt="房间点歌" width="100%" /></a>
      <br/><sub><b>房间点歌</b></sub>
    </td>
    <td align="center" width="50%">
      <a href="docs/screenshots/admin.png"><img src="docs/screenshots/admin.png" alt="管理后台" width="100%" /></a>
      <br/><sub><b>管理后台</b></sub>
    </td>
  </tr>
</table>

---

## 🚀 快速开始

### Docker 部署（推荐）

```bash
# 下载 compose 文件，直接拉镜像运行（无需克隆源码）
curl -O https://raw.githubusercontent.com/qq01-hub/openmusic/main/docker-compose.full.yml
mkdir -p data/downloads && touch data/.env data/setup.lock && echo '{}' > data/runtimeConfig.json && echo '{}' > data/adminConfig.json
docker compose -f docker-compose.full.yml up -d
```

打开 `http://<IP>:4000`，Redis 和 Meting 已自动配好，填个站点域名就完事。向导完成后自动重启。

> 不需要内置 Meting？改用 `docker-compose.yml`。宝塔用户见 [宝塔部署](deploy/DEPLOY-BAOTA.md)。
> 更新：`docker compose pull && docker compose up -d`

### 源码部署

```bash
git clone https://github.com/qq01-hub/openmusic.git && cd openmusic
npm run install:all && npm run build && npm start
```

打开站点自动进入部署向导。详见 [部署文档](docs/DEPLOY.md)。

> 开发模式：`npm run dev`（前端 `:5173`，后端 `:4000`）

---

## ✨ 功能概览

### 🎧 听歌

- 多音源搜索：红点 / 绿点 / 蓝点
- **本机音质**：自选偏好；切换后当前曲继续播放，下一首起生效
- 多人实时同步播放、歌词滚动
- 网易云热歌榜（服务端缓存每 3 小时刷新）
- 歌单导入、电台节目、个人收藏与点歌历史（JSON 导入 / 导出）
- TV 大屏：`/tv/:roomId`
- 队列拖拽排序、媒体键
- 移动端后台播放（Capacitor）

### 🏠 房间

- 大厅、密码房、最近访问、分享链接
- **自定义封面**：房主可上传房间封面，大厅卡片同步；取消后恢复跟随当前歌曲
- 站点公告 / 房间公告、FM 漫游、贵宾角标
- 成员归属地、点歌规则、禁播、踩歌切歌
- 纯净模式：隐藏动效与热榜

### 💬 互动

- 实时聊天：贴纸、发图、回复 / @ / @全体、撤回
- 敏感词检测
- 微信表情包采集 / 表情包搜索
- 昵称首字 / 无头像占位支持表情字符

### 🌌 视觉与客户端

- 星河 / 声波地形 3D 背景、封面模糊背景、桌面沉浸模式
- Android / iOS（Capacitor 远程 URL）
- 静默 / 强制更新提示

### ⚙️ 点歌规则（房主 / 管理员）

| 规则 | 说明 |
|------|------|
| 允许成员点歌 | 关闭后仅房主与管理员可点 |
| 允许成员插队 | 成员可对自己的点歌插队 |
| 进房等待时间 | 新成员停留满时长后才能点歌 |
| 每人最多点歌 | 队列中每人上限，`0` = 不限 |
| 点歌冷却 | 不限制 / 10s / 30s / 60s / 120s |
| 队列长度上限 | 50 / 100 / 200 |
| 禁播歌曲 | 按歌名，跨平台均不可点 |
| 踩歌切歌 | 按人数或在线比例 |
| 退出后清除已点 | 离房超时后清除其待播 |

---

## 🛡️ 站点管理后台

部署向导自动创建**随机管理员账号密码**和**随机管理入口**（不是 `/admin`），仅在完成页展示一次，请立即复制。

**忘记密码**：`redis-cli DEL openmusic:admin:credentials` → 重启，回到默认 `admin` / `123456`。
**忘记入口**：查看 `server/adminConfig.json` 的 `entryPath` 字段。

主要功能：运行配置（音源 / 密钥 / SVIP 音质开关在线改）、房间管理、全局广播、全站封禁、错误上报、操作审计。

---

## 🔗 第三方账号绑定（可选）

支持 Linux.do 和 GitHub 两种，能力完全一样、互相独立，可以只开一个也可以都开：绑定后可以用同一个账号，在换设备 / 清了浏览器 Cookie 之后**找回房间房主身份**；后台管理员也可以额外绑定，作为账号密码之外的另一种登录方式。都不绑定完全不影响匿名建房 / 加房 / 后台密码登录，默认不开启。

### 1. 申请 OAuth 应用

**Linux.do**：去 [connect.linux.do](https://connect.linux.do) 注册，拿到 `client_id` / `client_secret`，回调地址填 `https://你的域名/api/auth/linuxdo/callback`；还需要向 Linux.do 官方文档核实真实的授权 / 令牌 / 用户信息接口地址（`.env.example` 里不提供默认值，照抄示例地址大概率无法工作）。

**GitHub**：去 [github.com/settings/developers](https://github.com/settings/developers) 新建一个 OAuth App，拿到 `client_id` / `client_secret`，Authorization callback URL 填 `https://你的域名/api/auth/github/callback`。GitHub 的接口地址是固定的，不需要额外核实/配置。

### 2. 填写配置

在 `server/.env` 里填（两个都是可选，各自独立）：

```bash
# Linux.do
LINUXDO_CLIENT_ID=
LINUXDO_CLIENT_SECRET=
LINUXDO_REDIRECT_URI=https://你的域名/api/auth/linuxdo/callback
LINUXDO_AUTHORIZE_URL=
LINUXDO_TOKEN_URL=
LINUXDO_USERINFO_URL=
LINUXDO_SCOPE=read

# GitHub
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=https://你的域名/api/auth/github/callback
GITHUB_SCOPE=read:user
```

留空即为关闭对应功能。也可以不改 `.env`，直接在管理后台「运行时配置」里填，免重启生效。

### 3. 怎么绑定

- **房主绑定**：进入自己创建的房间 → 房间设置 → 「身份」标签页 → 绑定 Linux.do / GitHub 账号（两个开了哪个就显示哪个）。
- **找回房主身份**：换了设备或清了 Cookie 导致不再被识别为房主时，进同一个房间 → 房间设置 → 「身份」标签页 → 用对应账号找回房间身份（只有此前真绑定过的账号才能找回成功）。
- **后台备用登录**：先用账号密码登进管理后台 → 「管理员账号」卡片 → 绑定 Linux.do / GitHub 账号，之后登录页会出现对应的一键登录按钮。第三方账号本身不能凭空创建新的管理员权限，必须先有一个已登录的管理员账号才能发起绑定。

---

## 🛠️ 首页管理入口快捷方式

首页默认不展示任何管理入口——部署向导生成的随机路径本身就是安全设计的一部分，不应该被公开链接出来。当你自己的浏览器**成功命中**过一次真实的管理入口后，会在本地 `localStorage` 记住这个路径，之后首页顶栏会悄悄出现一个小盾牌图标指向它，方便你自己快速进入；别人访问首页完全看不到，也不会泄露真实路径。

---

## 📱 Android / iOS

Capacitor 远程 URL 壳，前端更新无需重打包。GitHub Actions 提供 APK / IPA 构建。

---

## 🧱 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React · Vite · Tailwind CSS · Socket.IO Client · Three.js / R3F · Capacitor |
| 后端 | Node.js · Express · Socket.IO · Redis（必需） |

---

## 🙏 致谢

| 项目 | 作者 | 说明 |
|------|------|------|
| [Mineradio](https://github.com/XxHuberrr/Mineradio) | [@XxHuberrr](https://github.com/XxHuberrr) | 星河粒子、沉浸玻璃质感、舞台歌词等 |
| [sonic-topography](https://github.com/yin-yizhen/sonic-topography) | [@yin-yizhen](https://github.com/yin-yizhen) | 「声波地形」着色器（仅限个人 / 非商业） |

## 🔗 友情链接

- [Linux.do](https://linux.do/) — 新的理想型社区

## ⚠️ 免责声明

本项目仅供学习与技术交流。不存储音频文件，音乐版权归相关权利人所有。请遵守法律法规及平台协议，不得用于商业用途。

## 📄 License

[MIT（附注明出处条款）](LICENSE)：可自由使用、修改、分发，但公开分发或部署时须注明出处（项目名「OpenMusic」及原始仓库链接）。
