# Instalación de PRODUCCIÓN · Gestión (Módulo Transportes / Cuadro de Colores)

Primera instalación del módulo en el data center nuevo, **detrás del Gateway** de `*.quito.gob.ec`.
La instalación la hace una persona, a mano, en el servidor: este documento y la carpeta
el paquete `produccion_<AAAAMMDD>/` (lo arma `scripts/empaquetar.sh produccion <portal>`) traen todo lo necesario. Nada aquí se conecta solo al servidor.

| Ambiente | Servidor | Acceso | Dirección de la aplicación |
|---|---|---|---|
| Pruebas | `<IP_SERVIDOR_PRUEBAS>` | `ssh -p <PUERTO_SSH> <usuario>@<IP_SERVIDOR_PRUEBAS>` | `https://usit-gestion.quito.gob.ec` |
| Producción | (por confirmar) | (por confirmar) | `https://gestion-sigoc.quito.gob.ec` |

```
Navegador ──HTTPS──> Gateway (TLS, *.quito.gob.ec)
                       └─ location /  ──> transporte-front:5180     (red Docker externa amc)
                                            └─ /api/ ──> transporte-app:3003   (red interna del proyecto)
                                                           └─ transportedb:5432 (red interna, sin puerto)
```

Ningún contenedor publica puertos en el host: el 80 y el 443 son del Gateway.

> **Todos los comandos de esta guía se copian tal cual.** No llevan el carácter de exclamación
> (bash lo interpreta como historial). Donde dice `<COMPLETAR …>` hay que poner el valor real.

---

## 0. Qué hay en el paquete

Carpeta `produccion_<AAAAMMDD>/` (ver «Los tres ambientes» en `DESPLIEGUE.md`):

| Archivo | Para qué |
|---|---|
| `gestion-produccion-<AAAAMMDD>.tar` | Las dos imágenes: `transporte-backend:1.1.0` y `transporte-frontend:1.1.0` (frontend **compilado con el portal de Auth indicado al empaquetar**) |
| `docker-compose.prod.yml` | Los tres servicios (base, backend, frontend) |
| `docker-compose.gateway.yml` | Overlay: red `amc`, sin puertos publicados |
| `.env.produccion.example` | Plantilla del `.env.prod`, con lo conocido ya puesto y `<COMPLETAR …>` en lo demás |
| `INSTALACION-PRODUCCION.md` | Esta guía |

Valores esperados (los de la tabla `SHA256-ESPERADOS.txt` de la carpeta mandan si difieren):

| Qué | Valor |
|---|---|
| sha256 de `gestion-produccion-<AAAAMMDD>.tar` | ver `SHA256-ESPERADOS.txt` |
| ID de `transporte-backend:1.1.0` | ver `SHA256-ESPERADOS.txt` |
| ID de `transporte-frontend:1.1.0` | ver `SHA256-ESPERADOS.txt` |

Comprobar el `.tar` **antes de copiarlo** (PowerShell, en la máquina donde esté la carpeta):

```powershell
Get-FileHash .\nuevo_servidor_gestion\gestion-pruebas.tar -Algorithm SHA256
```

---

## A. Antes de instalar: lo que hay que pedir, y a quién

Sin estos puntos la instalación arranca, pero **nadie puede entrar**. Pedirlos primero.

### A.1 · Equipo del Gateway (`gateway-fork`)

1. Un host `usit-gestion.quito.gob.ec` (pruebas) y `gestion-sigoc.quito.gob.ec` (producción) con:
   ```nginx
   upstream gestion_frontend_upstream {
     zone gestion_frontend_upstream 64k;
     server transporte-front:5180 resolve max_fails=0;
     keepalive 16;
   }
   server {
     # listen 443 ssl; server_name usit-gestion.quito.gob.ec; certificados
     location / {
       proxy_pass http://gestion_frontend_upstream;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```
   - **Una sola regla, `location /`**: el `/api/` lo resuelve el nginx del contenedor del frontend.
     No hace falta una regla `/api` hacia el backend.
   - El contenedor se llama **`transporte-front`** y escucha en el **5180**, en la red **`amc`**.
   - Requiere `resolver 127.0.0.11 ipv6=off valid=10s;` en `http {}` y nginx >= 1.27.3 (por `resolve`).
