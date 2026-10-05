# CLAUDE.md — Transporte Backend

Microservicio backend del **Módulo Transportes / Cuadro de Colores Operativo** de la
Agencia Metropolitana de Control (AMC), Quito.

> Este repositorio contiene **un solo módulo**. Los módulos del sistema de Instrucción fueron
> retirados: no hay TypeORM, no hay funciones almacenadas `fu_*`, no hay carpeta `db/`.
> Si encuentras referencias a ellos, son residuos que deben eliminarse.

---

## 1. Qué hace este sistema

El Cuadro de Colores es el **compilado diario** de los operativos que la AMC ejecutará al día
siguiente. No es una herramienta de planificación: cada dirección planifica en sus propios
instrumentos y aquí se consolida qué personal se moviliza, a qué punto y con qué vehículo.

El proyecto nació de dos problemas concretos:

1. Una sola persona consolidaba todo a mano y **renunció durante el levantamiento**, sin traspaso.
2. El cuadro circulaba por WhatsApp y los intervenidos se anticipaban al operativo.

De ahí sus dos entregables: **nueve formularios independientes** que reparten la carga entre
departamentos, y **órdenes de servicio individuales** que entregan a cada funcionario solo su
propia asignación.

---

## 2. Stack

| Capa | Tecnología |
|---|---|
| Framework | NestJS 11 + TypeScript estricto |
| Acceso a datos | **Prisma ORM** |
| Base de datos | PostgreSQL 18, base `transportedb` |
| Validación | `class-validator` + `class-transformer` |
| Contenedor | Docker, construcción multietapa |
| Puerto | **3003** |
| Zona horaria | `America/Guayaquil` — las ventanas de carga dependen de ella |

**Prohibido:** `typeorm`, `@nestjs/typeorm`, `dataSource.query`, funciones `fu_*`,
`$queryRawUnsafe`, y cualquier dependencia fuera del stack sin autorización previa.

---

## 3. Cómo ejecutar

```bash
npm install
npx prisma generate
npx prisma migrate dev          # desarrollo
# La semilla se retiro el 2026-08-19: los catalogos institucionales viven ahora en la
# migracion 20260819210000, asi que `migrate deploy` los aplica sin ningun paso extra.
npm run start:dev               # http://localhost:3003

npm run build                   # debe salir con código 0
npm run lint                    # debe salir con código 0

npm test                        # unitarias: no necesitan base de datos
npm run test:integracion        # EXIGE la base levantada (test/jest-integracion.json)
npm run prisma:verificar        # 37 tablas, 15 enums, 33 CHECK, 10 índices parciales
```

Las pruebas de integración viven en `test/` con su propia configuración, a propósito: si
dependieran de la base dentro de `npm test`, esa suite fallaría por el entorno y dejaría de ser
una señal útil.

**Y corren contra su propia base, `transportedb_pruebas`**, no contra la de desarrollo.
`ck_formulario_numero` solo admite del 1 al 9: si el catálogo institucional ocupa los nueve
casilleros, las suites no tienen dónde crear los suyos. La preparación está en `DESPLIEGUE.md` §4.1;
la semilla detecta esa base por su nombre y **no** le siembra los formularios.

Docker: `docker compose up -d --build`. Las migraciones **no** se aplican al arrancar el
contenedor; son un paso explícito del despliegue con `npx prisma migrate deploy`.

El servicio `transporte-app` declara `build:` **e** `image:`: sin lo primero, `--build` levantaba
la imagen anterior sin avisar. Tiene comprobación de salud contra `/api/v1/estado`, y el frontend
espera a que esté sana.

---

## 4. Arquitectura

Cuatro capas por submódulo:

```
src/modules/<submodulo>/
├── presentation/     Controllers + DTO. Sin reglas de negocio, sin Prisma
├── application/      Services y policies. Sin HTTP, sin Prisma directo
├── domain/           Objetos de valor con comportamiento. Sin dependencias externas
└── infrastructure/   Repositories. Único punto que toca PrismaService
```

Seis submódulos, uno por contexto delimitado:

