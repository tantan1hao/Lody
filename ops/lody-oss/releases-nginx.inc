location = /lody-oss/status.json {
    alias /srv/lody-oss/releases/status.json;
    default_type application/json;
    limit_except GET { deny all; }
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options "nosniff" always;
}

location = /lody-oss/release.json {
    alias /srv/lody-oss/releases/release.json;
    default_type application/json;
    limit_except GET { deny all; }
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options "nosniff" always;
}

location = /lody-oss/latest.yml {
    alias /srv/lody-oss/releases/latest.yml;
    default_type text/yaml;
    limit_except GET { deny all; }
    add_header Cache-Control "no-cache" always;
    add_header X-Content-Type-Options "nosniff" always;
}

location /lody-oss/ {
    alias /srv/lody-oss/releases/;
    index index.html;
    autoindex off;
    limit_except GET { deny all; }
    add_header Cache-Control "no-cache" always;
    add_header X-Content-Type-Options "nosniff" always;
}