2. **Que el Gateway NO agregue** `Content-Security-Policy`, `X-Frame-Options`,
   `X-Content-Type-Options`, `Referrer-Policy` ni `Cache-Control`: el contenedor ya los emite.
   Si el Gateway pone su propia CSP, que descarte la del contenedor
   (`proxy_hide_header Content-Security-Policy;`). Con dos CSP el navegador aplica las dos y
   se rompen llamadas sin error visible.
3. **Que SÍ ponga** HSTS, la redirección HTTP→HTTPS y el TLS.
4. Sin `root`, `try_files`, `index`, `rewrite` ni `error_page … /index.html`: el contenedor ya
   devuelve `index.html` para las rutas de la aplicación.
5. Que el Gateway esté en el **mismo host Docker** y en la red `amc`.

### A.2 · Equipo de Auth (Auth de pruebas, `usit-auth` / `usit-automatizacion`)

1. **Agregar `usit-gestion.quito.gob.ec` a `VITE_ALLOWED_REDIRECT_HOSTS`** del portal de pruebas
   (build `test2`) y `gestion-sigoc.quito.gob.ec` al de producción. Sin esto el portal muestra
   «El destino de la redirección no está permitido» y el ingreso no se completa.
2. La **ruta del módulo de Transporte** (Gestión) en la base de Auth de pruebas:
   `https://usit-gestion.quito.gob.ec`.
3. El **id del módulo** en la base de Auth de pruebas (en el Auth anterior era 80). El frontend
   de este paquete va compilado con `80`; hoy el portal no lee ese dato, así que un id distinto
   no impide entrar, pero si Auth lo empieza a usar habrá que recompilar (ver H.2).
4. **`AUTH_JWT_SECRET`** de pruebas y el **id del subsistema SIGOC** (`AUTH_SUBSYSTEM_ID`; antes 11).
5. Confirmar las URLs: `https://usit-auth.quito.gob.ec/api` (API) y
   `https://usit-auth.quito.gob.ec/api/auth/exchange` (canje).
6. Los **usuarios de Auth** (username) de quienes van a entrar: el primer administrador se crea
   por SQL con ese username (E.1.5).

### A.3 · Infraestructura / redes

- Docker Engine y **Docker Compose >= 2.24** en el servidor (`docker compose version`).
  Con uno más viejo, ver la nota del paso F.
- Si se usa Inspección o la firma digital: que el servidor alcance sus URLs.
- Espacio: unos 2 GB libres para imágenes y base.

---

## B. Copiar el paquete y cargar las imágenes

Desde una máquina que llegue al servidor (o por el medio que se use para pasar archivos):

```bash
scp -P <PUERTO_SSH> -r produccion_<AAAAMMDD> <usuario>@<IP_SERVIDOR_PRUEBAS>:~/
```

En el servidor:

```bash
mkdir -p ~/gestion
mv ~/produccion_<AAAAMMDD>/* ~/produccion_<AAAAMMDD>/.env.produccion.example ~/gestion/
cd ~/gestion
sha256sum gestion-produccion-<AAAAMMDD>.tar          # igual al de SHA256-ESPERADOS.txt
docker load -i gestion-produccion-<AAAAMMDD>.tar
docker images --no-trunc --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep ':1.1.0 '
#   los dos ID deben ser EXACTAMENTE los de SHA256-ESPERADOS.txt. Si no: NO seguir.
```

---

## C. Red `amc`

```bash
docker network inspect amc >/dev/null 2>&1 || docker network create amc
docker network inspect amc --format '{{.Name}} {{.Driver}}'      # amc bridge
```

Si la red ya existía (la creó el Gateway), no se toca.

---

## D. `.env.prod`

```bash
cd ~/gestion
cp .env.produccion.example .env.prod
openssl rand -hex 32        # -> SESSION_JWT_SECRET
openssl rand -hex 24        # -> DB_PASSWORD
openssl rand -hex 24        # -> APP_DB_PASSWORD (otra vez, distinta)
nano .env.prod              # completar cada <COMPLETAR ...>
grep -n 'COMPLETAR' .env.prod     # no debe devolver nada
chmod 600 .env.prod
```

