-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: agrega_indices_parciales
-- Responsabilidad: Convertir en parciales los indices que solo deben contener las filas
--                  relevantes, y crear el unico parcial de ordenes vigentes.
-- Fuente: docs/FASE4-diseno-base-datos.md secciones 8.2 y 3.3.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-08-05
--
-- Prisma no expresa predicados de indice. Los indices llegan aqui creados por la
-- migracion inicial como indices completos; se eliminan y se recrean con su WHERE.
-- El nombre se conserva para que el esquema los siga reconociendo.
--
-- ATENCION: tras cada migracion estructural que regenere una de estas tablas hay que
-- verificar que los predicados siguen presentes. Ver prisma/README.md.

-- ─────────────────── 1. Solapamiento de conductor ───────────────────
-- Solo interesan los operativos que YA tienen conductor asignado. El indice completo
-- incluiria todas las filas con cond_id nulo, que son la mayoria mientras la DAF no
-- ha intervenido.
DROP INDEX IF EXISTS "idx_operativo_conductor";
CREATE INDEX "idx_operativo_conductor"
  ON "t_operativo" ("cond_id", "oper_hora_inicio", "oper_hora_fin")
  WHERE "cond_id" IS NOT NULL;

-- ─────────────────── 2. Recuento de pendientes del dia ───────────────────
CREATE INDEX "idx_operativo_alerta"
  ON "t_operativo" ("cuad_id")
  WHERE "oper_alerta_activa" = true;

-- ─────────────────── 3. RN-25 · Conteo de salidas pesadas ───────────────────
-- Solo las filas que suman al tope: nocturnas o de fin de semana.
CREATE INDEX "idx_historial_pesadas"
  ON "t_historial_jornada" ("func_id")
  WHERE "hist_fue_nocturna" = true OR "hist_fue_fin_semana" = true;

-- ─────────────── 4 y 5. Disponibilidad por sujeto ───────────────
-- Las tres referencias son excluyentes, asi que cada indice solo debe contener sus filas.
DROP INDEX IF EXISTS "idx_disponibilidad_func";
CREATE INDEX "idx_disponibilidad_func"
  ON "t_disponibilidad" ("func_id", "disp_desde", "disp_hasta")
  WHERE "func_id" IS NOT NULL;

DROP INDEX IF EXISTS "idx_disponibilidad_cond";
CREATE INDEX "idx_disponibilidad_cond"
  ON "t_disponibilidad" ("cond_id", "disp_desde", "disp_hasta")
  WHERE "cond_id" IS NOT NULL;

-- ─────────────────── 6. Personal elegible por area ───────────────────
-- El personal inactivo nunca se ofrece: no tiene sentido indexarlo.
DROP INDEX IF EXISTS "idx_funcionario_area";
CREATE INDEX "idx_funcionario_area"
  ON "t_funcionario" ("func_area")
  WHERE "func_activo" = true;

-- ───────────── INV-23 · Una sola orden VIGENTE por operativo y funcionario ─────────────
-- Indice unico PARCIAL: permite conservar el historico de ordenes anuladas y reemitidas
-- -que INV-25 exige, porque una orden emitida es inmutable y la correccion genera una
-- nueva emision- sin violar la unicidad.
CREATE UNIQUE INDEX "uq_orden_vigente"
  ON "t_orden_servicio" ("oper_id", "func_id")
  WHERE "oser_vigente" = true;
