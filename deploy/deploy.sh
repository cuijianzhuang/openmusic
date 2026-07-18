#!/usr/bin/env bash
# OpenMusic 一键部署脚本
# 用法：
#   bash deploy/deploy.sh docker   # Docker 部署（自带 Redis，推荐）
#   bash deploy/deploy.sh source   # 源码部署（PM2 常驻进程）
#   bash deploy/deploy.sh          # 交互式选择
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

info() { printf '\033[36m[INFO]\033[0m %s\n' "$1"; }
ok()   { printf '\033[32m[OK]\033[0m %s\n' "$1"; }
warn() { printf '\033[33m[WARN]\033[0m %s\n' "$1"; }
err()  { printf '\033[31m[ERROR]\033[0m %s\n' "$1" >&2; }

require_cmd() { command -v "$1" >/dev/null 2>&1; }

print_banner() {
  cat <<'EOF'
=========================================
   OpenMusic 一键部署脚本
=========================================
EOF
}

# ---------- Docker 部署 ----------

resolve_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  elif require_cmd docker-compose; then
    echo "docker-compose"
  else
    echo ""
  fi
}

deploy_docker() {
  if ! require_cmd docker; then
    err "未检测到 docker，请先安装：https://docs.docker.com/engine/install/"
    exit 1
  fi
  local compose_cmd
  compose_cmd="$(resolve_compose_cmd)"
  if [ -z "$compose_cmd" ]; then
    err "未检测到 docker compose（插件或独立版本均可），请先安装"
    exit 1
  fi
  info "使用命令：$compose_cmd"

  # 持久化配置文件在首次启动前必须以「文件」形式存在，否则 Docker 会把
  # bind mount 目标当成目录创建，导致容器内 .env 等文件读写失败
  mkdir -p data/downloads
  [ -f data/.env ] || : > data/.env
  [ -f data/runtimeConfig.json ] || echo '{}' > data/runtimeConfig.json
  [ -f data/adminConfig.json ] || echo '{}' > data/adminConfig.json
  [ -f data/setup.lock ] || : > data/setup.lock
  # 空文件不能满足 JSON.parse，但代码里都做了 try/catch + existsSync 判断，首次启动会走默认值。
  # setup.lock 必须保持真正为空（0 字节）——非空才会被判定为「已完成安装」。
  if [ -s data/setup.lock ]; then
    err "data/setup.lock 非空，为避免误判安装状态已中止；如需重新安装请先清空该文件"
    exit 1
  fi

  info "构建镜像并启动容器（redis + openmusic）..."
  $compose_cmd up -d --build

  ok "部署完成"
  local port="${OPENMUSIC_PORT:-4000}"
  cat <<EOF

下一步：
  1. 浏览器打开 http://<服务器IP>:${port}/setup 完成首次部署向导
     - Redis 主机名填 redis，端口 6379（compose 内部服务名，无需公网地址）
     - Meting/音源、站点地址等按需填写；也可留空，之后到管理后台再配置
  2. 向导完成后需要重启一次服务使 .env 生效：
     $compose_cmd restart openmusic
  3. 常用命令：
     $compose_cmd logs -f openmusic   # 查看日志
     $compose_cmd down                # 停止
     $compose_cmd up -d --build       # 更新代码后重新构建启动
EOF
}

# ---------- 源码部署 ----------

check_node_version() {
  if ! require_cmd node; then
    err "未检测到 Node.js，请先安装 Node.js >= 18：https://nodejs.org/"
    exit 1
  fi
  local major
  major="$(node -e 'console.log(process.versions.node.split(".")[0])')"
  if [ "$major" -lt 18 ]; then
    err "Node.js 版本过低（当前 $(node -v)），需要 >= 18"
    exit 1
  fi
  ok "Node.js $(node -v)"
}

ensure_pm2() {
  if require_cmd pm2; then
    ok "PM2 $(pm2 -v)"
    return
  fi
  info "未检测到 PM2，正在全局安装..."
  if ! npm install -g pm2; then
    err "PM2 安装失败，请手动执行：npm install -g pm2"
    exit 1
  fi
  ok "PM2 安装完成"
}

deploy_source() {
  check_node_version
  if ! require_cmd npm; then
    err "未检测到 npm"
    exit 1
  fi

  info "安装依赖（根 / server / client）..."
  npm run install:all

  info "构建前端..."
  npm run build

  ensure_pm2

  info "使用 PM2 启动服务（deploy/ecosystem.config.cjs）..."
  pm2 start deploy/ecosystem.config.cjs
  pm2 save

  ok "部署完成"
  local port="${PORT:-4000}"
  cat <<EOF

下一步：
  1. 浏览器打开 http://<服务器IP>:${port}/setup 完成首次部署向导
     （若已存在有效 server/.env，会跳过向导）
  2. 向导完成后需要重启一次服务使 .env 生效：
     pm2 restart openmusic
  3. 常用命令：
     pm2 logs openmusic     # 查看日志
     pm2 restart openmusic  # 重启
     pm2 status             # 查看状态
  4. 如需开机自启：pm2 startup 按提示执行一次即可（pm2 save 已保存当前进程列表）
  5. 更新代码后重新部署：git pull 后再次执行本脚本（或手动 npm run build && pm2 restart openmusic）
EOF
}

# ---------- 入口 ----------

main() {
  print_banner
  local mode="${1:-}"
  if [ -z "$mode" ]; then
    echo "请选择部署方式："
    echo "  1) Docker 部署（推荐，自带 Redis 容器）"
    echo "  2) 源码部署（PM2，需自行提供 Redis）"
    read -r -p "输入 1 或 2: " choice
    case "$choice" in
      1) mode="docker" ;;
      2) mode="source" ;;
      *) err "无效选择"; exit 1 ;;
    esac
  fi

  case "$mode" in
    docker) deploy_docker ;;
    source) deploy_source ;;
    *)
      err "未知部署方式：$mode（可选 docker / source）"
      exit 1
      ;;
  esac
}

main "$@"