| Variable | Valor en pruebas | Nota |
|---|---|---|
| `NODE_ENV` | `production` | Con HTTPS por delante. Exige las dos siguientes |
| `AUTH_COOKIE_SECURE` | `true` | La cookie solo viaja por HTTPS |
| `CORS_ORIGINS` | `https://usit-gestion.quito.gob.ec` | Exacto, sin barra final |
| `TRUST_PROXY` | `2` | Gateway → nginx → backend. Sin esto, 429 en el ingreso |
| `AUTH_EXCHANGE_URL` | `https://usit-auth.quito.gob.ec/api/auth/exchange` | Confirmar con Auth |
| `AUTH_API_URL` | `https://usit-auth.quito.gob.ec/api` | Confirmar con Auth |
| `AUTH_JWT_SECRET` | el de Auth de pruebas | Secreto compartido |
| `AUTH_SUBSYSTEM_ID` | el de SIGOC en Auth de pruebas | Antes 11 |
| `SESSION_JWT_SECRET` | `openssl rand -hex 32` | Propio, distinto del de Auth |
| `DB_PASSWORD` / `APP_DB_PASSWORD` | `openssl rand -hex 24` cada una | Distintas entre sí |
| `TZ` | `America/Guayaquil` | Las ventanas de carga dependen de esto |
| `INSPECCION_API_URL`, `FIRMA_*` | vacías, o los valores reales | Opcionales |

Definir el atajo que usan todos los pasos siguientes (repetirlo si se abre otra sesión SSH):

```bash
cd ~/gestion
DC="docker compose -p gestion --env-file .env.prod -f docker-compose.prod.yml -f docker-compose.gateway.yml"
$DC config --quiet && echo "configuracion valida"
```

---

## E. Base de datos

Elegir **una** de las dos opciones.

### E.1 · Base vacía (instalación limpia)

```bash
# 1 · Solo la base, y esperar a que este "healthy"
$DC up -d transportedb
$DC ps

# 2 · Extension de medicion (el guion viene dentro de la imagen)
docker run --rm --entrypoint sh transporte-backend:1.1.0 -c 'cat prisma/init-db/01-extensiones.sql' \
  | docker exec -i transportedb psql -U postgres -d transportedb

# 3 · Migraciones: crean las 53 tablas y cargan los catalogos institucionales
$DC run --rm transporte-app npx prisma migrate deploy
#   esperado: "All migrations have been successfully applied."

# 4 · Rol de la aplicacion (UNA vez, despues de migrar). Poner la APP_DB_PASSWORD del .env.prod
#     entre las comillas simples, sin quitar las dobles.
docker run --rm --entrypoint sh transporte-backend:1.1.0 -c 'cat prisma/roles/crear-rol-aplicacion.sql' \
  | docker exec -i transportedb psql -U postgres -d transportedb -v ON_ERROR_STOP=1 -v clave="'<APP_DB_PASSWORD>'"
```

**5 · Primer administrador.** Con el **username de Auth de pruebas** de esa persona. Guardar en
un archivo y ejecutarlo (así no se pelea con las comillas del shell):

```bash
cat > primer-admin.sql <<'EOF'
BEGIN;
INSERT INTO t_usuario (usua_correo, usua_nombre, usua_identificador_ad, func_id, usua_activo)
VALUES ('<correo>@quito.gob.ec', '<Apellidos Nombres>', '<username de Auth>', NULL, true);
INSERT INTO t_usuario_rol (usua_id, usro_rol)
SELECT usua_id, 'ADMINISTRADOR'::e_rol_departamental
  FROM t_usuario WHERE usua_identificador_ad = '<username de Auth>';
COMMIT;
EOF
nano primer-admin.sql
docker exec -i transportedb psql -U postgres -d transportedb -v ON_ERROR_STOP=1 < primer-admin.sql
```

- `ADMINISTRADOR` abre toda la administración. Con él se dan de alta las demás cuentas desde
  la pantalla «Cuentas del cuadro», y la flota, el personal y los turnos desde «Carga inicial».
- La correspondencia rol de Auth ↔ rol del módulo se configura en «Roles de Auth central»:
  los ids de rol del Auth de pruebas pueden no ser los del anterior.

