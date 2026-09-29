#!/usr/bin/env bash
# Atualiza o SIS SMPE na VPS com a versao mais nova do GitHub. Rode como root:
#   bash /home/USUARIO/sis-smpe/deploy/atualizar.sh USUARIO_CPANEL
set -euo pipefail

USUARIO="${1:?Informe o usuario do cPanel (ex.: bash atualizar.sh smpe)}"
[ "$(id -u)" = 0 ] || { echo "Rode como root (sudo -i)"; exit 1; }
HOME_U="$(getent passwd "$USUARIO" | cut -d: -f6)"
APP="$HOME_U/sis-smpe"
como() { sudo -u "$USUARIO" -H "$@"; }

como git -C "$APP" pull --ff-only
como "$APP/.venv/bin/pip" install -q -r "$APP/requirements.txt"
systemctl restart smpe
sleep 4
if curl -fsS -o /dev/null http://127.0.0.1:8010/api/publico; then
  echo "OK: atualizado para $(como git -C "$APP" log --oneline -1)"
else
  echo "O servico nao respondeu. Veja o erro com:  journalctl -u smpe -n 50 --no-pager"
  exit 1
fi
