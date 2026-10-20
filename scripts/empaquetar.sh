#!/usr/bin/env bash
# ==============================================================================
# Microservicio: transporte · Modulo: Cuadro de Colores
# Archivo: scripts/empaquetar.sh
# Responsabilidad: Armar, en la MAQUINA DE DESARROLLO, el paquete de un servidor
#   (preproduccion o produccion): las dos imagenes en un .tar, los compose, la
#   plantilla del .env, la guia y SHA256-ESPERADOS.txt. Ver DESPLIEGUE.md,
#   «Los tres ambientes».
# Fecha: 2026-10-16
#
# Uso:
#   ./scripts/empaquetar.sh <preproduccion|produccion> <url-del-portal-de-auth> [opciones]
#
#   --destino <carpeta>   donde dejar el paquete (por omision ../<ambiente>_<AAAAMMDD>)
#   --sin-verificar-git   no exige main limpio y al dia con origin (solo para ensayos)
#
#   VITE_AUTH_MODULE_CODE=<id>   opcional: id del modulo en el Auth de ese ambiente
#   VITE_AUTH_LOGOUT_URL=<url>   opcional: por omision, la misma del portal
#
# LA IMAGEN DEL BACKEND ES LA MISMA EN LOS DOS SERVIDORES; LA DEL FRONTEND ES POR
# AMBIENTE, porque la direccion del portal de Auth queda dentro del JavaScript al
# compilar. Por eso el portal es un argumento obligatorio y se comprueba en el bundle.
#
# El entorno local NO se toca: el compose de desarrollo usa las etiquetas :latest, y
# este script solo construye y etiqueta :<version> (la de docker-compose.prod.yml).
# ==============================================================================
set -euo pipefail

# En Git Bash (Windows), las rutas DE DENTRO del contenedor (/usr/share/...) se reescriben
# como rutas de Windows. Por eso los «docker run» llevan MSYS_NO_PATHCONV=1 delante; no se
# exporta, porque a git y a docker build si hay que pasarles las rutas convertidas. En Linux
# no cambia nada.

fallar() {
  echo "ERROR: $*" >&2
  exit 1
}

uso() {
  sed -n '12,19p' "$0" >&2
  exit 1
}

[ "$#" -ge 2 ] || uso

AMBIENTE="$1"
PORTAL="$2"
shift 2

DESTINO=""
VERIFICAR_GIT=1
while [ "$#" -gt 0 ]; do
  case "$1" in
    --destino) DESTINO="${2:-}"; [ -n "$DESTINO" ] || uso; shift 2 ;;
    --sin-verificar-git) VERIFICAR_GIT=0; shift ;;
    *) uso ;;
  esac
done

case "$AMBIENTE" in
  preproduccion | produccion) ;;
  *) fallar "el ambiente es «preproduccion» o «produccion», no «$AMBIENTE»." ;;
esac

case "$PORTAL" in
  http://* | https://*) ;;
  *) fallar "el portal debe ser una URL absoluta (http:// o https://): «$PORTAL»." ;;
esac

if [ "$AMBIENTE" = "produccion" ]; then
  case "$PORTAL" in
    https://*) ;;
    *) fallar "produccion va detras del Gateway con HTTPS: el portal debe ser https://." ;;
  esac
fi

RAIZ_BACK="$(cd "$(dirname "$0")/.." && pwd)"
RAIZ_FRONT="$(cd "$RAIZ_BACK/../transporte-frontend" && pwd)" \
  || fallar "no encuentro ../transporte-frontend junto a transporte-backend."
FECHA="$(date +%Y%m%d)"
DESTINO="${DESTINO:-$RAIZ_BACK/../${AMBIENTE}_${FECHA}}"
LOGOUT="${VITE_AUTH_LOGOUT_URL:-$PORTAL}"
MODULO="${VITE_AUTH_MODULE_CODE:-}"
PORTAL_HOST="$(echo "$PORTAL" | sed -E 's#^https?://([^/]+).*#\1#')"

# La version es el pin de docker-compose.prod.yml: el .tar debe traer EXACTAMENTE las
# etiquetas que ese compose busca, o `up -d` no encuentra las imagenes.
VERSION="$(sed -n -E 's#^[[:space:]]*image:[[:space:]]*transporte-backend:([^[:space:]]+).*#\1#p' "$RAIZ_BACK/docker-compose.prod.yml" | head -n 1)"
[ -n "$VERSION" ] || fallar "no encuentro la version de transporte-backend en docker-compose.prod.yml."

# ---- 1 · Codigo: main limpio y al dia --------------------------------------------
verificar_repo() {
  local repo="$1"
  local cambios rama
  # .claude/ y lo no versionado no entran en la imagen ni en el paquete.
  cambios="$(git -C "$repo" status --porcelain --untracked-files=no -- . ':(exclude).claude')"
  [ -z "$cambios" ] || fallar "$repo tiene cambios sin commitear:
$cambios"
  rama="$(git -C "$repo" rev-parse --abbrev-ref HEAD)"
  [ "$rama" = "main" ] || fallar "$repo esta en «$rama»: el paquete se arma desde main."
  git -C "$repo" fetch -q origin main
  [ "$(git -C "$repo" rev-parse HEAD)" = "$(git -C "$repo" rev-parse origin/main)" ] \
    || fallar "$repo no coincide con origin/main: haga git pull (o push) antes de empaquetar."
}