### E.2 · Con los datos de preproducción (el servidor actual, `<IP_PREPRODUCCION>`)

**En el servidor ACTUAL** (avisar antes: durante el corte no se debe registrar nada):

```bash
cd ~/transportes/<carpeta-actual>
PROYECTO=$(docker inspect transportedb --format '{{index .Config.Labels "com.docker.compose.project"}}')
echo "$PROYECTO"                                    # no debe salir vacio
docker stop transporte-app transporte-front         # congela las escrituras
docker exec transportedb pg_dump -U postgres -Fc transportedb > gestion-datos.dump
ls -lh gestion-datos.dump                           # que no pese 0
docker run --rm -v ${PROYECTO}_transporte_uploads:/datos -v "$PWD":/respaldo alpine \
  tar czf /respaldo/gestion-uploads.tgz -C /datos .
ls -lh gestion-uploads.tgz
sha256sum gestion-datos.dump gestion-uploads.tgz > gestion-datos.sha256
docker start transporte-app transporte-front        # el servidor viejo vuelve a funcionar
```

Llevar `gestion-datos.dump`, `gestion-uploads.tgz` y `gestion-datos.sha256` a `~/gestion/`
del servidor de producción. **En el servidor de PRODUCCIÓN:**

```bash
cd ~/gestion
sha256sum -c gestion-datos.sha256                   # los dos "OK"

# 1 · Base vacia y el rol ANTES de restaurar (el respaldo trae GRANT a transporte_app)
$DC up -d transportedb
$DC ps                                              # transportedb "healthy"
docker exec transportedb psql -U postgres -d transportedb -c "CREATE ROLE transporte_app LOGIN;"

# 2 · Restaurar
docker exec -i transportedb pg_restore -U postgres -d transportedb --no-owner --role=postgres < gestion-datos.dump
#   revisar el final: sin "errors ignored on restore" (o solo el de la extension, si sale)

# 3 · Extension, migraciones (no deberia aplicar nada) y rol completo con su clave
docker run --rm --entrypoint sh transporte-backend:1.1.0 -c 'cat prisma/init-db/01-extensiones.sql' \
  | docker exec -i transportedb psql -U postgres -d transportedb
$DC run --rm transporte-app npx prisma migrate deploy
docker run --rm --entrypoint sh transporte-backend:1.1.0 -c 'cat prisma/roles/crear-rol-aplicacion.sql' \
  | docker exec -i transportedb psql -U postgres -d transportedb -v ON_ERROR_STOP=1 -v clave="'<APP_DB_PASSWORD>'"

# 4 · Documentos emitidos
docker volume create gestion_transporte_uploads
docker run --rm -v gestion_transporte_uploads:/datos -v "$PWD":/respaldo alpine \
  sh -c 'tar xzf /respaldo/gestion-uploads.tgz -C /datos && chown -R 1001:1001 /datos'

# 5 · Comprobacion de la base
docker exec transportedb psql -U postgres -d transportedb -c "SELECT count(*) AS tablas FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 't\_%';"
#   esperado: 53
```

- Los **usuarios** del módulo (`t_usuario.usua_identificador_ad`) son los usernames del Auth
  **anterior**. Si en Auth de pruebas cambian, hay que actualizarlos o nadie entra.
- Revisar en «Roles de Auth central» que los ids de rol coincidan con los del Auth de pruebas.

---

## F. Levantar

```bash
cd ~/gestion
$DC up -d
$DC ps                      # los tres "healthy" (transportedb, transporte-app, transporte-front)
docker network inspect amc --format '{{range .Containers}}{{.Name}} {{end}}'
#   debe aparecer transporte-front (y el contenedor del Gateway)
```

> **Compose anterior a 2.24.** El overlay usa la directiva `reset` de Compose para quitar los
> puertos del archivo de producción. Si `docker compose version` es menor que 2.24 y `$DC config`
> falla, editar una copia de `docker-compose.prod.yml` y **borrar** los dos bloques `ports:`
> (el de `transporte-app` y el de `transporte-front`); luego quitar las dos líneas
> `ports: …` del overlay. El resultado debe ser el mismo: ningún puerto publicado.

---

## G. Verificación

