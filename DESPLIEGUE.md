# Despliegue · Módulo Transportes / Cuadro de Colores

Agencia Metropolitana de Control · Actualizado el **2026-10-01** (producción por `.tar`, como Instrucción)

> **Desde la entrega 1.1.0 las imágenes se empaquetan ETIQUETADAS POR VERSIÓN** (`:1.1.0`), no
> `:latest`, porque `docker-compose.prod.yml` las fija por esa etiqueta. El paquete es una
> carpeta `transporte_<fecha>` con **cuatro** archivos —el cuarto es `PASOS-PRODUCCION.md`, el
> procedimiento resumido de ESA entrega—. Ver §7.1, §7.2 y §8.

Este archivo es el procedimiento, no una explicación. Lo que hay detrás de cada decisión está
comentado en `docker-compose.yml`, en `docker-compose.prod.yml`, en los dos `Dockerfile` y en
`M30_CONTENEDORES.md`.

> **ES EL ÚNICO PROCEDIMIENTO.** `docs/final/08_Manual_Instalacion.md` y
> `09_Manual_Despliegue.md` describían lo mismo con distinto detalle y ya divergían entre sí:
> desde hoy remiten aquí y conservan solo lo que les es propio —requisitos, respaldo, reversión
> y la lista de comprobación—. Tres documentos para un procedimiento es tres oportunidades de
> que uno mienta.

> **La sección 7 es la que se usa en el servidor.** Las secciones 1 a 6 construyen en la
> máquina y sirven para desarrollo y para preparar el paquete.

---

## 0. Antes de empezar

```bash
cp .env.example .env      # PowerShell: Copy-Item .env.example .env
```

Y completar en `.env`:

| Variable | Qué poner |
|---|---|
| `DB_PASSWORD` | La contraseña de `postgres`. **Sin ella `docker compose up` se detiene.** La usan el contenedor de la base y **las migraciones**, no la aplicación |
| `APP_DB_PASSWORD` | La contraseña de `transporte_app`, el rol con que corre la aplicación. **Distinta de la anterior** |
| `TZ` | `America/Guayaquil`. **Crítico**: de esto dependen las ventanas de carga |
| `CORS_ORIGINS` | Los orígenes reales del frontend, separados por coma |

Y las de la sesión, sin las cuales **el contenedor arranca pero nadie puede entrar**: el canje
responde 401 y el registro dice por qué.

| Variable | Qué poner |
|---|---|
| `AUTH_EXCHANGE_URL` | `http://<host-de-auth>:10004/auth/exchange` |
| `AUTH_JWT_SECRET` | **Secreto.** La clave con que Auth central firma. La entrega ese equipo |
| `AUTH_SUBSYSTEM_ID` | `11` · SIGOC |
| `SESSION_JWT_SECRET` | **Secreto, y distinto del anterior.** Con el que este módulo firma su propia cookie |
| `JWT_AUDIENCE` | `TRANSPORTE` · el mismo valor que `AUTH_MODULE_CODE` en el frontend |
| `AUTH_COOKIE_SECURE` | `false` sobre HTTP. **`true` en producción con HTTPS**, o el navegador descarta la cookie |

### La aplicación NO corre como superusuario

Son **dos roles distintos**, y la separación es el motivo de que existan dos claves.

| Rol | Quién lo usa | Qué puede |
|---|---|---|
| `transporte_app` | La aplicación en ejecución | `SELECT`, `INSERT`, `UPDATE`, `DELETE` sobre las tablas, y usar las secuencias. **Nada más** |
| `postgres` | El contenedor de la base y **las migraciones** | Todo |

`transporte_app` **no puede** crear ni alterar tablas, ni leer `_prisma_migrations`, ni crear
roles. Si una inyección SQL prospera, ése es el límite del daño. Antes la aplicación se conectaba
como `postgres` —superusuario, con `BYPASSRLS`— y el límite era el servidor entero.

**Prisma separa las dos por su cuenta:** el cliente en ejecución usa `url` y las migraciones usan
`directUrl`, ambas declaradas en `schema.prisma`. No hay que acordarse de cambiar nada al migrar.

```
DATABASE_URL         → transporte_app   · el cliente, en ejecución
DIRECT_DATABASE_URL  → postgres         · migrate deploy, migrate dev, introspección
```

#### Dar de alta a una persona

**El alta se hace desde la aplicación**, en **Administración → Cuentas del cuadro**
(`/administracion/usuarios`). La pantalla resuelve la ficha de personal **por cédula**, avisa si el
rol elegido no tiene camino desde Auth, y señala las cuentas que no pueden entrar por faltarles el
usuario de Auth.

