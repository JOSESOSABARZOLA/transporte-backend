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

**Autorizado:** `exceljs` (2026-10-05), **solo** para exportar la cobertura por turnos de
Instrucción a `.xlsx` (`talento-operativo/application/cobertura-exportador.ts`). No es una
licencia general para generar hojas de cálculo en otros módulos: cada uso nuevo se autoriza. Ampliado el 2026-10-06 a la matriz de **turnos de conductores** de la DAF
(`transporte/application/turnos-conductores-exportador.ts`), que reutiliza el mismo formato. Ampliado
el 2026-10-06 a **LEER** `.xlsx` para importar el HORARIO de turnos de conductores de la DAF
(`transporte/application/turnos-conductores-importador.ts`), autorizado por el usuario. Ampliado
el 2026-10-07 a **LEER** `.xlsx` en la **carga inicial** del administrador (conductores, vehículos,
garajes y turnos; `transporte/application/carga-inicial.service.ts`, que reutiliza el mismo lector
`leerHojaHorario`). Desde esa fecha la importación del HORARIO ya no se ofrece en la pantalla de
turnos: su endpoint de vista previa sigue y lo usa solo la carga inicial.

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
npm run prisma:verificar        # 53 tablas, 21 enums, 44 restricciones, 14 índices parciales
```

### Zonales por formulario (2026-10-13)

**Cada formulario tiene su configuración propia e independiente.** Áreas, puntos, tipos de control e instituciones ya eran de un formulario. Desde el 2026-10-13 también lo son las **zonales**: `t_zonal_formulario`, con nombre y estado propios.

**`t_zonal` queda como la ZONA DE LA CIUDAD**, sin cambios. La usan la ficha de personal, la flota, los tramos, la matriz de traslados y Transporte, que comparan `zona_id` entre formularios. No se administra desde P-08: ahí solo se elige al dar de alta una zonal. Los puntos y `t_operativo_zonal` siguen guardando `zona_id`.

**Las rutas de administración cuelgan del formulario**: `/administracion/catalogos/:codigo/…`. Un valor de otro formulario responde **404**. Las copias entre formularios se retiraron.

Contrato en `docs/CONTRATO-zonal-por-formulario.md`.

**Migración `20261013120000_zonal_por_formulario`** (aditiva e idempotente, se aplica con `migrate deploy`):
- crea la tabla;
- borra las cuatro «zonales» que eran puntos, solo si nunca se usaron;
- crea una zonal de formulario por cada par (formulario, zona) en uso;
- agrega la FK compuesta punto → zonal de su formulario.

**Pendiente:** Mis operativos, la matriz, la jornada y la orden de servicio todavía muestran el nombre de la zona de la ciudad. Hoy es idéntico al del formulario.

### Limpieza de datos de los catálogos (2026-10-13)

`src/scripts/limpieza-catalogos.ts` corrige datos heredados de los catálogos del cuadro:
- zonales que en realidad son puntos de encuentro;
- tipos de control que no están en MAYÚSCULAS;
- instituciones, con el mapa aprobado por negocio: la denominación completa donde todavía repite la sigla (`DENOMINACIONES`) y la sigla corta `SS`, `CBQ` o `FF.AA.` donde la sigla es el nombre entero (`SIGLAS_CORTAS`);
- zonales **de cada formulario** (`t_zonal_formulario`) que no están en formato título. Antes de la migración esta parte se reporta como pendiente.

Se compila con `src/`, así que en producción corre sin `ts-node`. **Sin `--aplicar`, solo reporta y no escribe nada.**

```bash
docker exec transporte-app node dist/scripts/limpieza-catalogos.js                     # reporte
docker exec transporte-app node dist/scripts/limpieza-catalogos.js --incluir-zonales   # reporte, con las zonales
docker exec transporte-app node dist/scripts/limpieza-catalogos.js --aplicar --usuario=<usua_id>
docker exec transporte-app node dist/scripts/limpieza-catalogos.js --aplicar --incluir-zonales --usuario=<usua_id>
```

- **Una sola transacción.** Cada cambio deja su traza en `t_auditoria` con el rol `ADMINISTRADOR` y la correlación `limpieza-catalogos-2026-10-13`. `--usuario` es quien firma la traza y es obligatorio para aplicar.
- **Las zonales se aplican solo con `--incluir-zonales`.** La parte a) borra o fusiona **zonas de la ciudad**, junto con sus zonales de formulario. Con ese flag:
  - la zonal que nunca se usó se elimina con sus puntos;
  - la que tiene uso y destino en `DESTINOS_DE_FUSION` se fusiona con el punto equivalente de Zonal Eugenio Espejo, en el mismo formulario;
  - la que tiene uso y no tiene destino se reporta como «requiere decisión» y no se toca.
- **Idempotente.** La segunda corrida reporta 0 cambios. Un cambio que chocaría con un índice único se reporta y se salta.
- **Antes de aplicarlo en producción**, hacer `pg_dump` y revisar el reporte con negocio.

### Ocupación por tramos y horas libres (Transporte DAF, 2026-10-14)

**La ocupación de un conductor o un vehículo sale SOLO de `t_tramo_transporte`.** Un operativo «dejar y retirar» ocupa al conductor en sus dos tramos y deja libre el intervalo medio. `t_operativo.cond_id/vehi_id` queda como **reflejo de solo lectura** del primer tramo asignado, para la orden de servicio, la matriz y `ck_operativo_transporte`: nadie lo lee para decidir si alguien está ocupado.

- **`PATCH /transporte/operativos/:id` delega en la asignación por tramos** (`asignarBloque`): mismas reglas que «Planificar el día». `ActualizarTransporteDto` sigue con dos campos (regla 3). `/desasignar` vacía los tramos del operativo.
- **El macrooperativo (vehículo exclusivo) solo existe en `COMPLETO` (2026-10-19).** `macroSegunTipo` lo deja en `false` con cualquier otro tipo, en el alta, la edición y la herencia del adicional, sin error (como ya hacía con `PROPIOS_MEDIOS`). No se migraron datos: rige al crear y al editar.
- **RN-44 (patrulla consecutiva) y RN-25 (tope de salidas pesadas) siguen en `talento-operativo`** y llegan a la política de tramos como veredictos (`ElegibilidadService.evaluadorDeConduccion`, por lote). El solapamiento, el nombramiento, la ausencia y la jornada (lapso del primer al último tramo, D8) los mide la política de tramos (`transporte/application/politicas/asignacion-conductor.policy.ts`), con traslados.
- **El adicional hereda conductor y vehículo del original POR TRAMOS**: después de confirmar el alta, `transporte` crea sus tramos ya asignados (el conductor del tramo del original del mismo tipo, o su reflejo), validados con las mismas reglas que `asignarBloque` y sin mirar la ventana (regla 9). Si no es viable, nace PENDIENTE con el motivo en la traza. `operativos` lo pide por el puerto `RegistroHerenciaTransporte`, en el que `transporte` se inscribe al iniciar, sin dependencia circular.
- **Cambiar el horario o la zonal** de un operativo con transporte asignado exige `confirmarLiberacion` (409 `CAMBIO_CON_TRANSPORTE`; si solo cambia el tipo, sigue `CAMBIO_TIPO_CON_TRANSPORTE`). Sus tramos se borran y transporte los regenera.
- **Horas libres**: `GET /transporte/huecos/:fecha` y `GET /transporte/conductores/:id/huecos-libres` (`politicas/huecos-libres.ts`, no se guardan). Parámetro `DAF_HUECO_MINIMO_MIN`.
- **Duración del tramo por tipo**: `DAF_DURACION_DEJAR_MIN` y `DAF_DURACION_RETIRAR_MIN` (si faltan, `DAF_DURACION_TRAMO_MIN`). **No** se calcula con la matriz de traslados.
- **La confirmación del optimizador** deja una fila de `t_auditoria` por tramo asignado, compartido o libre activado, más un resumen con la estrategia y las omitidas, con una correlación propia que devuelve.
- **Compartir unidad (2026-10-19).** `POST /transporte/tramos/compartir` lleva al invitado en el conductor y la placa de un anfitrión ya asignado (regla única `politicas/compartir-tramo.ts`, con asientos); `GET /transporte/tramos/:operativoId/compartibles` lista con quién, el pedido de quien registró primero. Para la política, anfitrión e invitados son UN intervalo (`agendaPorUnidad` / `conSuUnidad`). Quitar o reasignar un anfitrión suelta a sus invitados y lo avisa (`liberados`, `aviso`; el `DELETE …/asignacion` responde 200 con cuerpo). El optimizador prioriza el pedido y su confirmación revalida cada compartido. **«La misma unidad»**: se comparte el conductor con su vehículo, así que basta UN traslado en común (un «dejar y retirar» comparte el dejar con un «solo dejar»); los traslados sin pareja los hace la misma unidad si la política completa lo permite y, si no, quedan pendientes con su motivo (`tramosPropios`, `aviso`). «Asignar conductor» sobre un operativo con algo compartido y algo pendiente completa solo lo pendiente (`porAsignar`). **Tres clases** (2026-10-19): COMPARTIDO, SECUENCIAL (no se cruza: la misma unidad lo hace después) y CONFLICTO; la unidad es la del GRUPO (A+B dejan juntos, B+C retiran juntos). **«Completo» comparte unidad (2026-10-20)**: cuarta clase CONTENIDO —un traslado DENTRO de un «completo» de la unidad, o un «completo» que ABARCA sus traslados— en el mismo sitio (misma zonal y, si ambos lo tienen, mismo punto); otro punto, solape parcial o exclusivo siguen siendo CONFLICTO. Asientos por momento (ver 2026-10-21); con ABARCA los tramos cubiertos se re-enraízan a la raíz (un grupo, un intervalo); el registro suma `contiene` / `contenidoEn` y `compartibles` suma `completo` y `personasConInvitado`. Lo que el conductor de la unidad hace FUERA del grupo también cuenta: `compartibles` y `compartir` evalúan los traslados compartidos con la política completa de ese conductor (`choqueFueraDelGrupo`), así que un «completo» no va en la unidad de quien a media mañana está en otro punto; `comparte` lista solo lo del mismo tipo y lo que va dentro de un «completo» va en `contiene`. **El «completo» es la raíz y lo hace también el automático (2026-10-21)**: una regla única pura, `encajarEnUnidad`, decide para la DAF a mano (`emparejar`), «Asignar» con varios operativos que se cruzan (`agruparEnElBloque`: los agrupa o 409, nunca dos traslados que se pisan sin marca), el optimizador (`contener`: con «compartir carro», un bloque de dejar/retirar dentro de un «completo» del MISMO punto conocido va primero en esa unidad, con los asientos de cada momento y la política fuera del grupo) y su confirmación (`compatibleAlConfirmar`). Cuando un «completo» abarca la unidad pasa a ser la RAÍZ y se re-enraízan a él los dejar/retirar que contiene, también los que entraron «con la misma unidad» sin marca, así que el orden en que se asignan no importa. La contención es solo de dejar y retirar (otro «completo» no se contiene). En los candidatos, quien está ocupado solo por esa unidad sale como `COMPARTE` («Comparte unidad con X», `compartirCon`). **Los asientos se cuentan POR MOMENTO (2026-10-21, decisión del negocio, definitiva)**: en cada momento en que viaja el que se suma (el inicio de cada traslado de la unidad mientras va a bordo), las personas DISTINTAS a bordo —el «completo» todo su horario (±`COMPARTIR_VENTANA_MIN`), cada dejar y cada retirar solo durante su traslado, y él— no pasan de los asientos de la placa (`personasPorMomento` / `maximoAbordo`, puras). Caso 21-OCT con la PMA-3370 en 3 asientos: a las 08:00 van el «completo» y los dos dejar (3), a las 16:00 el «completo» y los dos retirar (3): caben los cuatro; con 2, 409 «No caben a las 08:00: la unidad llevaría 3 personas y el vehículo tiene 2 asientos.». Lo mismo en `compartibles` (`asientosLibres` del momento más lleno, `personasConInvitado`, `asientosPorMomento: { tipo, hora, ocupados }[]`), «Asignar» con varios, el optimizador (`compartir` y `contener`) y su confirmación. Por unas horas del mismo día rigió «todo el grupo aunque no viaje a la misma hora»; se revirtió. Contrato: `docs/CONTRATO-compartir-unidad.md`.

Contratos en `docs/CONTRATO-ocupacion-por-tramos.md` y `docs/CONTRATO-huecos-libres.md`. Migración `20261014090000_daf_huecos_y_duracion_por_tipo` (solo parámetros).

### Ausencias de conductores (Flota y garajes, 2026-10-16)

La ausencia del conductor ya la leía toda la planificación (`t_disponibilidad.cond_id`); desde hoy se REGISTRA desde Flota: `AusenciasConductorController` / `AusenciasConductorService` / `AusenciasConductorRepository` en `transporte`, permiso `flota:ausencias` (migración de datos `20261016120000`). Mismas reglas puras que el personal, que salieron a `common/ausencias/reglas-ausencia.ts` (`reglas-personal.ts` las reexporta). Sin alcance por dirección ni autoría: la flota tiene un solo dueño, como el mantenimiento. Contrato: `docs/CONTRATO-ausencias-conductor.md`.

### Alineación con `SIGOC_Logica_de_Negocio_Transporte_DAF.md` (2026-10-15)

- **Sin vehículo vale, y se dice.** `vehiculoId: null` se evalúa sin vehículo (sin taller, asientos ni arranque lejos) y lleva el aviso `SIN_VEHICULO` «Asignado sin vehículo: falta la placa.». El operativo sigue PENDIENTE hasta tener placa: el reflejo necesita los dos.
- **Sustitución de flota.** `POST /transporte/evaluar/vehiculos` evalúa cada placa activa del día para un conductor y un bloque (`PLACA_OCUPADA` = RN-DAF-01). El conductor no está amarrado a su habitual. El optimizador le cambia la placa a mitad de jornada **solo** si la de hoy está en el taller (G6). Contrato: `docs/CONTRATO-sustitucion-flota.md`.
- **Duración del tramo (D7): parámetro por tipo, no la matriz.** El tramo empieza y termina en la zonal del operativo; la matriz daría siempre «misma zona» (15 min) y contaría dos veces el traslado, que ya cobran `NO_LLEGA` y los huecos ENTRE tramos. Tomar la matriz exige saber dónde aborda el personal (§7, sin definir).
- **Jornada máxima (D8): el lapso** del primer inicio al último fin, no la suma de horas al volante. Las horas de conducción se muestran solo como dato.
- **Cobertura de la matriz**: `GET /administracion/traslados` devuelve `cobertura: { posibles, sinTiempo }` (sin el DMQ): los pares que aún usan la regla general.

| Código del documento | Código del sistema |
|---|---|
| `LIBRE_SIN_ACTIVAR` | `LIBRE_NO_ACTIVADO` |
| `VEHICULO_TALLER` | `VEHICULO_EN_TALLER` |
| `CAPACIDAD_ASIENTOS` | `ASIENTOS` |
| `SOLAPAMIENTO` (vehículo) | `PLACA_OCUPADA` / 409 `VEHICULO_OCUPADO` |
| `SOLAPAMIENTO`, `NO_LLEGA`, `JORNADA_MAXIMA` | iguales |

No se renombran: el frontend depende de ellos.

**Script `src/scripts/tramos-desde-asignacion-clasica.ts`**: a cada operativo asignado por la ruta clásica que no tiene tramos le crea los suyos con ese conductor y vehículo. Sin él, para la agenda ese conductor estaría libre a esa hora. Mismo patrón que la limpieza de catálogos: sin `--aplicar` solo reporta, una transacción, traza con la correlación `tramos-clasicos-AAAA-MM-DD`, idempotente.

```bash
docker exec transporte-app node dist/scripts/tramos-desde-asignacion-clasica.js                          # reporte
docker exec transporte-app node dist/scripts/tramos-desde-asignacion-clasica.js --aplicar --usuario=<usua_id>
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
| `transporte` | `talento-operativo` | `ElegibilidadService.evaluadorDeConduccion()` → veredictos RN-44 y RN-25 del conductor, por lote (2026-10-14) |
| `operativos` | `configuracion` | `FormulariosService.obtenerDefinicion()` |
| `transporte` | `operativos` | `OperativosService.asignarTransporte()` |
| `operativos` | `transporte` | Por **puerto** (registro que `transporte` llena al iniciar), sin importar el módulo: `RegistroHerenciaTransporte` (el adicional hereda, 2026-10-14) y `RegistroCompatibilidadCompartir` (¿van juntos en la misma unidad?, 2026-10-19) |
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
  Auth ni Inspección.** `perfilVigente` devuelve `tokenAuth: null` a propósito: relee de la base y ahí no está.

  > **Excepción decidida el 2026-10-07: Inspección.** Para ofrecer los trámites del inspector en el
  > registro, `operativos/infrastructure/inspeccion-tramites.client.ts` lo reenvía como Bearer a
  > `GET {INSPECCION_API_URL}/operativos?fecha=`. Inspección es de la misma familia SIGOC: valida
  > con el secreto compartido de Auth y `/auth/session/validate`, y no tiene token de servicio.
  > Servidor a servidor, sin bitácora, caché por SHA-256 del token y respuesta recortada al alcance
  > del rol (H-01). Cualquier OTRO destino sigue prohibido. Ver `17_KNOWN_ISSUES.md`, B-01.
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
- **`TRUST_PROXY` (2026-10-16).** Número de proxies de confianza delante del backend (`saltosProxy` en `app.config.ts`, `app.set('trust proxy', n)` en `main.ts`). Detrás del Gateway de `*.quito.gob.ec` y del nginx del frontend es **2**; sin ella, `req.ip` es la IP del último proxy y `ThrottlerGuard` contaría a todos los usuarios como uno. Vacía = no se toca (desarrollo); en preproducción es **1** (nginx → app). Solo un entero: `validar-entorno.ts` detiene el arranque con `true`, una IP o un negativo. Instalación detrás del Gateway: `INSTALACION-PRODUCCION.md` y `docker-compose.gateway.yml`.
- **Tres ambientes (2026-10-16): LOCAL-DESARROLLO, PREPRODUCCIÓN (el servidor actual, `http://<IP_PREPRODUCCION>:5180`, sin Gateway) y PRODUCCIÓN (servidor nuevo detrás del Gateway, `https://gestion-sigoc.quito.gob.ec`).** La tabla, el recorrido de una versión y el empaquetado están en `DESPLIEGUE.md`, «Los tres ambientes». Los paquetes los arma `scripts/empaquetar.sh <preproduccion|produccion> <portal>`: misma imagen de backend en los dos servidores, frontend compilado con el portal de cada uno. Plantillas: `.env.preproduccion.example` y `.env.produccion.example`; guías: `COMANDOS-PREPRODUCCION.md` e `INSTALACION-PRODUCCION.md`.
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

