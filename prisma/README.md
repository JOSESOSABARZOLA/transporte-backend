# prisma · Módulo Transportes / Cuadro de Colores

Esquema, migraciones y datos iniciales de la base `transportedb`.

## Versión de Prisma

**Fijada en 6.x** (`^6.19.3`), deliberadamente y no por descuido.

Prisma 7 introdujo dos cambios incompatibles con el diseño aprobado:

1. **Eliminó `url = env("DATABASE_URL")` del bloque `datasource`.** La conexión pasa a un
   `prisma.config.ts` y a un adaptador entregado al constructor de `PrismaClient`.
2. **Los adaptadores de driver son obligatorios**, lo que exige incorporar `@prisma/adapter-pg`,
   una dependencia nueva. La convención `codigo-limpio-amc` y la guía §0.3 obligan a avisar antes
   de instalar cualquier dependencia fuera del stack.

El esquema de `docs/FASE4-diseno-base-datos.md` §10 —27 modelos ya aprobados— está escrito en la
sintaxis de la 6.x y **no valida con la 7**. Subir de versión mayor es una decisión que debe
tomarse de forma explícita, no como efecto colateral de una instalación.

## Comandos

| Entorno | Comando |
|---|---|
| Desarrollo | `npm run prisma:migrate` — genera y aplica la migración |
| Producción | `npm run prisma:deploy` — aplica lo pendiente, sin generar |
| Cliente | `npm run prisma:generate` |
| Estado | `npm run prisma:status` |

Las migraciones **no se aplican al arrancar el contenedor**. Son un paso explícito del despliegue:
un arranque que modifica el esquema puede dejar la base a medias.

## Migraciones

| # | Migración | Contenido |
|---|---|---|
| 1 | `esquema_inicial` | 27 tablas, 11 enumerados, 23 índices únicos y 31 claves foráneas |
| 2 | `agrega_restricciones_verificacion` | **24 restricciones `CHECK`**: las 22 de FASE4-base-datos §7.1 más dos de `t_parametro_politica` |
| 3 | `agrega_indices_parciales` | **7 índices con predicado**: los 6 del diseño más el único parcial de órdenes vigentes |
| 4 | `agrega_valor_por_defecto_a_marcas_de_actualizacion` | `DEFAULT now()` en las columnas con `@updatedAt`. Ver más abajo |
| 15 | `adicional_del_dia_sobre_un_operativo` | `oper_origen_id`, **dos únicos parciales** que separan la serie del adicional de la ordinaria, y el parcial de su clave foránea |

## Elementos que Prisma no expresa

Prisma no soporta restricciones `CHECK` ni predicados de índice. Van en migraciones manuales.

### Verificación automática

```bash
npm run prisma:verificar
```

Comprueba que están las **29 tablas**, los 11 enumerados, las **25 restricciones** y los **11
índices parciales**. **Ejecutarlo después de cada migración estructural.** Si algo se perdió, falla
con el nombre exacto del objeto ausente.

> La restricción `ck_operativo_transporte` **nunca se elimina** para simplificar una migración: es
> la que hace imposible almacenar un operativo `ASIGNADO` sin conductor.

> **`uq_operativo_cuad_form_sec` y `uq_operativo_cuad_form_sec_adic` SE RETIRARON el 2026-09-17.**
> Las patrullas (Form 5/6) numeran POR PREFIJO —cada área desde 001—, así que `IGNECU-001`,
> `ITNECU-001` e `INECU-001` comparten `(cuadro, formulario, secuencial)` y colisionarían en ese
> único. La unicidad del secuencial la garantiza `uq_operativo_cuad_ident` (cuadro, identificador):
> como la fecha es constante por cuadro, equivale a unicidad por cuadro+prefijo+secuencial. Ver la
> migración `20260917140000`.

### Los índices que NO se declaran en el esquema