Se conserva el SQL de abajo para el **primer administrador**, que es el problema del huevo y la
gallina: sin una cuenta con rol `ADMINISTRADOR_DMIP` nadie puede abrir esa pantalla.

> **CORREGIDO EL 2026-08-28, Y ESTABA MAL DESDE EL 19-AGO.** El SQL de aquí insertaba en una
> columna `usua_rol` que **ya no existe**: los roles se movieron a `t_usuario_rol` cuando una
> persona pasó a poder tener varios. Fallaba con `column "usua_rol" ... does not exist`,
> justo en el paso que existe para que alguien pueda entrar por primera vez.
>
> Se descubrió ejecutando el despliegue completo en un ensayo. Son **dos inserciones**, y van
> en una transacción: una cuenta sin rol no puede entrar y no avisa de por qué.

```sql
BEGIN;

INSERT INTO t_usuario (usua_correo, usua_nombre, usua_identificador_ad, func_id, usua_activo)
VALUES ('nombre.apellido@quito.gob.ec', 'Apellidos Nombres', 'nusuario',
        (SELECT func_id FROM t_funcionario WHERE func_cedula = '0000000000'), true);

INSERT INTO t_usuario_rol (usua_id, usro_rol)
SELECT usua_id, 'ADMINISTRADOR_DMIP'::e_rol_departamental
  FROM t_usuario WHERE usua_identificador_ad = 'nusuario';

COMMIT;
```

Tres cosas que hay que acertar:

- **`usua_identificador_ad`** es el usuario de Auth y es la llave del canje. Si no coincide, esa
  persona no entra.
- **`usro_rol`** decide qué formularios ve, y va en `t_usuario_rol`. Se puede repetir la segunda
  inserción para dar **varios roles**: valen todos a la vez y la persona ve la unión.
- **`func_id`** enlaza con la ficha de personal. Sin él, P-06 «Mis órdenes» responde que no tiene
  ficha asociada. La subconsulta por cédula lo resuelve; si la persona no sale a operativos
  —Dirección, administración— déjelo nulo. **Para el primer administrador, `NULL` sirve.**

| Rol en Auth | `usro_rol` |
|---|---|
| 53 · Transporte - Operativos | `DMIP_OPERATIVOS` |
| 54 · Transporte - DMIP Inspeccion | `DMIP_INSPECCIONES` |
| 55 · Transporte - DMIT Instructor | `DMIT_INSTRUCTOR` |
| 56 · Transporte - DAF | `DAF` |
| 57 · Transporte - Director | `DIRECTOR` |
| 58 · Transporte - Administrador | `ADMINISTRADOR_DMIP` |
| *(no existe todavía)* | `FUNCIONARIO` |

> **Sigue sin haber pantalla de administración de usuarios.** Es el coste conocido de esta decisión,
> y está registrado como limitación.

#### Al crear la base por primera vez

El rol no existe hasta que se crea. El guion está en `prisma/roles/crear-rol-aplicacion.sql` y hay
que ejecutarlo **una vez por base**, incluida `transportedb_pruebas`, después de la primera
migración.

> **Lo que se olvida siempre, y falla en ejecución y no al migrar:** los `GRANT` solo alcanzan a lo
> que ya existe. Por eso el guion incluye `ALTER DEFAULT PRIVILEGES`: sin eso, **la próxima
> migración que cree una tabla la dejaría inaccesible** para la aplicación, con un
> `permission denied` en producción y ninguna pista al desplegar.

#### Dos valores que ya vienen puestos y conviene no quitar

| Dónde | Valor | Qué evita |
|---|---|---|
| `DATABASE_URL` | `connection_limit=10` | Sin él Prisma abre **57 conexiones por instancia** —`num_cpus × 2 + 1`, y son 28 núcleos— contra un `max_connections` de 100. **Dos réplicas agotan el servidor** |
| `command:` de la base | `idle_in_transaction_session_timeout=60000` | Que una transacción abandonada retenga bloqueos e **impida que autovacuum limpie**, indefinidamente |
| `command:` de la base | `lock_timeout=10000` | Que una consulta espere para siempre por un bloqueo |

Si aumenta el número de réplicas, **baje `connection_limit`**: el presupuesto total es
`max_connections`, repartido entre todas las instancias.

> **Los dos secretos son distintos a propósito.** `AUTH_JWT_SECRET` sirve para *verificar* lo que
> Auth firmó, y vale para **todos** los módulos del ecosistema; `SESSION_JWT_SECRET` es solo de
> este módulo y firma su cookie. Usar el mismo valor en los dos permitiría a cualquier módulo
> integrado emitir sesiones válidas aquí.
>
> **Si `SESSION_JWT_SECRET` queda vacía**, el guardián ignora la cookie y escribe una advertencia
> en el registro en lugar de fallar. Toda petición responderá 401.

