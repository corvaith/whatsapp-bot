#!/usr/bin/env bash
set -euo pipefail

APP_NAME="whatsapp-bot"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="whatsapp-bot"
BUN_BIN="${BUN_INSTALL:-$HOME/.bun}/bin/bun"

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m[x]\033[0m %s\n' "$1" >&2; exit 1; }

need_sudo() {
  if [ "$(id -u)" -eq 0 ]; then echo ""
  elif command -v sudo >/dev/null 2>&1; then echo "sudo"
  else fail "root or sudo is required to install system packages"; fi
}

install_packages() {
  local sudo_cmd apt
  sudo_cmd="$(need_sudo)"
  local packages=(ffmpeg python3-pil curl unzip)
  if command -v apt-get >/dev/null 2>&1; then
    info "Installing system packages (${packages[*]})"
    $sudo_cmd apt-get update -qq
    $sudo_cmd apt-get install -y -qq "${packages[@]}"
  elif command -v dnf >/dev/null 2>&1; then
    info "Installing system packages"
    $sudo_cmd dnf install -y ffmpeg python3-pillow curl unzip
  elif command -v apk >/dev/null 2>&1; then
    info "Installing system packages"
    $sudo_cmd apk add --no-cache ffmpeg py3-pillow curl unzip
  else
    warn "Unknown package manager; install ffmpeg, python3-pil, curl and unzip manually"
  fi
}

install_bun() {
  if [ -x "$BUN_BIN" ]; then
    info "Bun found: $("$BUN_BIN" --version)"
    return
  fi
  if command -v bun >/dev/null 2>&1; then
    BUN_BIN="$(command -v bun)"
    info "Bun found: $("$BUN_BIN" --version)"
    return
  fi
  info "Bun not found, installing"
  command -v unzip >/dev/null 2>&1 || install_packages
  curl -fsSL https://bun.sh/install | bash
  BUN_BIN="${BUN_INSTALL:-$HOME/.bun}/bin/bun"
  [ -x "$BUN_BIN" ] || fail "Bun installation failed"
  info "Bun installed: $("$BUN_BIN" --version)"
}

setup_env() {
  if [ -f "$DIR/.env" ]; then
    info ".env already exists, leaving it untouched"
    return
  fi
  cp "$DIR/.env.example" "$DIR/.env"
  info "Created .env from .env.example"
  read -rp "WhatsApp pairing number (country code, no +): " pairing
  read -rp "Owner number (country code, no +): " owner
  if [ -n "$pairing" ]; then
    sed -i "s|^PAIRING_NUMBER=.*|PAIRING_NUMBER=${pairing}|" "$DIR/.env"
  fi
  if [ -n "$owner" ]; then
    sed -i "s|^OWNER_NUMBER=.*|OWNER_NUMBER=${owner}|" "$DIR/.env"
  fi
  info ".env configured"
}

install_dependencies() {
  info "Installing project dependencies"
  (cd "$DIR" && "$BUN_BIN" install)
}

install_service() {
  local sudo_cmd
  sudo_cmd="$(need_sudo)"
  info "Installing systemd service ($SERVICE_NAME)"
  sed -e "s|User=.*|User=$(id -un)|" \
    -e "s|WorkingDirectory=.*|WorkingDirectory=${DIR}|" \
    -e "s|ExecStart=.*|ExecStart=${BUN_BIN} --env-file=.env src/index.js|" \
    -e "s|append:.*|append:${DIR}/bot.log|" \
    "$DIR/whatsapp-bot.service" | $sudo_cmd tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null
  $sudo_cmd systemctl daemon-reload
  $sudo_cmd systemctl enable --now "$SERVICE_NAME"
  info "Service running"
}

main() {
  local with_service=0
  for arg in "$@"; do
    case "$arg" in
    --service) with_service=1 ;;
    --help | -h)
      echo "Usage: ./install.sh [--service]"
      echo "  --service  install and start the systemd service"
      exit 0
      ;;
    *) fail "Unknown option: $arg" ;;
    esac
  done

  info "Setting up $APP_NAME in $DIR"
  install_packages
  install_bun
  install_dependencies
  setup_env

  if [ "$with_service" -eq 1 ]; then
    install_service
  else
    info "Done. Start the bot with: $BUN_BIN --env-file=.env src/index.js"
    info "Re-run with --service to install it as a systemd service"
  fi
}

main "$@"
