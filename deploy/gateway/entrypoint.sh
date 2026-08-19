#!/bin/sh
set -eu

trusted_proxy_cidr=${TRUSTED_PROXY_CIDR:-}
case "$trusted_proxy_cidr" in
  ""|*[!0-9A-Fa-f:./]*)
    echo "TRUSTED_PROXY_CIDR must be a single IPv4 or IPv6 CIDR." >&2
    exit 1
    ;;
esac

sed "s|__TRUSTED_PROXY_CIDR__|$trusted_proxy_cidr|g" /etc/nginx/nginx.conf.template > /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g "daemon off;"
