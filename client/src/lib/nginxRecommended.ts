/** 首次部署完成后展示的 Nginx location 片段：静态直出 + 动态回 Node */

const DEFAULT_APP_ROOT = '/www/openmusic';

const NGINX_LOCATIONS = String.raw`# 静态 Nginx 直出，动态回 Node（把下面的 location 放进站点 server 块）
# 前端目录：__APP_ROOT__/client/dist   后端：127.0.0.1:4000
# ★ 删掉原来的 location / { proxy_pass 4000; }，改成末尾的 SPA 回退
# 保存后执行：nginx -t && nginx -s reload

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

# 静态直出（assets 固定文件名，禁止长期缓存）
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

# SPA 静态回退，不再全站进 Node
location / {
    add_header Cache-Control "no-cache, must-revalidate" always;
    try_files $uri $uri/ /index.html;
}
`;

export function buildRecommendedNginxConfig(options: {
  siteUrl?: string;
  appRoot?: string;
} = {}): string {
  const appRoot = String(options.appRoot || DEFAULT_APP_ROOT).replace(/\/+$/, '') || DEFAULT_APP_ROOT;
  return NGINX_LOCATIONS.split('__APP_ROOT__').join(appRoot);
}
