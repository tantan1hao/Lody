gzip on;
gzip_comp_level 6;
gzip_min_length 1024;
gzip_vary on;
gzip_types application/javascript application/json application/wasm image/svg+xml text/css text/javascript;

location = /login {
    default_type text/html;
    alias /srv/lody-oss/public-login.html;
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options "nosniff" always;
}

location = /session {
    auth_basic "Lody OSS";
    auth_basic_user_file /etc/nginx/lody-oss-web.htpasswd;
    default_type text/plain;
    alias /srv/lody-oss/session-ok.txt;
    include /etc/nginx/snippets/lody-oss-public-session-set.inc;
    add_header Cache-Control "no-store";
}

# Public bootstrap document. The web client fetches it with credentials
# omitted, so a cookie gate makes Home Screen apps fail: they have an empty
# localStorage cache, unlike Safari which can reuse an earlier copy.
location = /.well-known/lody-oss.json {
    alias /etc/lody-oss/config-public.json;
    default_type application/json;
    limit_except GET { deny all; }
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options "nosniff" always;
}

# PWA install + Web Push worker. Not secret; iOS fetches icons while adding
# the Home Screen icon, often before the session cookie is sent.
location = /manifest.webmanifest {
    root /srv/lody-oss/web;
    default_type application/manifest+json;
    add_header Cache-Control "no-cache" always;
    add_header X-Content-Type-Options "nosniff" always;
}

location = /sw.js {
    root /srv/lody-oss/web;
    default_type application/javascript;
    add_header Cache-Control "no-cache" always;
    add_header Service-Worker-Allowed "/" always;
    add_header X-Content-Type-Options "nosniff" always;
}

location ^~ /icons/ {
    root /srv/lody-oss/web;
    try_files $uri =404;
    add_header Cache-Control "public, max-age=86400" always;
    add_header X-Content-Type-Options "nosniff" always;
}

# iOS also probes these well-known root paths when adding to Home Screen,
# often before the session cookie is sent (same as /icons/).
location = /apple-touch-icon.png {
    root /srv/lody-oss/web;
    default_type image/png;
    add_header Cache-Control "public, max-age=86400" always;
    add_header X-Content-Type-Options "nosniff" always;
}

location = /apple-touch-icon-precomposed.png {
    root /srv/lody-oss/web;
    default_type image/png;
    add_header Cache-Control "public, max-age=86400" always;
    add_header X-Content-Type-Options "nosniff" always;
}

location = /push/vapid-public-key {
    include /etc/nginx/snippets/lody-oss-public-session-check-api.inc;
    proxy_pass http://127.0.0.1:8096/vapid-public-key;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
}

location = /push/subscription {
    include /etc/nginx/snippets/lody-oss-public-session-check-api.inc;
    client_max_body_size 16k;
    proxy_pass http://127.0.0.1:8096/subscription;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
}

location /ds/ {
    include /etc/nginx/snippets/lody-oss-public-session-check-api.inc;
    client_max_body_size 64m;
    gzip off;
    # Browser/Electron clients use the same Streams endpoint. Reflect the
    # preflight header list because Streams protocol extensions add several
    # versioned Stream-* and Producer-* request headers.
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET, HEAD, POST, PUT, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers $http_access_control_request_headers always;
        add_header Access-Control-Max-Age "86400" always;
        return 204;
    }
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Expose-Headers "Content-Type, Producer-Epoch, Producer-Expected-Seq, Producer-Received-Seq, Producer-Seq, Stream-CAS-Mismatch, Stream-Closed, Stream-Cursor, Stream-Expected-Offset, Stream-Expires-At, Stream-Extensions, Stream-Next-Offset, Stream-SSE-Data-Encoding, Stream-Snapshot-Offset, Stream-TTL, Stream-Up-To-Date" always;
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
}

# Hashed Vite assets are not secret. Module scripts use `crossorigin`, so the
# browser will not send the session cookie; gating them on it whitescreens
# the app after login. Keep HTML and Streams behind the cookie.
location ^~ /assets/ {
    root /srv/lody-oss/web;
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header X-Content-Type-Options "nosniff" always;
}

location ^~ /emojibase/ {
    root /srv/lody-oss/web;
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header X-Content-Type-Options "nosniff" always;
}

location / {
    include /etc/nginx/snippets/lody-oss-public-session-check-html.inc;
    root /srv/lody-oss/web;
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "no-cache" always;
    add_header X-Content-Type-Options "nosniff" always;
}