| Submódulo | Responsabilidad |
|---|---|
| `configuracion` | Los nueve formularios, catálogos, ventanas de carga, parámetros de política |
| `talento-operativo` | Personal, disponibilidad, historial y **todas las reglas de descanso** |
| `cuadro-diario` | Ciclo de vida de la jornada: apertura, estados, cierre |
| `operativos` | Núcleo. Registro, edición y asignación de personal |
| `transporte` | Asignación de conductor y vehículo. **Solo dos campos** |
| `documentos` | Matriz consolidada y órdenes de servicio |

### Comunicación entre submódulos

Solo por **servicios publicados**. Prohibido importar el repositorio de otro submódulo.

| Origen | Destino | Servicio |
|---|---|---|
| `operativos` | `talento-operativo` | `ElegibilidadService.verificar()` → veredicto y motivo, **no datos del funcionario** |
| `operativos` | `configuracion` | `FormulariosService.obtenerDefinicion()` |
| `transporte` | `operativos` | `OperativosService.asignarTransporte()` |
| `documentos` | `operativos`, `transporte` | Servicios de consulta |
| Todos | `cuadro-diario` | `CuadroDiarioService.puedeEscribir()` |

---

## 5. Los siete roles

> **Una persona puede tener VARIOS desde el 2026-08-19**, y valen todos a la vez: ve la
> **unión** de los formularios de cada uno. Los roles viven en `t_usuario_rol`, no en una
> columna de `t_usuario`.
>
> No es lo que modela el portal de Auth —que hace elegir uno en «Seleccione un rol»— pero
> es lo único construible mientras el canje no transmita cuál se eligió: el desajuste D-5,
> pendiente de ese equipo. El día que lo transmita, la tabla sigue valiendo.
>
> **`usuario.rol` cambió de significado**: ya no es «el rol del usuario» sino **el rol bajo
> el que se hace esta petición**, que la cadena de guardas estrecha —`PermisosGuard` al rol
> que otorga el permiso exigido, `FormularioRolGuard` al dueño del formulario— (desde el RBAC
> del 2026-09-16; antes lo estrechaba `RolesGuard` al rol que el endpoint admitía). Es lo que
> se graba en `oper_creado_por_rol` y `audi_rol`. Para preguntar «¿tiene este rol?» se usa
> `usuario.roles`.
>
> **Los operativos se leen Y se escriben con la UNIÓN de los roles, no con `usuario.rol`
> (2026-09-09).** `RolesGuard` estrecha `usuario.rol` al **primero** de la lista del endpoint,
> y para un endpoint sin código de formulario en la ruta —`GET /operativos`, `PATCH/DELETE
> /operativos/:id`, `.../personal`— ese primero casi nunca es el rol que corresponde al
> operativo. Por eso `OperativosService.consultar` y las escrituras (`editar`, `retirar`,
> `registrarAdicional`, `asignarPersonal`, `retirarPersonal`, `actualizarTurnoPersonal`,
> `obtener`) reciben **`usuario.roles`**: la lectura muestra la unión; la escritura autoriza si
> **alguno** de sus roles crea/participa y **actúa bajo ese** —`rolPropietarioEntre` /
> `rolParticipanteEntre`—, que es el sombrero correcto para `oper_creado_por_rol` y `audi_rol`.
> Un solo rol se comporta igual que antes (los métodos tienen `roles = [autor.rol]` por
> defecto). La regla «cada departamento edita y retira los suyos» **no cambió**: sigue
> exigiendo el rol que lo creó; lo que se corrige es que una persona con ese rol —entre
> otros— deje de ser rechazada por el orden de la lista.
>
> **Pero un rol de LECTURA TOTAL (`DIRECTOR`/`DAF`) NO amplía el listado departamental
> (Camino B, 2026-09-10).** `consultar` acota `visiblesPara` a los roles DEPARTAMENTALES del
> usuario (`DMIP_OPERATIVOS`, `DMIP_INSPECCIONES`, `DMIT_INSTRUCTOR`); si tiene alguno, ve la
> unión de ESOS —no todo— aunque además sea Dirección o DAF. Solo la Dirección o la DAF
> **«puras»** —sin ningún rol departamental que acotar— ven la jornada entera por este
> endpoint; su visión completa vive en sus pantallas propias (matriz, órdenes, transporte).
> Motivo: con el desajuste D-5 (Auth no transmite el rol elegido) este módulo recibe TODOS
> los roles a la vez, y sin este recorte quien tuviera DIRECTOR encima veía en P-01/P-02 lo
> de todos los departamentos. `obtener` conserva el «ve todo» de Dirección/DAF (la Dirección
> abre cualquier operativo para emitir su orden).