if [ "$VERIFICAR_GIT" = "1" ]; then
  verificar_repo "$RAIZ_BACK"
  verificar_repo "$RAIZ_FRONT"
else
  echo "AVISO: --sin-verificar-git. Paquete de ENSAYO: no lo lleve a un servidor."
fi

COMMIT_BACK="$(git -C "$RAIZ_BACK" rev-parse --short HEAD)"
COMMIT_FRONT="$(git -C "$RAIZ_FRONT" rev-parse --short HEAD)"

if [ -e "$DESTINO" ] && [ -n "$(ls -A "$DESTINO" 2>/dev/null)" ]; then
  fallar "$DESTINO ya existe y no esta vacia: no se sobrescribe un paquete."
fi
mkdir -p "$DESTINO"

# ---- 2 · Imagenes ------------------------------------------------------------------
echo "== Backend transporte-backend:$VERSION ($COMMIT_BACK)"
docker build -q -t "transporte-backend:$VERSION" "$RAIZ_BACK" >/dev/null

echo "== Frontend transporte-frontend:$VERSION ($COMMIT_FRONT) · portal $PORTAL"
# VITE_API_BASE_URL VACIA a proposito: el frontend llama a /api/v1 en su propio origen y
# su nginx lo reenvia al backend. Nunca «/api»: httpClient ya agrega /api/v1.
docker build -q -t "transporte-frontend:$VERSION" \
  --build-arg VITE_API_BASE_URL= \
  --build-arg "VITE_AUTH_PORTAL_URL=$PORTAL" \
  --build-arg "VITE_AUTH_LOGOUT_URL=$LOGOUT" \
  --build-arg "VITE_AUTH_MODULE_CODE=$MODULO" \
  "$RAIZ_FRONT" >/dev/null

# ---- 3 · El bundle es el de este ambiente ------------------------------------------
en_bundle() {
  MSYS_NO_PATHCONV=1 docker run --rm --entrypoint sh "transporte-frontend:$VERSION" \
    -c "grep -rlF '$1' /usr/share/nginx/html/assets | wc -l"
}
[ "$(en_bundle "$PORTAL_HOST")" -ge 1 ] || fallar "el bundle no contiene el portal $PORTAL_HOST."
[ "$(en_bundle 'localhost:3003')" -eq 0 ] || fallar "el bundle llama a localhost:3003: no sirve en un servidor."
BUNDLE="$(MSYS_NO_PATHCONV=1 docker run --rm --entrypoint sh "transporte-frontend:$VERSION" \
  -c "grep -o 'assets/index-[A-Za-z0-9_-]*\.js' /usr/share/nginx/html/index.html | head -n 1")"
[ -n "$BUNDLE" ] || fallar "no encuentro el bundle principal en index.html."

# ---- 4 · Paquete -------------------------------------------------------------------
TAR="gestion-${AMBIENTE}-${FECHA}.tar"
echo "== Guardando $DESTINO/$TAR"
docker save -o "$DESTINO/$TAR" "transporte-backend:$VERSION" "transporte-frontend:$VERSION"

cp "$RAIZ_BACK/docker-compose.prod.yml" "$DESTINO/"
if [ "$AMBIENTE" = "produccion" ]; then
  cp "$RAIZ_BACK/docker-compose.gateway.yml" "$DESTINO/"
  cp "$RAIZ_BACK/.env.produccion.example" "$DESTINO/"
  cp "$RAIZ_BACK/INSTALACION-PRODUCCION.md" "$DESTINO/"
else
  cp "$RAIZ_BACK/.env.preproduccion.example" "$DESTINO/"
  cp "$RAIZ_BACK/COMANDOS-PREPRODUCCION.md" "$DESTINO/"
fi

SHA_TAR="$(sha256sum "$DESTINO/$TAR" | cut -d ' ' -f 1)"
ID_BACK="$(docker image inspect --format '{{.Id}}' "transporte-backend:$VERSION")"
ID_FRONT="$(docker image inspect --format '{{.Id}}' "transporte-frontend:$VERSION")"

cat > "$DESTINO/SHA256-ESPERADOS.txt" <<EOF
Paquete de ${AMBIENTE^^} · $(date '+%Y-%m-%d %H:%M')
$( [ "$VERIFICAR_GIT" = "1" ] || echo 'ENSAYO (--sin-verificar-git): NO llevar a un servidor.' )

Archivo:            $TAR
sha256 del .tar:    $SHA_TAR
                    (PowerShell lo muestra en mayusculas: es el mismo valor)

Imagenes (ID que debe mostrar «docker images --no-trunc» tras docker load):
  transporte-backend:$VERSION   $ID_BACK
  transporte-frontend:$VERSION  $ID_FRONT

Codigo:
  transporte-backend   $COMMIT_BACK
  transporte-frontend  $COMMIT_FRONT

Frontend compilado con:
  VITE_API_BASE_URL     (vacia: pide al propio origen)
  VITE_AUTH_PORTAL_URL  $PORTAL
  VITE_AUTH_LOGOUT_URL  $LOGOUT
  VITE_AUTH_MODULE_CODE ${MODULO:-(vacio)}
  bundle principal      $BUNDLE
EOF

echo
echo "Paquete listo: $DESTINO"
cat "$DESTINO/SHA256-ESPERADOS.txt"
echo
echo "El entorno local no cambio: el compose de desarrollo sigue usando las imagenes :latest."