> **Ya no existe `MODO_IDENTIDAD_PROVISIONAL`.** Se retiró el 2026-08-18 con la etapa 5, junto a la
> cabecera `x-usuario-prueba` y el catálogo `usuarios-prueba.ts`. Mientras existió, con el modo
> encendido **cualquiera podía declararse `DIRECTOR`** y ver la matriz consolidada entera. Si
> encuentra esa variable en un `.env` heredado, sobra: no la lee nadie.

### El origen del frontend debe coincidir con el registrado en Auth

El portal devuelve al usuario a la ruta que tenga el **módulo 80** en el subsistema 11, y le añade
`/auth/callback` por su cuenta. Hoy es `localhost:5180`. Si el frontend se sirve desde otro
origen, hay que cambiarlo **en los dos sitios** —Auth y `CORS_ORIGINS`— o el ingreso no se cierra.

> **`localhost` solo funciona en la máquina que abre el navegador**, y se eligió a propósito: es
> **contexto seguro**, y varias API del navegador —`crypto.randomUUID` entre ellas— no existen
> sobre HTTP en una dirección IP. Para que entre alguien desde otro equipo hace falta la IP o un
> nombre, y entonces **HTTPS deja de ser opcional**.

---

## 1. Construir las imágenes

```bash
docker compose build
```

Construye las dos: `transporte-backend:latest` y `transporte-frontend:latest`. El cliente de Prisma
se genera **dentro** de la imagen del backend; nunca se copia de la máquina de desarrollo.

### 1.1. Lo que se hornea, y no se puede cambiar después

> **Las variables `VITE_` se sustituyen en el paquete AL CONSTRUIR. No se leen al arrancar.**
>
> Ponerlas en el `.env` del servidor no hace nada: la imagen ya está construida. Si hay que
> cambiar la dirección del portal de Auth, **se reconstruye la imagen**. No hay otra vía.

| Variable | Por omisión | Cuándo se pasa |
|---|---|---|
| `VITE_API_BASE_URL` | vacía | **Nunca.** Vacía significa «al propio origen», y el nginx de la imagen hace de proxy |
| `VITE_AUTH_PORTAL_URL` | vacía → respaldo del fuente | Cuando Auth central deje de estar en `172.20.136.127` |
| `VITE_AUTH_LOGOUT_URL` | vacía → hereda del portal | Cuando Auth publique una pantalla de despedida |
| `VITE_AUTH_MODULE_CODE` | vacía → `TRANSPORTE` | Nunca, salvo que cambie el código del módulo |

```bash
# Con Auth en otro servidor:
VITE_AUTH_PORTAL_URL=http://<host>:10006/login docker compose build transporte-front
```

**Hoy no hace falta pasar ninguna**, porque producción y Auth central viven en la misma
máquina y el respaldo de `src/config/env.ts` acierta. Existen para que ese día sea un
argumento de construcción y no un cambio de código fuente.

> **Cuidado al comprobarlo.** Buscar la dirección en el paquete **no prueba nada**: la
> constante de respaldo queda como literal en el archivo aunque no se use, así que
> `grep` la encuentra siempre. Lo que hay que comprobar es que aparezca **la que se quiso**,
> y confirmarlo entrando de verdad por el portal.

---

## 2. Levantar la base de datos

```bash
docker compose up -d transportedb
```

Con el volumen vacío, `prisma/init-db/01-extensiones.sql` crea `pg_stat_statements` sola.

**Sobre un despliegue que ya tiene datos, el script no corre** —así funciona
`/docker-entrypoint-initdb.d`— y hay que crear la extensión a mano, una vez:

```bash
docker exec transportedb psql -U postgres -d transportedb -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
```

Para comprobar que quedó:

```bash
docker exec transportedb psql -U postgres -d transportedb -tAc "SELECT extname FROM pg_extension;"
```

---

## 3. Aplicar las migraciones · paso explícito

**El arranque del contenedor NO aplica migraciones**, y es deliberado: un contenedor que migra al
arrancar aplica cambios de esquema cada vez que se reinicia, en el peor momento posible, y con
varias réplicas los aplica varias veces a la vez.

```bash
docker compose run --rm transporte-app npx prisma migrate deploy
```

Para ver el estado sin aplicar nada:

```bash
docker compose run --rm transporte-app npx prisma migrate status
```