Seis departamentales, que escriben en el cuadro, y uno que no.

| Rol | Escritura |
|---|---|
| `DMIP_OPERATIVOS` | Formularios 1, 2, 3, 4 |
| `DMIP_INSPECCIONES` | Formularios 5, 6, 8 |
| `DMIT_INSTRUCTOR` | Formularios 7, 9 y cupo de una persona en el 6 |
| `DAF` | **`conductorId` y `vehiculoId`** en los nueve formularios, **y las pantallas de flota** (Conductores/Vehículos y Mantenimiento) desde el 2026-09-10 |
| `DIRECTOR` | Solo lectura: matriz (ve y exporta el PDF), emite órdenes y **cierra/reabre** el cuadro. Desde el 2026-09-10 ya **no** ve «Jornada de los conductores» |
| `ADMINISTRADOR_DMIP` | Catálogos, personal, ventanas, parámetros y cuentas — todo el admin **menos** la flota |
| `ADMINISTRADOR_DMIT` | **Personal (P-07), acotado a Instrucción** desde el 2026-09-02 |
| `ADMINISTRADOR_DAF` | **Flota**: Conductores/Vehículos y Mantenimiento |
| `ADMINISTRADOR` | **Administrador general (reactivado el 2026-09-10): TODO el módulo de administración, incluida la flota** |
| `FUNCIONARIO` | **Ninguna. Retirado el 2026-09-10**: el personal de campo ya no inicia sesión (sus órdenes se generan desde P-05). Conservado vacío en el enumerado |

> **La administración, tras el reajuste del 2026-09-10.** `ADMINISTRADOR_DMIP` abre todo el
> módulo de administración **menos la flota**; `ADMINISTRADOR_DAF` abre **solo la flota**
> (Conductores/Vehículos y Mantenimiento), que además comparte con la `DAF`; `ADMINISTRADOR_DMIT`
> sigue **solo** con el maestro de personal (P-07) acotado por `t_rol_direccion` a Instrucción.
> Y por encima de todos, `ADMINISTRADOR` vuelve a ser el **administrador general**: aparece en el
> `@Roles` de TODOS los controladores de administración, incluida la flota.
>
> **`ADMINISTRADOR` se reactivó el 2026-09-10**, revirtiendo el retiro del 2026-09-01. Para ser
> asignable necesita su fila en `t_rol_auth` (mapeo de Auth central); sin ella, la pantalla de
> cuentas lo ofrece pero nadie lo recibe desde el portal. La prueba
> `src/common/auth/roles-administracion.spec.ts` ya **no** lo vigila; ahora vigila que
> `FUNCIONARIO` —retirado— no reaparezca en ningún `@Roles`. La segunda barrera es
> `src/common/roles/catalogo-roles.ts` (`NO_ASIGNABLES`), con su prueba `catalogo-roles.spec.ts`.
>
> **PER-09 no cambió**: los tres roles departamentales siguen viendo a su gente en P-07.

`FUNCIONARIO` se **retiró el 2026-09-10**. El personal de campo dejó de iniciar sesión: sus
órdenes se generan para él desde la Dirección (P-05) y se entregan por otro canal, así que P-06
«Mis órdenes» desapareció y el rol dejó de ser asignable (`NO_ASIGNABLES`). Como con
`ADMINISTRADOR`, **se conserva en el enumerado** en vez de retirarlo del tipo: borrar un valor de
`e_rol_departamental` obligaría a recrear el tipo y sus columnas (migración destructiva). Quien
entra por Auth sin un rol de Transporte asignado ya no recibía un fallback —nunca lo hubo en la
sesión—: `perfilVigente` lo rechaza con un mensaje claro si su cuenta no tiene ningún rol.

