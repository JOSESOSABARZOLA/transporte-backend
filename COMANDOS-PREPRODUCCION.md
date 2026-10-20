################################################################################
# Actualizar PREPRODUCCION · Modulo Transportes / Cuadro de Colores
# PLANTILLA VERSIONADA (sin IP, sin sha). Cada entrega copia este archivo a su paquete
# preproduccion_<AAAAMMDD>/ y reemplaza los marcadores <...> con los valores de
# SHA256-ESPERADOS.txt. Los tres ambientes: DESPLIEGUE.md, «Los tres ambientes».
#
# Servidor: el actual, <IP_PREPRODUCCION>. Se entra por http://<IP_PREPRODUCCION>:5180,
# directo al nginx del frontend (SIN Gateway). Compose: docker-compose.prod.yml, sin overlay.
# Codigo: transporte-backend <COMMIT_BACKEND> · transporte-frontend <COMMIT_FRONTEND> (main)
# Imagenes: gestion-preproduccion-<AAAAMMDD>.tar (transporte-backend:1.1.0 + transporte-frontend:1.1.0)
#   sha256 <SHA256_TAR>
#
# Carpeta de trabajo en el servidor: ~/transportes
# Reemplazar <usuario> por el usuario SSH. Si docker exige sudo, anteponerlo.
# Ningun comando lleva el caracter de exclamacion (bash lo toma como historial).
################################################################################


# ==============================================================================
# A · EN LA MAQUINA DE DESARROLLO (PowerShell): comprobar y copiar el paquete
# ==============================================================================

Get-FileHash .\preproduccion_<AAAAMMDD>\gestion-preproduccion-<AAAAMMDD>.tar -Algorithm SHA256
#   esperado: <SHA256_TAR> (en mayusculas)
scp -r .\preproduccion_<AAAAMMDD> <usuario>@<IP_PREPRODUCCION>:~/transportes/
ssh <usuario>@<IP_PREPRODUCCION>


# ==============================================================================
# B · EN EL SERVIDOR (bash)
# ==============================================================================