> **Tres migraciones nuevas el 2026-08-31, de la implementación DAF.** Se aplican con el
> mismo `migrate deploy` y **no exigen ningún paso extra**, pero conviene saber qué tocan
> antes de ejecutarlas en producción:
>
> | Migración | Qué hace | Riesgo |
> |---|---|---|
> | `…090000_el_mantenimiento_del_vehiculo_lleva_taller_y_hora` | Dos columnas nulables en `t_disponibilidad` y dos `CHECK` | Ninguno: nada existente deja de valer |
> | `…120000_el_vehiculo_tiene_destino_al_terminar_la_jornada` | Crea `t_ubicacion_flota` y `t_destino_vehiculo` | Ninguno: tablas nuevas y vacías |
> | `…130000_el_conductor_tiene_sector_parqueadero_y_contrato` | Enumerado `e_sector_ciudad` y tres columnas en `t_conductor` | Ninguno: las tres nacen nulables o con defecto |
>
> **`t_ubicacion_flota` nace VACÍA a propósito**, y hasta que el Administrador la cargue la
> DAF no podrá declarar dónde queda cada vehículo. La pantalla lo explica en palabras en
> lugar de mostrar un desplegable vacío. El motivo es que la evidencia se contradice —cinco
> zonales en la hoja de agosto, cuatro en la reunión— y es la pregunta **Q-01**.
>
> Después de aplicarlas, `npm run prisma:verificar` debe decir
> **32 tablas, 13 enumerados, 28 restricciones y 11 índices parciales**.

---

## 4. Sembrar catálogos · solo la primera vez

Desde la máquina de desarrollo, con `DATABASE_URL` apuntando al puerto publicado (5434):

```bash
# Ya NO hace falta sembrar: los catálogos institucionales —los nueve formularios, zonales,
# tipos de control, instituciones, ventanas y parámetros— entran con `migrate deploy`.
```

La semilla termina ejecutando **`ANALYZE`**. No es opcional: el planificador de PostgreSQL decide
con estadísticas, y sobre tablas recién pobladas no tiene ninguna. Si se siembra por otro camino,
hay que ejecutarlo a mano:

```bash
docker exec transportedb psql -U postgres -d transportedb -c "ANALYZE;"
```

> La semilla **no completa** los catálogos que dependen de decisiones del negocio. Imprime al final
> qué quedó sin cargar y por qué. Ver `PENDIENTES-VALIDACION.md`.

### 4.1. Base de las pruebas de integración

`npm run test:integracion` **no usa la base de desarrollo**: usa `transportedb_pruebas`, en el mismo
servidor. El motivo está en `test/entorno-integracion.ts`, y en resumen es que
`ck_formulario_numero` solo admite del 1 al 9: si el catálogo institucional ocupa los nueve
casilleros, las suites no tienen dónde crear los suyos.

Se prepara una vez:

```bash
docker exec transportedb psql -U postgres -c "CREATE DATABASE transportedb_pruebas;"

PRUEBAS="postgresql://postgres:CLAVE@localhost:5434/transportedb_pruebas?schema=public"

# Migraciones y catálogos base sobre ella. La semilla detecta el nombre y NO siembra
# los nueve formularios, a propósito.
DATABASE_URL="$PRUEBAS" DIRECT_DATABASE_URL="$PRUEBAS" npx prisma migrate deploy
# Tampoco aquí. La migración detecta que es la base de pruebas y omite a propósito los
# nueve formularios: `ck_formulario_numero` solo admite del 1 al 9 y las suites necesitan
# esos casilleros libres.
```

> ### ⚠ HAY QUE EXPORTAR LAS DOS VARIABLES, Y OMITIR LA SEGUNDA NO DA ERROR
>
> **Descubierto el 2026-08-31.** `migrate deploy` no abre la conexión por `DATABASE_URL`
> sino por **`directUrl`**, que el esquema lee de `DIRECT_DATABASE_URL`. Exportando solo la
> primera —como decía este apartado hasta hoy—, `DIRECT_DATABASE_URL` se resuelve desde
> `.env` y el comando **migra la base de desarrollo**.
>
> Y lo hace en silencio. No falla, no avisa: responde `No pending migrations to apply.`,
> porque desarrollo ya las tenía todas. Lo único que lo delata es una línea que se lee como
> cabecera decorativa:
>
> ```
> Datasource "db": PostgreSQL database "transportedb", schema "public" at "localhost:5434"
> ```
>
> Conviene leerla siempre antes que el resultado: **es la que dice qué base se tocó de
> verdad.** El bloque de `migrate resolve` de más abajo sí exportaba las dos desde el
> principio; era este el que se contradecía con él.