> **El Formulario 6 · Patrulla Reacción Nocturna, cada persona con su código (2026-09-17).** El
> `DMIP_INSPECCIONES` **registra** la patrulla con Inspector General y Técnico → `IGNECU` / `ITNECU`
> (un operativo por persona, `form_varios_por_persona`), enlazados por un `oper_grupo_registro`. La
> patrulla queda **pendiente de Instrucción**: solo el `DMIT_INSTRUCTOR`, que **APORTA** (no es
> dueño), agrega su persona de Instrucción con un único botón «Agregar personal». Ese aporte **no
> suma** al operativo del inspector: **crea su propio operativo de una persona** con código `INECU`,
> enlazado al **mismo** `grupoRegistro`, de modo que el frontend los reagrupa como una sola patrulla.
> Vive en `asignarPersonal` (rama de formularios de patrulla: `variosPorPersona` sin
> `cantidadPorPersona`) → `aportarComoOperativoPropio`, **no** en el acceso del rol. La restricción de
> área del que aporta la impone **`reglaCupoCompartido`** (solo áreas `esCompartida` = Instrucción); el
> **cupo (1) no acota**: como el aporte crea operativo y no suma al destino, nunca bloquea → aportes
> **ilimitados**. Las patrullas (5 y 6) numeran **por prefijo** (cada área desde 001): `IGNECU-001`,
> `ITNECU-001`, `INECU-001`; un 2.º General sería `IGNECU-002`. Son dos migraciones de solo datos del
> 2026-09-17 (revert del DMIT a APORTA; drop de `uq_operativo_cuad_form_sec` y su gemelo). El ejemplo
> de aporte con cupo sigue siendo la ECU / Form 4.

### De dónde sale la identidad

De **la cookie de sesión que emite el canje con Auth central**, y de ningún otro sitio.
`IdentidadGuard` la verifica y llena `request.user`; el resto de la cadena no cambió al llegar
Auth. Ver `docs/PLAN_INTEGRACION_AUTH.md`.

**Auth central dice QUIÉN es; este módulo decide QUÉ ROL tiene**, resolviendo el `username` contra
`t_usuario.usua_identificador_ad`. No es una preferencia: el canje del Auth desplegado no
transmite el rol elegido.

> **Retirado el 2026-08-18, etapa 5.** Hasta entonces existía un segundo camino:
> `MODO_IDENTIDAD_PROVISIONAL` con la cabecera `x-usuario-prueba` y el catálogo
> `usuarios-prueba.ts`. Los tres desaparecieron. Mientras existieron, **con el modo encendido
> cualquiera podía declararse `DIRECTOR` enviando un número** y ver la matriz consolidada entera.
> Era el riesgo B-01 de `17_KNOWN_ISSUES.md`.
>
> Las pruebas de integración firman su propia cookie con `test/identidad-de-prueba.ts`: ejercitan
> el mismo camino que el navegador, no uno paralelo.

### El token de Auth se conserva, y no es un detalle de implementación

**Desde el 2026-08-21**, `ContenidoSesion` lleva `tokenAuth`. Antes se descartaba en cuanto se
validaba el canje.

Se conserva porque **Auth central no tiene token de servicio ni clave de API**: la credencial de
la persona que pregunta es la única con la que se puede consultar `GET /users`, y de ahí sale el
directorio de personal de P-07 (`identidad/infrastructure/auth-usuarios.client.ts`).

**Es un cambio de postura de seguridad, no una comodidad.** Quien obtenga la cookie obtiene una
credencial de **Auth**, no solo de este módulo. Lo que lo contiene: la cookie es `HttpOnly`, la
sesión ya caducaba con la de Auth y la CSP del frontend impide sacarla desde el navegador. Está
registrado como riesgo aceptado en `17_KNOWN_ISSUES.md`, B-01.