`idx_operativo_conductor`, `idx_operativo_vehiculo`, `idx_disponibilidad_func`,
`idx_disponibilidad_cond`, `idx_funcionario_area` e `idx_operativo_origen` **se retiraron a
propósito de `schema.prisma`** (son parciales, y Prisma no expresa su predicado `WHERE`).

> `idx_operativo_origen` se sumó el 2026-08-20 con el adicional del día, y es parcial por el mismo
> criterio de dominio que `idx_operativo_conductor`: **casi ningún operativo es un adicional**, y un
> índice completo pagaría el mantenimiento de todas las filas nulas para responder consultas que
> solo preguntan por las otras.

> `idx_operativo_vehiculo` se sumó el 2026-08-19, por la misma razón que los otros y con el mismo
> criterio de dominio que `idx_operativo_conductor`: **conductor y vehículo nacen nulos** y solo la
> DAF los completa, así que indexar las filas sin asignar sería pagar por lo que nadie consulta.

Se comprobó empíricamente: si se declaran ahí, Prisma no reconoce su predicado `WHERE`, los reporta
como *«índice eliminado»* en cada comparación, y la siguiente migración **los recrearía completos**,
destruyendo el predicado sin avisar. Al no declararlos, Prisma los ignora por completo y persisten.

Es la solución al problema que advierte `docs/FASE4-diseno-base-datos.md` §10.7, y deja la deriva de
índices en cero.

### Deriva residual conocida y benigna

`prisma migrate diff` sigue reportando una diferencia en el valor por defecto de los enumerados:

```
[*] Altered column `sapo_estado`
    (default changed from Value(Enum("SOLICITADA")) to DbGenerated("'SOLICITADA'::e_estado_solicitud"))
```

**No es deriva real.** El valor por defecto en la base es exactamente el que declara el esquema; lo
que ocurre es que el comparador de Prisma no reconoce la conversión de tipo de PostgreSQL como
equivalente. La migración que propone es idempotente —`SET DEFAULT 'SOLICITADA'` sobre una columna
que ya lo tiene— y **nunca toca restricciones ni índices**.

**No hay que corregirla regenerando tablas.** Esa sí sería una pérdida real.

### Por qué existe la cuarta migración

`@updatedAt` de Prisma **no crea un valor por defecto en la base**: el cliente rellena la columna al
escribir. Pero el diccionario de datos —FASE4-base-datos §6.13— especifica `DEFAULT now()` para
`oper_actualizado_en` y `func_actualizado_en`.

Sin ese valor por defecto, **cualquier inserción que no pase por Prisma falla** con
`null value in column "oper_actualizado_en" violates not-null constraint`. Lo detectaron las pruebas
de restricciones de M-02, que se ejecutan con `psql`.

## Registro de verificaciones

| Fecha | Migración aplicada | Tablas | Enumerados | `CHECK` | Parciales | Verificó |
|---|---|---|---|---|---|---|
| 2026-08-05 | `esquema_inicial` … `agrega_indices_parciales` | 27 | 11 | 24 | 7 | Jose Sosa |
| 2026-08-05 | `agrega_valor_por_defecto_a_marcas_de_actualizacion` | 27 | 11 | 24 | 7 | Jose Sosa |
| 2026-08-20 | `adicional_del_dia_sobre_un_operativo` | 29 | 11 | 25 | 11 | Jose Sosa |

## Datos iniciales

El `seed.ts` llega con el módulo M-03. Debe ser **idempotente**: ejecutarse varias veces sin
duplicar, mediante `upsert` con la clave natural.

Los datos maestros pendientes —matriz zonal ↔ punto de encuentro, personal y conductores— se
dejan con **`TODO` explícito, nunca inventados**. Ver `docs/PENDIENTES-VALIDACION.md`.

## Coexistencia con el ecosistema

El resto de módulos de la institución aplica cambios de base con un ejecutor de scripts y usa
funciones almacenadas `fu_*`. Prisma trae su propio mecanismo. Ambos conviven sin conflicto porque
operan sobre bases distintas: **en `transportedb` nunca existirán funciones `fu_*`**.
