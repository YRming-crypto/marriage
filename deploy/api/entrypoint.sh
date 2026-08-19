#!/bin/sh
set -eu

api_pid=""
proxy_pid=""

shutdown() {
  [ -z "$proxy_pid" ] || kill "$proxy_pid" 2>/dev/null || true
  [ -z "$api_pid" ] || kill "$api_pid" 2>/dev/null || true
  [ -z "$proxy_pid" ] || wait "$proxy_pid" 2>/dev/null || true
  [ -z "$api_pid" ] || wait "$api_pid" 2>/dev/null || true
}

trap shutdown INT TERM EXIT

node apps/api/dist/start.js &
api_pid=$!

# The current API binds to loopback. Expose it to the container network without
# changing application code; remove this proxy after the API supports API_HOST.
socat TCP-LISTEN:8080,reuseaddr,fork TCP:127.0.0.1:${API_PORT:-4184} &
proxy_pid=$!

while kill -0 "$api_pid" 2>/dev/null && kill -0 "$proxy_pid" 2>/dev/null; do
  sleep 1
done

if ! kill -0 "$api_pid" 2>/dev/null; then
  wait "$api_pid"
  exit $?
fi

wait "$proxy_pid"