Dos consecuencias al escribir código aquí:

- **No lo registre en la bitácora, no lo devuelva en ningún DTO y no lo reenvíe a nada que no sea
  Auth.** `perfilVigente` devuelve `tokenAuth: null` a propósito: relee de la base y ahí no está.
- **Una sesión abierta antes de esa fecha no lo lleva.** El endpoint que lo necesita lo comprueba
  y responde con un mensaje que pide volver a entrar, no con un `500`.

### Cadena de autorización

```
IdentidadGuard → PermisosGuard → FormularioRolGuard → VentanaCargaGuard → ValidationPipe → Service
     401             403               403                423              400          409
```

`FormularioRolGuard` consulta `t_formulario`, **nunca confía en el cuerpo de la petición**.

### RBAC por permisos atómicos (2026-09-16)

> **El acceso a un endpoint es un PERMISO, no una lista de roles.** Antes cada endpoint
> declaraba `@Roles(RolDepartamental.X)` y `RolesGuard` comparaba contra el enum en memoria.
> Ahora declara **`@RequierePermiso('modulo:accion')`** (p. ej. `transporte:asignar`,
> `matriz:ver`, `personal:administrar`) y **`PermisosGuard`** lo valida contra la matriz
> `t_rol_permiso` de la base, cacheada en `PermisosService` e invalidada al editarla.

- **Tres tablas nuevas:** `t_rol` (catálogo: nombre/orden/asignable; reemplaza el mapa
  `catalogo-roles.ts`), `t_permiso` (36 permisos atómicos, `modulo:accion`) y
  `t_rol_permiso` (matriz rol↔permiso, editable en caliente). El **enum `RolDepartamental`
  sigue siendo la identidad física** del rol; migrar sus 15 columnas a FK era desproporcionado.
- **`RolesGuard` y `@Roles` quedaron retirados** de los controladores (la clase sigue en el
  repo, sin uso). El decorador es `common/auth/decorators/requiere-permiso.decorator.ts`; el
  guard, `common/auth/guards/permisos.guard.ts`; el servicio de lectura+caché,
  `common/auth/application/permisos.service.ts`; el repositorio, `.../infrastructure/permisos.repository.ts`.
  Los tres se proveen y exportan desde el `@Global()` `auth.module.ts`.
- **El «sombrero» de auditoría se conserva:** `PermisosGuard` estrecha `usuario.rol` al rol
  del perfil que otorga el permiso; para las escrituras de operativo, `FormularioRolGuard` lo
  fija después (dueño del formulario), como antes.
- **La sesión (`GET /auth/session`) devuelve `permisos: string[]`** —la unión de los de sus
  roles— re-derivados de la base en cada respuesta (NO viajan en el JWT). Los usa el frontend
  para gatear la UI.
- **Administración de la matriz (sin desplegar):** `GET /administracion/permisos`,
  `GET/PUT /administracion/roles/:rol/permisos` (`@RequierePermiso('permisos:administrar')`,
  `PermisosController`/`PermisosAdminService`). Al guardar se invalida la caché → rige en la
  siguiente petición. La pantalla es «Permisos por rol» (P-36).
- **Los 6 controladores sin permiso** (`app`, `formularios`, `sesion`, `ventanas`, `zonales`,
  `personal`) siguen **solo autenticados**: `PermisosGuard` sin `@RequierePermiso` deja pasar.
- **Red de paridad:** `t_rol_permiso` se sembró 1:1 con los `@Roles` de antes, y la integración
  (319 pruebas) lo verifica endpoint por endpoint. La semilla vive espejada en
  `common/roles/matriz-permisos.ts` (`SEMILLA_ROL_PERMISO`), que usan las pruebas.
- **Sigue en código, a propósito** (no es permiso de acceso, es regla de negocio): el enum,
  el «sombrero» de auditoría, `ROL_DEL_AREA` (organigrama), la máquina de estados del cuadro
  por ventanas y la composición multi-rol. Un rol nuevo se agrega con **una** migración de
  enum (`ADD VALUE`); desde ahí su nombre, asignación y accesos son datos.