1. **Las reglas de descanso viven en DOS lugares, y solo en ellos.** Fuera de estos dos, una
   regla de descanso es un defecto. Ver skill `reglas-descanso`.

   | Dónde | Qué reglas |
   |---|---|
   | `talento-operativo` | Todas las del **personal**, y **RN-44** (patrulla consecutiva) y **RN-25** (tope de salidas pesadas) del **conductor**. Transporte consume las dos del conductor por `ElegibilidadService.evaluadorDeConduccion`, como veredictos por lote. |
   | La política de tramos de `transporte` (`transporte/application/politicas/asignacion-conductor.policy.ts`), **desde el 2026-10-14** | Cuatro del **conductor**: la ausencia, el nombramiento (RN-26/33), el solapamiento (VAL-21) y la jornada (VAL-22). |

   - **La jornada del conductor (VAL-22) se mide como el lapso del primer al último tramo** (D8),
     con `DAF_MAX_JORNADA_HORAS`.
   - **Esas cuatro reglas se movieron porque solo se miden bien por tramo y con traslados**: un
     «dejar y retirar» ocupa al conductor en sus dos tramos y no entre medio.
   - **El tope anterior de horas al volante ya no se aplica al conductor.** Era el VAL-22 clásico,
     con `JORNADA_MAXIMA_HORAS`; ahora rige `DAF_MAX_JORNADA_HORAS` sobre el lapso.
     `JORNADA_MAXIMA_HORAS` sigue rigiendo al **personal**.

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
| **«Planificar el día» (DAF, 4 pasos): resumen, candidatos, simulación, vehículos que salen, acta y hojas de ruta** | **`docs/CONTRATO-planificar-dia.md`** |
| **Rediseño de «Personal y disponibilidad» (P-07): alta desde Auth con correo del servidor, 409 de cédula/solape/ausencia pasada, ausencias del maestro, operativos de una persona, situaciones nuevas** | **`docs/CONTRATO-personal-rediseno.md`** |
| **Rediseño de «Catálogos del cuadro» (P-08): `puedeEliminar` en la lista, zonales de administración, copias en otros formularios, duplicados 409** | **`docs/CONTRATO-catalogos-rediseno.md`** |
| **Ajustes de «Catálogos del cuadro» (2026-10-13): tipos en MAYÚSCULAS, zonales en formato título, DMQ editable, orden de motivos, script de limpieza** | **`docs/CONTRATO-catalogos-ajustes.md`** |
| **Cada formulario con su configuración propia (2026-10-13): `t_zonal_formulario`, rutas `/administracion/catalogos/:codigo/…`, 404 con formulario ajeno, copias retiradas** | **`docs/CONTRATO-zonal-por-formulario.md`** |
| **Rediseño de «Formularios del cuadro» (P-09, 2026-10-13): sin áreas al crear/editar (solo en Catálogos), número/código/áreas → 400, duplicados 409 `FORMULARIO_DUPLICADO`, prefijo general único entre formularios, nombre en MAYÚSCULAS, `GET numero-libre`** | **`docs/CONTRATO-formularios-rediseno.md`** |
| **«Mis operativos» por rango (P-02, 2026-10-13): `desde`/`hasta` (y `fecha` por compatibilidad), máximo `MIS_OPERATIVOS_RANGO_MAX_DIAS`, `GET /operativos/rango`, `cuadroEstado` y `admiteEdicion` por fila, orden fecha desc + identificador** | **`docs/CONTRATO-mis-operativos-rango.md`** |
| **Ocupación por tramos (Transporte DAF, 2026-10-14): una sola fuente, el PATCH clásico delega, RN-44/RN-25 en la política de tramos, el adicional hereda por tramos, 409 `CAMBIO_CON_TRANSPORTE`, traza por asignación del optimizador** | **`docs/CONTRATO-ocupacion-por-tramos.md`** |
| **Horas libres (Transporte DAF, 2026-10-14): `GET /transporte/huecos/:fecha` y `/conductores/:id/huecos-libres`, bruto / útil mínimo / aprovechable, horas extra** | **`docs/CONTRATO-huecos-libres.md`** |
| **Conteo por formulario (2026-10-16): `GET /operativos/conteo?fecha=` → `[{ formularioId, total }]`, el «N hoy» del selector del registro; todos los permitidos (0 si no hay), misma visibilidad que el listado, fecha sin cuadro → 0** | **`docs/CONTRATO-conteo-formularios.md`** |
| **Compartir unidad (2026-10-19): la DAF comparte con `POST /transporte/tramos/compartir` y `GET /transporte/tramos/:operativoId/compartibles`, un intervalo para la política, liberación del anfitrión; `GET /operativos/coincidencias-transporte` (mismo día, punto, zonal y horario, solo el ámbito del rol, RN-48), `compartirConOperativoId` / `justificacionExclusivo` en alta y edición (404 ajeno, 409 `COMPARTIR_NO_COMPATIBLE` / `COMPARTIR_CON_EXCLUSIVO`, aviso `COMPARTIR_RETIRADO`), regla única `politicas/compartir-tramo.ts`, puerto `RegistroCompatibilidadCompartir`; desde el 2026-10-20 el «completo» comparte unidad (clase CONTENIDO, `contiene` / `contenidoEn`, `completo`); desde el 2026-10-21 los asientos se cuentan por momento (`personasConInvitado`, `asientosPorMomento`)** | **`docs/CONTRATO-compartir-unidad.md`** |
| **Ausencias de conductores (2026-10-16): `GET/POST/DELETE /administracion/conductores/:id/ausencias` y `GET /administracion/conductores/ausencias?desde=`, permiso `flota:ausencias`, mismas reglas que el personal (409 `AUSENCIA_SOLAPADA` / `AUSENCIA_PASADA`, traza sin motivo), `tramosAfectados` avisa sin retirar** | **`docs/CONTRATO-ausencias-conductor.md`** |
| **Notas del operativo en las tablas (2026-10-19): `notas` = bitácora (`NOTA`, con el nombre del autor) + la solicitud de compartir (`COMPARTIDA`, armada de `oper_compartir_con_id`, no de la bitácora), la más reciente primero; autores en UNA consulta por lote (`conAutores`); `oper_compartir_solicitado_por/_en` (migración `20261019150000`); `observaciones` no cambia. **Desde el mismo día también en la Jornada, la Matriz y su PDF** (regla única `common/notas/notas-operativo.ts`, autores con `common/notas/autores.ts`; en la Jornada, una COMPARTIDA hacia un formulario que el rol no ve no se nombra, RN-48; el PDF imprime una línea por nota con el rol y la hora). La orden de servicio no la lleva** | **`docs/CONTRATO-notas-operativo.md`** |
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
8. **No escribir IP de servidores en nada versionado** (código, comentarios, pruebas, `.env.example`,
   compose, documentación): se usan marcadores (`<IP_SERVIDOR_AUTH>`, `<IP_PREPRODUCCION>`) o el nombre
   de host público. Las IP concretas van solo en los paquetes de despliegue, que no se versionan.