> ### ⚠ Cuatro migraciones NO se pueden aplicar a esta base, y hay que resolverlas a mano
>
> **Descubierto el 2026-08-31.** Las cuatro migraciones del 27-AGO terminan con un bloque
> `DO $$` que verifica un resultado sobre **los nueve formularios institucionales**… que en
> `transportedb_pruebas` no existen, precisamente porque la migración de agosto los omite a
> propósito. El resultado es que `migrate deploy` falla con mensajes como
> `El formulario DMIT quedó con 0 áreas y debía quedar con 4`.
>
> **Consecuencia real: las pruebas de integración llevaban sin poder ejecutarse desde el
> 25-AGO**, y el fallo aparecía en el `beforeAll`, donde no se leía como lo que era.
>
> Sobre esta base las cuatro son **no operaciones legítimas** —no hay formularios a los que
> aplicar nada—, así que se marcan como aplicadas:
>
> ```bash
> PRUEBAS="postgresql://postgres:CLAVE@localhost:5434/transportedb_pruebas?schema=public"
>
> for M in 20260827090000_el_formulario_dmit_admite_las_cuatro_areas \
>          20260827100000_retira_el_area_ccf \
>          20260827140000_el_personal_ofrecido_se_filtra_por_rol \
>          20260827160000_la_ecu_vuelve_a_ser_formulario_de_aporte; do
>   DATABASE_URL="$PRUEBAS" DIRECT_DATABASE_URL="$PRUEBAS" npx prisma migrate resolve --applied "$M"
> done
> ```
>
> **Y una de ellas SÍ trae DDL, que hay que aplicar aparte.** `20260827140000` agrega una
> columna antes de verificar; al fallar, la transacción la revierte, y marcarla como
> aplicada no la crea. Sin esto, toda la suite falla con
> `The column form_filtra_personal_por_rol does not exist`:
>
> ```bash
> docker exec transportedb psql -U postgres -d transportedb_pruebas -c \
>   "ALTER TABLE public.t_formulario ADD COLUMN IF NOT EXISTS form_filtra_personal_por_rol BOOLEAN NOT NULL DEFAULT true;"
> ```
>
> Después, `migrate deploy` aplica el resto con normalidad.
>
> **Lo que hay que corregir para que esto no se repita:** toda migración cuyo bloque de
> verificación dependa de datos sembrados debe llevar la guarda que ya usa la migración
> `20260819210000`:
>
> ```sql
> IF current_database() = 'transportedb_pruebas' THEN
>   RAISE NOTICE 'Base de pruebas: se omite la comprobacion.';
>   RETURN;
> END IF;
> ```
>
> Las tres migraciones del 31-AGO **sí la cumplen por construcción**: verifican objetos de
> esquema —columnas y restricciones—, no filas sembradas, así que corren en cualquier base.

Tras cada migración nueva hay que repetir el `migrate deploy` sobre esa base.

---

## 5. Levantar todo

```bash
docker compose up -d
```

| Servicio | Puerto externo | Comprobación |
|---|---|---|
| `transportedb` | 5434 | `pg_isready` |
| `transporte-app` | 3003 | `GET /api/v1/estado` |
| `transporte-front` | 5180 | `GET /health` |

Los puertos evitan la colisión con el módulo de Instrucción (5433, 3002, 5175).

---

## 6. Comprobación posterior

```bash
docker compose ps                                        # los tres «healthy»
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3003/api/v1/estado    # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5180/health           # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5180/api/v1/estado    # 200, por el proxy

docker exec transporte-app id                            # uid=1001(nestjs) · NO root
docker exec transporte-front id                          # uid=101(nginx)  · NO root
docker exec transporte-app sh -c 'date'                  # debe decir -05
```

> **Se retiró de aquí `grep -i PROVISIONAL`.** Era la comprobación que cerraba esta lista,
> y desde el 2026-08-18 **no puede devolver nada**: `MODO_IDENTIDAD_PROVISIONAL` se eliminó
> con la etapa 5, junto a la cabecera `x-usuario-prueba`. Una comprobación que siempre pasa
> es peor que ninguna: da por verificado algo que ya nadie mira.

---

## 7. Producción · el servidor 172.20.136.127

Las secciones 1 a 6 describen el despliegue **construyendo en la máquina**. En el servidor
no se construye: se llevan las imágenes ya hechas, como hace el módulo de Instrucción.

**Por qué.** Construir exige el código fuente completo, la cadena de Node y salida a la red
para `npm ci`. Es más superficie, más cosas que pueden fallar el día de la entrega, y una
imagen que nadie probó. Con el `.tar` se despliega **exactamente el binario que se verificó**.