# B.1 · Entrar a la carpeta nueva, comprobar el .tar y traer el .env.prod vigente
cd ~/transportes/preproduccion_<AAAAMMDD>
sha256sum gestion-preproduccion-<AAAAMMDD>.tar     # el mismo valor de la cabecera
ls ~/transportes/*/.env.prod                       # ubicar el .env.prod que usa el servidor hoy
cp ~/transportes/<carpeta-actual>/.env.prod .      # la ruta que mostro la linea anterior

# B.2 · Proyecto Compose que corre hoy (CRITICO: conserva la base y sus volumenes)
PROYECTO=$(docker inspect transportedb --format '{{index .Config.Labels "com.docker.compose.project"}}')
echo "Proyecto actual: $PROYECTO"                  # NO debe salir vacio
DC="docker compose -p $PROYECTO --env-file .env.prod -f docker-compose.prod.yml"

# B.3 · Respaldo de la base (OBLIGATORIO)
docker exec transportedb pg_dump -U postgres -Fc transportedb > respaldo-<AAAAMMDD>.dump
ls -lh respaldo-<AAAAMMDD>.dump                    # que no pese 0

# B.4 · TRUST_PROXY=1 en el .env.prod (desde 2026-10-16; UNA vez)
#   El usuario llega al nginx del frontend y este reenvia al backend: un salto. Sin esta linea,
#   el limite de peticiones cuenta a todos los usuarios como uno (429 en el ingreso).
grep -n '^TRUST_PROXY=' .env.prod || echo 'TRUST_PROXY=1' >> .env.prod
grep -n '^TRUST_PROXY=' .env.prod                  # esperado: TRUST_PROXY=1 (no 2: aqui no hay Gateway)

# B.5 · Ultimas migraciones aplicadas (solo lectura)
docker exec transportedb psql -U postgres -d transportedb -c "SELECT migration_name, finished_at FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 4;"
#   anotar la ultima: sirve para la reversion (D). Las que traiga esta entrega van en E.
docker exec transportedb psql -U postgres -d transportedb -c "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;"
#   esperado: 0 filas (una migracion fallida sin resolver bloquea migrate deploy: detenerse)

# B.6 · Comprobaciones propias de ESTA entrega, antes de migrar (si E las pide)

# B.7 · Apartar las imagenes 1.1.0 que corren hoy (son la reversion) y cargar las nuevas
docker tag transporte-backend:1.1.0  transporte-backend:1.1.0-anterior
docker tag transporte-frontend:1.1.0 transporte-frontend:1.1.0-anterior
docker load -i gestion-preproduccion-<AAAAMMDD>.tar
docker images --no-trunc --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep ':1.1.0 '
#   esperado EXACTO (si no coincide, el .tar cargado no es este paquete: NO seguir):
#     transporte-frontend:1.1.0 <ID_FRONTEND>
#     transporte-backend:1.1.0  <ID_BACKEND>

# B.9 · Migraciones (OBLIGATORIO, antes de levantar). Corre con la imagen nueva.
$DC run --rm transporte-app npx prisma migrate deploy
#   Debe terminar con "All migrations have been successfully applied." o con
#   "No pending migrations to apply.". Si falla: NO levantar, ir a D (reversion).

# B.11 · Levantar con las imagenes nuevas (misma etiqueta: hay que forzar la recreacion)
$DC up -d --force-recreate transporte-app transporte-front
$DC ps                                             # los tres "healthy"

# B.12 · Pasos propios de ESTA entrega despues de levantar (si E los pide)


# ==============================================================================
# C · COMPROBACION
# ==============================================================================

$DC run --rm transporte-app npx prisma migrate status                           # "Database schema is up to date"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3005/api/v1/estado    # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5180/health           # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5180/api/v1/estado    # 200

# El frontend que corre es el NUEVO (las tres deben coincidir con SHA256-ESPERADOS.txt):
docker inspect transporte-front --format '{{.Image}}'
#   esperado: <ID_FRONTEND>. Si sale otro: el contenedor no se recreo -> repetir B.11
curl -s http://localhost:5180/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
#   esperado: <BUNDLE>
docker exec transporte-front sh -c 'grep -rl "<PORTAL_HOST>" /usr/share/nginx/html/assets | wc -l'
#   esperado: 1 o mas (el portal de Auth con el que se compilo)
# Si el servidor responde lo nuevo pero el navegador muestra lo viejo, es la cache del
# navegador: Ctrl+F5, o abrir en una ventana privada.
# En la aplicacion: ingreso completo por el portal, Registro de operativo, matriz y un PDF.


# ==============================================================================
# D · REVERSION (solo si algo sale mal)
# ==============================================================================

$DC stop transporte-front transporte-app
docker exec -i transportedb pg_restore -U postgres -d transportedb --clean --if-exists < respaldo-<AAAAMMDD>.dump
#   revisar que no termine con "errors ignored on restore".
docker tag transporte-backend:1.1.0-anterior  transporte-backend:1.1.0
docker tag transporte-frontend:1.1.0-anterior transporte-frontend:1.1.0
$DC up -d --force-recreate transporte-app transporte-front
docker exec transportedb psql -U postgres -d transportedb -c "SELECT migration_name FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 2;"
#   esperado: la misma ultima migracion que mostro B.5


# ==============================================================================
# E · NOTAS DE ESTA ENTREGA (se completan en cada paquete)
# ==============================================================================
#
# Migraciones nuevas: <lista o «ninguna»>
# Comprobaciones previas (B.6) y pasos posteriores (B.12): <si aplica>
# Lo que cambia para los usuarios: <resumen>


# ==============================================================================
# F · ANEXO: rearmar el paquete en la maquina de desarrollo
# ==============================================================================
#
#   cd transporte-backend
#   ./scripts/empaquetar.sh preproduccion http://<IP_SERVIDOR_AUTH>:10006/login
#   (un .tar rearmado tiene otro sha256: actualizar la cabecera con SHA256-ESPERADOS.txt)
