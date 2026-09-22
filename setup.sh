#!/usr/bin/env bash
# Waken — one-liner for a 2020 MacBook Pro. Serves on your LAN so an iPhone can open it.
# Usage:  curl -fsSL https://raw.githubusercontent.com/bkhynes/waken/main/setup.sh | bash
set -euo pipefail

REPO_URL="${WAKEN_REPO:-https://github.com/bkhynes/waken.git}"
DIR="${WAKEN_DIR:-$HOME/waken}"
PORT="${WAKEN_PORT:-8787}"
TTY="/dev/tty"

say() { printf '%s\n' "$*"; }
sayerr() { printf '%s\n' "$*" >&2; }

php_ok() {
  command -v php >/dev/null 2>&1 || return 1
  php -r 'exit((int) PHP_VERSION_ID < 80000);'
}

ensure_path() {
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

ensure_php() {
  ensure_path
  if php_ok; then
    return 0
  fi
  say "PHP 8 is needed. Installing with Homebrew…"
  if ! command -v brew >/dev/null 2>&1; then
    say "Installing Homebrew first (you may be asked for your Mac password)."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    ensure_path
  fi
  brew install php
  ensure_path
  if ! php_ok; then
    sayerr "Could not find PHP 8 after install. Open a new Terminal window and run this script again."
    exit 1
  fi
}

lan_ip() {
  local ip=""
  for iface in en0 en1 en2 en3; do
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    if [ -n "$ip" ]; then
      printf '%s' "$ip"
      return 0
    fi
  done
  ip="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}' | xargs -I{} ipconfig getifaddr {} 2>/dev/null || true)"
  if [ -n "$ip" ]; then
    printf '%s' "$ip"
    return 0
  fi
  printf 'YOUR-MAC-IP'
}

prompt_key() {
  local existing="${XAI_API_KEY:-}"
  if [ -n "$existing" ]; then
    printf '%s' "$existing"
    return 0
  fi
  if [ -e "$TTY" ]; then
    printf 'xAI API key (console.x.ai → paste once, then Enter): ' >"$TTY"
    local key=""
    IFS= read -r key <"$TTY" || true
    printf '%s' "$key"
    return 0
  fi
  printf ''
}

ensure_php

if ! command -v git >/dev/null 2>&1; then
  say "Installing git…"
  brew install git
fi

if [ -d "$DIR/.git" ]; then
  say "Updating $DIR …"
  git -C "$DIR" pull --ff-only || true
else
  say "Cloning Waken into $DIR …"
  git clone "$REPO_URL" "$DIR"
fi
cd "$DIR"
chmod +x setup.sh

if [ ! -f .env ]; then
  KEY="$(prompt_key)"
  printf 'XAI_API_KEY=%s\n' "$KEY" > .env
  if [ -z "$KEY" ]; then
    say "No API key yet. Add one to $DIR/.env (XAI_API_KEY=…) and re-run."
  fi
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  say "Port $PORT is busy — stopping the old process."
  lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN | xargs kill 2>/dev/null || true
  sleep 0.4
fi

IP="$(lan_ip)"

cat <<EOF

Waken is starting on your Mac.

  This Mac:     http://127.0.0.1:${PORT}
  Your iPhone:  http://${IP}:${PORT}

Same Wi-Fi on the phone. Keep this window open.
If the iPhone cannot connect, System Settings → Network → Firewall
and allow incoming for php, or turn the firewall off while you work.

EOF

exec php \
  -d post_max_size=32M \
  -d upload_max_filesize=32M \
  -d memory_limit=256M \
  -S "0.0.0.0:${PORT}" \
  router.php