> **`172.20.136.127` es también donde vive Auth central**: la API en el `10004` y el portal
> en el `10006`. Por eso el respaldo del frontend acierta sin pasar ningún argumento.

### 7.1. Empaquetar, en la máquina de desarrollo

```bash
npm test && npm run lint && npm run build      # en los dos repositorios
docker compose build                           # deja las dos imagenes en :latest

# ETIQUETAR con la version de la entrega —la MISMA que fija docker-compose.prod.yml—.
VER=1.1.0
docker tag transporte-backend:latest  "transporte-backend:$VER"
docker tag transporte-frontend:latest "transporte-frontend:$VER"

# Empaquetar las imagenes ETIQUETADAS POR VERSION, no :latest.
docker save -o "transporte-$(date +%Y%m%d).tar" "transporte-backend:$VER" "transporte-frontend:$VER"
```

> **Por qué por versión y no `:latest`.** `docker-compose.prod.yml` fija
> `image: transporte-backend:1.1.0` / `transporte-frontend:1.1.0`. Si el `.tar` llevara `:latest`,
> `docker load` dejaría en el servidor unas etiquetas que el compose **no encuentra**, y
> `up -d` fallaría buscando `:1.1.0`. **Cada entrega sube el pin de las dos imágenes en
> `docker-compose.prod.yml` y usa ese mismo número en `VER`.** La versión sale de
> `transporte-frontend/package.json` (hoy `1.1.0`).

El `.env.prod` real se entrega **aparte, por canal seguro**: trae las cuatro claves y no viaja
en la carpeta del paquete.

### 7.2. El paquete es una carpeta con CUATRO archivos

```
transporte_<fecha>/
├── docker-compose.prod.yml         # versionado, se copia tal cual (fija las imagenes a :<ver>)
├── .env.prod.example               # plantilla de los secretos (referencia, NO trae claves)
├── PASOS-PRODUCCION.md             # el procedimiento de ESTA entrega: version, migraciones, reversion
└── transporte-<fecha>.tar          # las dos imagenes, etiquetadas por version
```

El `.env.prod` **REAL** —con las cuatro claves— **no viaja en la carpeta**: se entrega aparte,
por canal seguro. Nunca se versiona ni se adjunta. En la carpeta solo va `.env.prod.example`.

`PASOS-PRODUCCION.md` es el resumen operativo de la entrega —qué trae la versión, qué migración
aplica, los pasos de actualización y la reversión—; este `DESPLIEGUE.md` sigue siendo la fuente
completa, y aquel remite aquí.

**Nada más.** El compose de producción no monta ninguna carpeta del host, a propósito: los
guiones SQL viajan dentro de la imagen del backend y de ahí se sacan. Si hiciera falta copiar
carpetas, la que faltara se crearía vacía y el paso fallaría **en silencio**.

### 7.3. Instalar, en el servidor

> **TODOS LOS COMANDOS LLEVAN `--env-file .env.prod`, Y NO ES OPCIONAL.**
>
> `env_file:` dentro del compose entrega las variables **al contenedor**. La interpolación
> `${DB_PASSWORD}` del propio archivo es otra cosa: Compose la resuelve contra el entorno del
> intérprete o contra un archivo llamado **`.env`**, y nunca contra `.env.prod`. Sin la opción,
> el primer `up` se detiene con «required variable DB_PASSWORD is missing a value».
>
> Se descubrió en el ensayo del 2026-08-28. Antes había pasado inadvertido porque en la
> carpeta del repositorio hay un `.env` de desarrollo que rellenaba los huecos: en el servidor,
> donde solo están los archivos de la entrega y el `.env.prod` real, no hay nada que los tape.

