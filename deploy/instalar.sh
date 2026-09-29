#!/usr/bin/env bash
# Instala o SIS SMPE numa VPS com cPanel/WHM. Rode como root:
#   bash instalar.sh USUARIO_CPANEL DOMINIO
# Ex.: bash instalar.sh smpe sissmpe.com.br
# Pode rodar de novo sem problema (atualiza o que ja existe).
set -euo pipefail

USUARIO="${1:?Informe o usuario do cPanel (ex.: bash instalar.sh smpe seudominio.com.br)}"
DOMINIO="${2:?Informe o dominio (ex.: bash instalar.sh smpe seudominio.com.br)}"
REPO="${REPO:-https://github.com/daniel-icaro10/api.git}"

[ "$(id -u)" = 0 ] || { echo "Rode como root (sudo -i)"; exit 1; }
id "$USUARIO" >/dev/null 2>&1 || { echo "Usuario '$USUARIO' nao existe. Crie a conta no WHM primeiro."; exit 1; }
HOME_U="$(getent passwd "$USUARIO" | cut -d: -f6)"
APP="$HOME_U/sis-smpe"
como() { sudo -u "$USUARIO" -H "$@"; }

echo "==> Python 3.10 ou mais novo"
achar_python() { for p in python3.12 python3.11 python3.10; do command -v "$p" >/dev/null && { echo "$p"; return; }; done; }
PY="$(achar_python || true)"
if [ -z "$PY" ]; then
  (dnf install -y python3.12 || dnf install -y python3.11 || yum install -y python3.11 || apt-get install -y python3.11 python3.11-venv) >/dev/null
  PY="$(achar_python || true)"
fi
[ -n "$PY" ] || { echo "Nao consegui instalar o Python 3.10+. Instale manualmente e rode de novo."; exit 1; }
echo "    usando $($PY --version)"
command -v git >/dev/null || (dnf install -y git || yum install -y git || apt-get install -y git) >/dev/null

echo "==> Codigo em $APP"
if [ -d "$APP/.git" ]; then como git -C "$APP" pull --ff-only; else como git clone "$REPO" "$APP"; fi

echo "==> Ambiente Python e dependencias"
[ -x "$APP/.venv/bin/python" ] || como "$PY" -m venv "$APP/.venv"
como "$APP/.venv/bin/pip" install -q --upgrade pip
como "$APP/.venv/bin/pip" install -q -r "$APP/requirements.txt"

echo "==> Configuracao (deploy/smpe.env)"
ENV="$APP/deploy/smpe.env"
if [ ! -f "$ENV" ]; then
  sed "s/USUARIO/$USUARIO/g" "$APP/deploy/smpe.env.exemplo" > "$ENV"
  chown "$USUARIO:$USUARIO" "$ENV"
fi
chmod 600 "$ENV"

echo "==> Servico smpe (systemd)"
sed "s#/home/USUARIO#$HOME_U#g; s/USUARIO/$USUARIO/g" "$APP/deploy/smpe.service" > /etc/systemd/system/smpe.service
systemctl daemon-reload
systemctl enable smpe >/dev/null

echo "==> Apache do cPanel: $DOMINIO -> 127.0.0.1:8010"
if command -v httpd >/dev/null; then
  for m in proxy_module proxy_http_module headers_module rewrite_module; do
    httpd -M 2>/dev/null | grep -q "$m" || echo "    ATENCAO: modulo $m ausente. Ative no WHM > EasyApache 4 (mod_proxy, mod_proxy_http, mod_headers)."
  done
fi
for tipo in std ssl; do
  DIR="/etc/apache2/conf.d/userdata/$tipo/2_4/$USUARIO/$DOMINIO"
  mkdir -p "$DIR"
  [ "$tipo" = ssl ] && cp "$APP/deploy/apache-https.conf" "$DIR/smpe.conf" || cp "$APP/deploy/apache-http.conf" "$DIR/smpe.conf"
done
/usr/local/cpanel/scripts/rebuildhttpdconf >/dev/null
/usr/local/cpanel/scripts/restartsrv_httpd >/dev/null

if grep -q "SENHA_DO_BANCO" "$ENV"; then
  echo
  echo "FALTA: edite $ENV com os dados do banco PostgreSQL e depois rode:  systemctl restart smpe"
  exit 0
fi
echo "==> Iniciando"
systemctl restart smpe
sleep 4
if curl -fsS -o /dev/null http://127.0.0.1:8010/api/publico; then
  echo "OK: sistema no ar. Acesse https://$DOMINIO"
else
  echo "O servico nao respondeu. Veja o erro com:  journalctl -u smpe -n 50 --no-pager"
  exit 1
fi
