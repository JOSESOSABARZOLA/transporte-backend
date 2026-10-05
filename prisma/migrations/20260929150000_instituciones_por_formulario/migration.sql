-- Instituciones INDEPENDIENTES por formulario (2026-09-29).
--
-- Antes: catalogo global `t_institucion` (sigla unica global) + join
-- `t_formulario_institucion`. Una sigla era UNA fila compartida por varios formularios.
--
-- Ahora: cada institucion PERTENECE A UN FORMULARIO; la sigla es unica por (formulario,
-- sigla). Las compartidas se DUPLICAN (una copia por formulario) y cada operativo se reapunta
-- a la copia de su formulario. Misma receta que 20260907120000 (tipos de control) y que la
-- migracion de puntos de esta entrega.

-- 1) Columna del formulario, nullable mientras se rellena.
ALTER TABLE "t_institucion" ADD COLUMN "form_id" INTEGER;

-- 1b) La sigla deja de ser unica GLOBAL: se retira antes de duplicar.
DROP INDEX IF EXISTS "uq_institucion_sigla";

-- 2) Cada institucion existente queda asignada al formulario de MENOR id entre sus vinculos.
UPDATE "t_institucion" i
SET "form_id" = sub.min_form
FROM (
  SELECT "inst_id", MIN("form_id") AS min_form
  FROM "t_formulario_institucion"
  GROUP BY "inst_id"
) sub
WHERE i."inst_id" = sub."inst_id";

-- 3) Una copia por cada formulario ADICIONAL que ofrecia la institucion (las compartidas).
INSERT INTO "t_institucion" ("inst_sigla", "inst_nombre", "inst_activo", "form_id")
SELECT i."inst_sigla", i."inst_nombre", i."inst_activo", fi."form_id"
FROM "t_formulario_institucion" fi
JOIN "t_institucion" i ON i."inst_id" = fi."inst_id"
WHERE fi."form_id" <> i."form_id";

-- 4) Reapuntar cada vinculo operativo↔institucion a la copia del formulario del operativo
--    (misma sigla, form_id del operativo). `t_operativo_institucion` es un join (oper_id,
--    inst_id): se cambia el inst_id a la copia correspondiente.
UPDATE "t_operativo_institucion" oi
SET "inst_id" = dest."inst_id"
FROM "t_operativo" o, "t_institucion" orig, "t_institucion" dest
WHERE oi."oper_id" = o."oper_id"
  AND oi."inst_id" = orig."inst_id"
  AND dest."inst_sigla" = orig."inst_sigla"
  AND dest."form_id" = o."form_id";

-- 5) Una institucion sin ningun vinculo se retira.
DELETE FROM "t_institucion" WHERE "form_id" IS NULL;

-- 6) Retirar el join y consolidar las restricciones del nuevo modelo.
DROP TABLE "t_formulario_institucion";

ALTER TABLE "t_institucion" ALTER COLUMN "form_id" SET NOT NULL;

ALTER TABLE "t_institucion"
  ADD CONSTRAINT "fk_institucion_formulario"
  FOREIGN KEY ("form_id") REFERENCES "t_formulario"("form_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "uq_institucion_form_sigla" ON "t_institucion"("form_id", "inst_sigla");
CREATE INDEX "idx_institucion_formulario" ON "t_institucion"("form_id");