```bash
# 1 · Cargar las imagenes
docker load -i transporte-<fecha>.tar

# 2 · Configurar. Los cuatro secretos: DB_PASSWORD, APP_DB_PASSWORD,
#     AUTH_JWT_SECRET y SESSION_JWT_SECRET. Las dos ultimas, DISTINTAS entre si.
cp .env.prod.example .env.prod

# 3 · Solo la base, y esperar a que este sana
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d transportedb
docker compose --env-file .env.prod -f docker-compose.prod.yml ps   # transportedb -> healthy

# 4 · La extension de medicion. Paso explicito: el guion sale de la imagen.
docker run --rm --entrypoint sh transporte-backend:latest \
  -c 'cat prisma/init-db/01-extensiones.sql' \
  | docker exec -i transportedb psql -U postgres -d transportedb

# 5 · Migraciones. NO se aplican al arrancar el contenedor, y es deliberado.
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm \
  transporte-app npx prisma migrate deploy

# 6 · El rol de aplicacion. UNA vez por base, DESPUES de la primera migracion:
#     los GRANT solo alcanzan a lo que ya existe. La clave es la de APP_DB_PASSWORD,
#     y va entre comillas simples DENTRO de las dobles: psql espera un literal SQL.
docker run --rm --entrypoint sh transporte-backend:latest \
  -c 'cat prisma/roles/crear-rol-aplicacion.sql' \
  | docker exec -i transportedb \
      psql -U postgres -d transportedb -v ON_ERROR_STOP=1 -v clave="'<APP_DB_PASSWORD>'"

# 7 · Levantar todo
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

Y el primer administrador por SQL, como explica la sección 0.

> **Comprobación en producción.** La de la sección 6 vale igual, con una diferencia de puerto:
> **el backend se publica en el `3005`** (el compose mapea `3005:3003`), no en el `3003` del
> desarrollo; el frontend sigue en `5180` y la base no se publica.
>
> ```bash
> docker compose --env-file .env.prod -f docker-compose.prod.yml ps                 # los tres «healthy»
> curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3005/api/v1/estado      # 200
> curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5180/health             # 200
> curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5180/api/v1/estado      # 200 (por el proxy)
> docker exec transporte-app  id    # uid=1001(nestjs) · NO root
> docker exec transporte-front id    # uid=101(nginx)  · NO root
> ```

### 7.4. Cuatro diferencias con el compose de desarrollo

| | Desarrollo | Producción |
|---|---|---|
| Imágenes | `build:` en los tres | **`image:` solamente.** Nada se construye en el servidor |
| Puerto de la base | `5434:5432` | **No se publica** |
| Archivo de entorno | `.env` | `.env.prod` |
| `uploads` | `./uploads` del repositorio | **Volumen nombrado.** En un servidor limpio, `./uploads` la crearía Docker como `root` y el contenedor corre como uid 1001: el primer documento emitido fallaría con `EACCES` |

> **EL PUERTO DE LA BASE ES UN BLOQUEO REAL, NO UNA PREFERENCIA.** El compose de desarrollo
> publica el `5434` con el comentario «evita chocar con Instrucción en 5433». Eso vale en una
> máquina de desarrollo y **es falso en el servidor**: el procedimiento de Instrucción dice
> que allí movieron su base al `5434`, justamente porque el `5433` ya estaba ocupado. En
> `172.20.136.127` el `5434` es suyo, y `docker compose up` fallaría al enlazarlo.
>
> El motivo de fondo es mejor que la colisión: **la base no tiene por qué estar publicada**.
> La aplicación la alcanza por la red interna. Para `psql` puntual, `docker exec`.

### 7.5. Lo que NO se copia de Instrucción

Conviene que quede escrito, porque son tres decisiones nuestras que un despliegue apresurado
podría deshacer «para parecerse más»:

| Instrucción | Aquí | Por qué no se cambia |
|---|---|---|
| La aplicación se conecta como `postgres`, superusuario | Rol `transporte_app` sin DDL | Sería una regresión de seguridad. Es el límite del daño de una inyección SQL |
| La imagen de la base viaja con los datos dentro | `prisma migrate deploy` | Reproducible y con traza. Una imagen con datos no se puede auditar |
| Sin comprobación de salud en aplicación ni frontend | Los tres la tienen | `depends_on` las usa para esperar de verdad |

---

## 8. Actualizar una versión

### 8.1. En la máquina (desarrollo)

```bash
git pull
docker compose build
docker compose run --rm transporte-app npx prisma migrate deploy
docker compose up -d
```

`docker compose build` reconstruye **las dos** imágenes. Hasta M-30 el servicio del frontend no
declaraba `build:` y se quedaba en la imagen anterior sin avisar: una pantalla nueva no aparecía y
no había nada en el registro que lo explicara.

### 8.2. En producción, por `.tar`

El servidor **no construye**: llega el paquete nuevo (§7.1–7.2) y se actualiza sin repetir la
primera instalación —la base, el rol `transporte_app` y la extensión ya existen—.

```bash
cd /ruta/transporte/transporte_<fecha>

# 1 · Cargar las imagenes de la version nueva
docker load -i transporte-<fecha>.tar

# 2 · Migraciones ANTES de levantar (paso explicito; el contenedor no migra al arrancar)
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm \
  transporte-app npx prisma migrate deploy

# 3 · Levantar con las imagenes nuevas (recrea lo que cambio)
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