- **Agregar un endpoint protegido:** decláralo con `@RequierePermiso('...')` y `@UseGuards(...,
  PermisosGuard)`, crea el permiso en `t_permiso` (migración) y otórgalo a los roles que toque
  en `t_rol_permiso`. Si es un permiso nuevo, súmalo también a `SEMILLA_ROL_PERMISO` y al
  espejo del frontend (`pruebas/permisos.ts`).

### Endurecimiento de arranque y despliegue (auditoría E2E, 2026-09-17)

Una auditoría E2E de 8 capas confirmó una postura sólida (RBAC en servidor, cookie `HttpOnly`,
sin XSS/SQLi, sin secretos en código/git/bundle, PII suprimida). Lo accionable en código+config
se cerró así; lo que sigue es el estado, no historia.

- **IDOR cerrado en las ausencias (H-01).** `DisponibilidadService.listarDe(funcionarioId, roles)`
  exige `exigirSuDepartamento` —la **misma vara** que `registrar`/`retirar`—: un administrador de
  otra dirección recibe **403** en `GET /administracion/personal/:id/disponibilidad` en vez de
  leer el `motivo` (posible dato de salud) de personal ajeno. El controlador le pasa
  `usuario.roles`. Lo fija `test/personal-disponibilidad.integracion-spec.ts` (ajeno→403,
  alcance→200) y el unit del servicio.
- **`helmet` en `main.ts`** (aprobado, fuera del «Prohibido» de §2): CSP mínima (`default-src
  'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`), `nosniff`,
  anti-clickjacking y `crossOriginResourcePolicy: 'cross-origin'` (el frontend descarga la
  matriz/órdenes desde otro origen). **HSTS solo en producción.**
- **CORS sin reflejo abierto.** Se retiró el respaldo `origin: true` (devolvía el origen de quien
  preguntara con `credentials:true`). En producción `CORS_ORIGINS` es **obligatorio**; en
  desarrollo el respaldo es una lista local explícita, nunca «cualquiera».
- **Validación de entorno al arranque** (`src/config/validar-entorno.ts`, función propia, sin
  librerías). Se invoca al inicio del `bootstrap()`. **Detiene** el arranque si falta
  `DATABASE_URL` o si `SESSION_JWT_SECRET` está vacía o mide < 32; **advierte** (no detiene) por
  las variables de integración con Auth central (`AUTH_JWT_SECRET`, `AUTH_SUBSYSTEM_ID`), cuya
  etapa 1 sigue abierta. **No** corre en las pruebas (usan `Test.createTestingModule`, no `main.ts`).
- **Flag `produccion`** (`appConfig.produccion` = `NODE_ENV === 'production'`). Enciende HSTS y los
  chequeos de producción de `validarEntorno`: con `produccion`, `CORS_ORIGINS` y
  `AUTH_COOKIE_SECURE=true` pasan a ser **obligatorios**. Se deja apagado mientras se sirva por
  HTTP: activarlo sin TLS detendría el arranque (la cookie `Secure` exige HTTPS). Al pasar a
  HTTPS se ponen `NODE_ENV=production` **y** `AUTH_COOKIE_SECURE=true` juntas. Ver `DESPLIEGUE.md` §10.
- **Puerto de la base.** El `docker-compose.yml` de desarrollo publica la BD solo en
  `127.0.0.1:5434:5432` (no en todas las interfaces). El `docker-compose.prod.yml` **no** publica
  el puerto: la app usa la red interna (`transportedb:5432`).
- **Ops (no código):** rotar `DB_PASSWORD` y `SESSION_JWT_SECRET` antes de producción (rotar el de
  sesión invalida las sesiones vivas → ventana de mantenimiento).
- **Fuera de alcance (depende de Auth central):** RS256 en vez de HS256 con secreto compartido
  (H-10) y revocación server-side del logout (H-11). Se dejan como recomendación.