```bash
# 1 · Dentro de los contenedores
docker exec transporte-front wget -qO- http://127.0.0.1:5180/health                # ok
docker exec transporte-front wget -qO- http://127.0.0.1:5180/api/v1/estado         # {"estado":"operativo","baseDatos":"disponible"}
docker exec transporte-app id                                                      # uid=1001(nestjs)
docker inspect transporte-app transporte-front transportedb --format '{{.Name}} {{json .NetworkSettings.Ports}}'
#   ningun "HostPort": no hay puertos publicados

# 2 · El frontend es el de este paquete y apunta al portal de pruebas
docker exec transporte-front sh -c 'grep -l "usit-automatizacion.quito.gob.ec/login" /usr/share/nginx/html/assets/*.js | wc -l'   # 1
docker exec transporte-front sh -c 'grep -l "localhost:3003" /usr/share/nginx/html/assets/*.js | wc -l'                         # 0

# 3 · A traves del Gateway (desde el propio servidor; no depende de DNS ni firewall)
H=usit-gestion.quito.gob.ec
for p in / /home/cuadro/registro /auth/callback /api/v1/estado; do
  printf '%-24s %s\n' "$p" "$(curl -sk -o /dev/null -w '%{http_code}' --resolve $H:443:127.0.0.1 https://$H$p)"
done
#   los cuatro: 200
curl -skI --resolve $H:443:127.0.0.1 https://$H/ | grep -ci 'content-security-policy'      # 1 (exactamente uno)
curl -skI --resolve $H:443:127.0.0.1 https://$H/ | grep -i 'strict-transport-security'      # presente (lo pone el Gateway)
```

**4 · En el navegador** (`https://usit-gestion.quito.gob.ec`, ventana privada la primera vez):

- Entra al portal de Auth, se elige el rol y **vuelve** a `usit-gestion…/auth/callback` y al inicio.
- Registro de operativo: el selector de formulario muestra «N hoy»; «Editar» abre el panel azul.
- Matriz consolidada (como Director): «Exportar» descarga el PDF. Eso prueba que el backend
  escribe en `uploads`.
- Cerrar sesión vuelve al portal.

---

## H. Producción

Los mismos pasos A–G, con estas diferencias:

| | Pruebas | Producción |
|---|---|---|
| Host | `usit-gestion.quito.gob.ec` | `gestion-sigoc.quito.gob.ec` |
| `CORS_ORIGINS` | `https://usit-gestion.quito.gob.ec` | `https://gestion-sigoc.quito.gob.ec` |
| Auth | `usit-auth…`, portal `usit-automatizacion…/login` | los de producción (confirmar: API `https://auth-sigoc.quito.gob.ec/api`, portal `https://login-sigoc.quito.gob.ec/login`) |
| `AUTH_JWT_SECRET`, `AUTH_SUBSYSTEM_ID` | de pruebas | de producción |

### H.1 · El frontend se compila para cada ambiente

La dirección del portal de Auth queda **dentro** del JavaScript al compilar: un `.tar` armado para
el portal de pruebas **no sirve** para producción. Lo arma `scripts/empaquetar.sh` en la máquina de
desarrollo, con `main` al día (ver «Los tres ambientes» en `DESPLIEGUE.md`):

```bash
cd transporte-backend
./scripts/empaquetar.sh produccion <URL del portal de produccion, p. ej. https://login-sigoc.quito.gob.ec/login>
#   con otro id de modulo:  VITE_AUTH_MODULE_CODE=<id> ./scripts/empaquetar.sh produccion <portal>
```

Deja la carpeta `produccion_<AAAAMMDD>/` junto a los repositorios, con el `.tar`, los dos compose,
`.env.produccion.example`, esta guía y `SHA256-ESPERADOS.txt`. El backend es la **misma imagen**
que se validó en preproducción; solo el frontend cambia de un ambiente a otro.

- `VITE_API_BASE_URL` va **vacía** a propósito: el frontend llama a `/api/v1/...` en su propio
  origen. **Nunca** `/api`: duplicaría el prefijo.
- El script ya comprueba que el bundle lleve el portal indicado y no lleve `localhost:3003`.

### H.2 · Si Auth de pruebas da otro id de módulo

Volver a empaquetar con H.1 y el portal de pruebas (`https://usit-automatizacion.quito.gob.ec/login`)
con `VITE_AUTH_MODULE_CODE=<id>`, y volver a B.