> **Reversión.** Las imágenes de la versión anterior siguen cargadas en el servidor. Se vuelve
> al pin anterior y se levanta:
>
> ```bash
> sed -i 's/:1\.1\.0/:1.0.0/' docker-compose.prod.yml
> docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
> ```
>
> Esto solo revierte las **imágenes**, no el esquema. Es seguro cuando la migración de la
> versión únicamente **agrega** objetos nulables (como `20260930120000_motivo_baja_funcionario`
> de la 1.1.0: dos columnas nulables en `t_funcionario`), que la versión anterior ignora. Una
> migración que **quite o cambie** algo existente exige un plan de reversión propio: anótalo en
> el `PASOS-PRODUCCION.md` de esa entrega.

---

## 9. Lo que este despliegue todavía no cubre

- **~~Identidad real (E12)~~ · RESUELTA el 2026-08-18.** El ingreso con Auth central está
  construido y probado de punta a punta contra el servidor de desarrollo. Lo que queda **no es
  nuestro**: falta crear el rol `Transporte - Funcionario` en Auth —sin él **P-06 «Mis órdenes» es
  inaccesible**—, y que el canje devuelva `roles` y el token lleve `subsystemId`, sin lo cual no se
  puede comprobar que un código se emitió para este módulo y no para otro de SIGOC. Ver
  `docs/PLAN_INTEGRACION_AUTH.md`.
- **Poblar `t_usuario`.** Auth dice **quién** es cada quien; el rol lo decide este módulo con
  `usua_identificador_ad`. Quien no tenga fila **no entra**, aunque Auth lo autentique. La semilla
  parte de `prisma/insumos/usuarios-cuadro.json`.
- **Copias de seguridad.** No hay política definida (PV-19). El volumen `transporte_pgdata`
  contiene todo; respaldarlo es responsabilidad de la infraestructura.
- **HTTPS.** El nginx del frontend sirve en claro. La terminación TLS corresponde al proxy
  institucional. **Deja de ser opcional en cuanto el frontend se sirva desde algo que no sea
  `localhost`**: fuera de contexto seguro el navegador retira parte de su API —`crypto.randomUUID`
  entre otras— y `AUTH_COOKIE_SECURE=true` exige TLS para que la cookie viaje.
- **Los cinco bloqueantes del negocio** —PV-01, PV-02, PV-03, PV-25 y PV-26— siguen abiertos: el
  sistema se despliega y se recorre, pero no se puede usar con datos reales.

---

## 10. Endurecimiento de seguridad · auditoría E2E

Cambios aplicados en código/configuración y los pasos que quedan del lado de operaciones.

### Ya en el código (no requieren acción en el despliegue)

- **Cabeceras de seguridad (helmet).** `main.ts` emite `nosniff`, anti-clickjacking y una CSP
  restrictiva en toda respuesta. **HSTS solo con `NODE_ENV=production`**, para no forzar HTTPS
  sobre el HTTP de hoy.
- **CORS sin reflejo abierto.** Se retiró el respaldo `origin: true`, que devolvía el origen de
  quien preguntara con `credentials: true`. En producción `CORS_ORIGINS` es obligatorio; en
  desarrollo el respaldo es una lista local explícita.
- **Validación de entorno al arranque.** `validar-entorno.ts` detiene el proceso si falta
  `DATABASE_URL` o si `SESSION_JWT_SECRET` está vacía o es corta (< 32). Las variables de Auth
  central se advierten, no detienen (su etapa 1 sigue abierta).
- **Ausencias acotadas por dirección (IDOR).** Listar las ausencias de una persona exige alcanzar
  su dirección, con la misma vara que registrarlas: un administrador de otra dirección recibe 403.

### Pasos de operación

- **Rotar los secretos antes de la puesta en producción.** El `.env.prod` de plantilla trae
  `DB_PASSWORD`, `APP_DB_PASSWORD`, `AUTH_JWT_SECRET` y `SESSION_JWT_SECRET` en blanco: se
  completan con valores fuertes y únicos, **nunca** los de desarrollo (`admin`, `..._cambiar_en_produccion`).
  `SESSION_JWT_SECRET` debe tener al menos 32 caracteres o el arranque se detiene. **Rotar
  `SESSION_JWT_SECRET` invalida las sesiones vivas** → hacerlo en ventana de mantenimiento.
- **Puerto de la base.** El compose de producción (§7.4) ya **no** publica `5434`. El de
  desarrollo lo publica solo en `127.0.0.1`, no en todas las interfaces del host.
- **Al pasar a HTTPS.** Descomentar `NODE_ENV=production` **y** poner `AUTH_COOKIE_SECURE=true` en
  el `.env.prod`, las dos a la vez: `validar-entorno.ts` exige la cookie `Secure` cuando se declara
  producción, y helmet añade entonces HSTS.