---

## 6. Reglas invariables

1. **Las reglas de descanso viven solo en `talento-operativo`.** Si aparecen en otro submódulo,
   es un defecto. Ver skill `reglas-descanso`.

   > **Desde el 2026-09-08 se evalúan sobre la ventana EFECTIVA de cada persona, no la del
   > operativo (RN-66).** `t_asignacion_personal` lleva un **turno propio**
   > (`aper_hora_inicio`/`aper_hora_fin`, en par): es la franja de esa persona. El descanso, el
   > solapamiento y la jornada se verifican con esa ventana, que viaja en `ContextoOperativo`.
   > La orden de servicio de cada persona muestra **su** ventana efectiva; `DatoAislado` no cambió.
   >
   > **Y el operativo YA NO tiene horario propio: lo TOMA de las personas.** Al registrar (y al
   > adicional), `CrearOperativoDto.horaInicio/horaFin` son **opcionales**; si no viajan, cada
   > persona debe traer su ventana y el operativo deriva la suya con `RangoHorario.envolvente()`
   > —el arco más corto que las cubre a todas, respetando el cruce de medianoche—. `es_nocturno`
   > es **«¿alguna persona lo es?»** (no la envolvente, que podría cubrir una madrugada en la que
   > nadie trabaja). Se conserva el **modo clásico** (el operativo trae su horario) por
   > compatibilidad y para las pruebas de integración: entonces las personas sin ventana propia lo
   > heredan y el turno propio debe quedar **contenido** en el del operativo (`RangoHorario.contiene()`),
   > que es lo que sigue usando `asignarPersonal` al agregar gente sobre un operativo ya creado.
   >
   > **Editar el turno de una persona ya asignada RE-DERIVA la ventana del operativo (2026-09-09).**
   > `PATCH /operativos/:id/personal/:funcionarioId` (`actualizarTurnoPersonal`) fija el nuevo par
   > de la persona y recalcula la ventana del operativo con `RangoHorario.envolvente()` de los
   > turnos de TODA su gente —no exige `contiene()`: la ventana sigue a las personas—, revalida el
   > descanso/cruce de esa persona (misma política que `asignarPersonal`, excluyendo su propia
   > asignación por `operativoId`) y recalcula las alertas. Es un flujo inmediato, hermano de
   > asignar y retirar; `OperativosRepository.actualizarVentana` toca solo las columnas de ventana.
   >
   > **VARIOS OPERATIVOS POR PERSONA (2026-09-10; horario sin segmentar 2026-09-14).** Dos flags
   > por formulario, **desacoplados desde 2026-09-14**: **`form_varios_por_persona`** —el *split*:
   > cada persona genera sus propios operativos de UNA sola persona, uno por unidad de su
   > cantidad— lo tienen el **8 y el 5** (en el 5, para que cada área salga con su prefijo
   > IGECU/ITECU sin mezclar); y **`form_cantidad_por_persona`** —OFRECER fijar la cantidad
   > (>1)— solo el **8**. Los N operativos de una persona llevan **todos SU MISMA hora general**:
   > el horario **ya NO se segmenta en tramos** (`RangoHorario.dividir` se eliminó). Los
   > identificadores salen consecutivos. En el 8, un registro con dos inspectores (General y
   > Técnico) produce un operativo por cada uno (y por cada unidad de su cantidad): el 8 **no**
   > tiene operativos multipersona. Una `cantidad > 1` en un formulario sin
   > `form_cantidad_por_persona` se rechaza. Lo arma `componerOperativosDelRegistro`; lo valida
   > `exigirCantidadPorPersona`. Tope de 50 por persona (DTO), sin tope total.
2. **Los umbrales son parámetros, nunca constantes.** Ocho valores viven en
   `t_parametro_politica` y se leen con `ParametroPoliticaService`.