---

## I. Actualizar una versión y revertir

**Actualizar** (imágenes nuevas en un `.tar`):

```bash
cd ~/gestion
docker exec transportedb pg_dump -U postgres -Fc transportedb > respaldo-$(date +%Y%m%d).dump
docker tag transporte-backend:1.1.0  transporte-backend:1.1.0-anterior
docker tag transporte-frontend:1.1.0 transporte-frontend:1.1.0-anterior
docker load -i <paquete-nuevo>.tar
$DC run --rm transporte-app npx prisma migrate deploy
$DC up -d --force-recreate transporte-app transporte-front
$DC ps
```

`--force-recreate` es obligatorio: la etiqueta es la misma y sin él el contenedor puede quedarse
con la imagen anterior.

**Revertir:**

```bash
$DC stop transporte-front transporte-app
docker exec -i transportedb pg_restore -U postgres -d transportedb --clean --if-exists < respaldo-<fecha>.dump
docker tag transporte-backend:1.1.0-anterior  transporte-backend:1.1.0
docker tag transporte-frontend:1.1.0-anterior transporte-frontend:1.1.0
$DC up -d --force-recreate transporte-app transporte-front
```

---

## J. Respaldo diario (recomendado)

```bash
mkdir -p ~/gestion/respaldos
crontab -e
```

Agregar esta línea (todos los días a las 02:30, conserva 14 días):

```
30 2 * * * docker exec transportedb pg_dump -U postgres -Fc transportedb > $HOME/gestion/respaldos/gestion-$(date +\%Y\%m\%d).dump && find $HOME/gestion/respaldos -name 'gestion-*.dump' -mtime +14 -delete
```

Copiar los respaldos fuera del servidor periódicamente: un respaldo en el mismo disco no protege
de perder el disco.

---

## K. Problemas frecuentes

| Síntoma | Causa probable | Qué revisar |
|---|---|---|
| **502** en `usit-gestion…` | `transporte-front` no está en la red `amc`, o el Gateway usa otro nombre/puerto | `docker network inspect amc`; el `upstream` debe ser `transporte-front:5180` |
| El portal dice **«El destino de la redirección no está permitido»** | El host no está en `VITE_ALLOWED_REDIRECT_HOSTS` del portal | A.2.1 (equipo de Auth) |
| Vuelve del portal y sale **«No se pudo completar el ingreso»** / 401 | `AUTH_JWT_SECRET`, `AUTH_SUBSYSTEM_ID` o `AUTH_EXCHANGE_URL` no son los de ese Auth | `.env.prod`; `docker logs transporte-app` |
| Entra y **vuelve a pedir ingreso** (la sesión no queda) | Cookie sin `Secure` sobre HTTPS, u origen distinto de `CORS_ORIGINS` | `AUTH_COOKIE_SECURE=true`, `CORS_ORIGINS` exacto |
| **El usuario no tiene acceso** tras ingresar | Su username de Auth no está en `t_usuario`, o su rol de Auth no está mapeado | «Cuentas del cuadro» y «Roles de Auth central» |
| **429** al ingresar o usar la aplicación | Falta `TRUST_PROXY=2`: todos cuentan como una IP | `.env.prod`, `$DC up -d --force-recreate transporte-app` |
| `transporte-app` **no arranca** | `validar-entorno.ts` lo detiene a propósito | `docker logs transporte-app`: dice qué variable falta (CORS, cookie, TRUST_PROXY, clave corta) |
| Llamadas bloqueadas, **pantalla en blanco** sin error | Dos `Content-Security-Policy` (la del Gateway y la del contenedor) | `curl -skI … | grep -ci content-security-policy` debe dar 1 |
| **No se ven los cambios** tras actualizar | Contenedor con la imagen vieja, o caché del navegador | `docker inspect transporte-front --format '{{.Image}}'` = ID esperado; Ctrl+F5 |
| El PDF **no se descarga** / error al emitir | Permisos del volumen `uploads` | `docker exec transporte-app ls -ld /app/uploads` (dueño 1001) |
| `docker compose` **rechaza el overlay** | Compose < 2.24 | Nota del paso F |