3. **`ActualizarTransporteDto` tiene exactamente dos propiedades.** No le agregues ninguna:
   es la garantía de que la DAF no toque el resto del operativo.

   > **Se puso a prueba el 2026-08-31 y se respetó.** La implementación DAF trajo dos datos
   > nuevos que escribe la DAF —el **destino del vehículo** (RN-DAF-03) y la **desasignación**
   > (P-07)—, y la tentación era sumarlos aquí. Cada uno recibió **su propio endpoint con su
   > propio contrato**, que es lo que este mismo archivo prescribe. Además el destino no era
   > del operativo: es **del vehículo y del día**, porque un conductor encadena varios
   > operativos en un turno y el vehículo termina en un solo sitio.
4. **Conductor y vehículo nacen nulos** al registrar. Solo la DAF los completa.
5. **Toda escritura multitabla en `$transaction`**, con la auditoría dentro.
6. **Los eventos se emiten después de confirmar la transacción**, nunca dentro.
7. **Cada validación cita su regla** en el comentario: `RN-24`, `RN-43`, etc.
8. **Los mensajes de error se escriben para el funcionario**, no para el desarrollador.
9. **`AdicionalesController` es el único endpoint de escritura sin `VentanaCargaGuard`,** y así
   debe seguir. Desde el 2026-08-20 un operativo **adicional** se dispone por urgencia el mismo día
   en que se ejecuta, cuando la carga del departamento ya cerró.

   La excepción vive en la **firma de un controlador aparte** y no en un decorador que la guarda
   lea, deliberadamente: un mecanismo general de exención acabaría puesto en otro endpoint «porque
   hace falta», y la ventana dejaría de ser una garantía. Eximir a un segundo endpoint debe seguir
   costando crear otro controlador.

   Y **es solo horaria**. Identidad, rol, propiedad del formulario y estado del cuadro se
   comprueban igual; el adicional no encadena; y la traza anota si la ventana estaba abierta o
   cerrada, que es lo que hace la excepción *auditable* en lugar de meramente permitida.
   Ver RN-61 a RN-64 y `docs/FASE4-arquitectura-tecnica.md` §8.3.

---

## 7. Lo que NO se debe inventar

Doce puntos siguen sin definición del negocio. Están en `docs/IMPLEMENTATION_GUIDE.md` §0.1.
Los más frecuentes:

- Matriz de correspondencia zonal ↔ punto de encuentro
- Base de personal con teléfono y tipo de contrato
- Catálogo de conductores y vehículos
- Momento de verificación del condicionante nocturno
- Contradicción del formulario 9: condicionante nocturno y a la vez vehículo no habilitado

**Si tu tarea necesita uno de ellos, detente y pregunta.** No completes con un valor razonable:
perderías el rastro de qué se acordó con el Product Owner y qué se supuso.

---

## 8. Documentación

| Necesito | Archivo |
|---|---|
| Guía de implementación, orden y listas de verificación | `docs/IMPLEMENTATION_GUIDE.md` |
| Reglas de negocio con su fuente | `docs/FASE2-documentacion-funcional.md` §8 |
| Las 32 validaciones | `docs/FASE2-documentacion-funcional.md` §19 |
| Catálogos de los nueve formularios | `docs/FASE2-documentacion-funcional.md` §16.3 |
| Agregados, objetos de valor, eventos | `docs/FASE3-analisis-dominio.md` |
| Contratos de API | `docs/FASE4-arquitectura-tecnica.md` §8 |
| Diccionario de datos, restricciones, índices | `docs/FASE4-diseno-base-datos.md` |

---

## 9. Reglas para Claude en este repositorio

1. Antes de escribir código, lee el apartado correspondiente de `docs/IMPLEMENTATION_GUIDE.md`.
2. Respeta la cabecera de comentario por archivo.
3. Cero variables, imports o funciones sin usar. Sin `console.log`. Sin `any`.
4. Español en nombres, comentarios y mensajes.
5. Commits cortos, en español, estilo convencional, una línea. **Nunca atribuyas a Claude ni a IA.**
6. Antes de dar por terminada una tarea: `npm run build` y `npm run lint` con código de salida 0.
7. No subir `.claude/`, `.env`, `dist/`, `node_modules/` ni archivos temporales.
