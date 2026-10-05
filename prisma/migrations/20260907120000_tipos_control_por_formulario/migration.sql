-- Tipos de control INDEPENDIENTES por formulario.
--
-- Antes: catalogo global `t_tipo_control` (nombre unico global) + join
-- `t_formulario_tipo_control`. Un nombre era UNA fila compartida por varios formularios, y
-- renombrarla o darla de baja los alcanzaba a todos.
--
-- Ahora: cada tipo PERTENECE A UN FORMULARIO; el nombre es unico por (formulario, nombre).
-- Los tipos compartidos se DUPLICAN (una copia por formulario) y cada operativo se reapunta
-- a la copia de su formulario. Se preserva todo el dato existente.

-- 1) Columna del formulario, nullable mientras se rellena.
ALTER TABLE "t_tipo_control" ADD COLUMN "form_id" INTEGER;

-- 1b) El nombre deja de ser unico GLOBAL: se retira antes de duplicar, o el paso 3 chocaria
--     con el al crear una copia del mismo nombre para otro formulario.
DROP INDEX IF EXISTS "uq_tipo_control_nombre";

-- 2) Cada tipo existente queda asignado al formulario de MENOR id entre sus vinculos.
UPDATE "t_tipo_control" tc
SET "form_id" = sub.min_form
FROM (
  SELECT "tico_id", MIN("form_id") AS min_form
  FROM "t_formulario_tipo_control"
  GROUP BY "tico_id"
) sub
WHERE tc."tico_id" = sub."tico_id";

-- 3) Una copia por cada formulario ADICIONAL que ofrecia el tipo (los compartidos).
--    La secuencia de tico_id esta por delante de los ids sembrados, asi que no colisiona.
INSERT INTO "t_tipo_control" ("tico_nombre", "tico_activo", "form_id")
SELECT tc."tico_nombre", tc."tico_activo", ftc."form_id"
FROM "t_formulario_tipo_control" ftc
JOIN "t_tipo_control" tc ON tc."tico_id" = ftc."tico_id"
WHERE ftc."form_id" <> tc."form_id";

-- 4) Reapuntar cada operativo a la copia del tipo que pertenece a SU formulario
--    (mismo nombre, form_id del operativo). Los operativos con tipo libre (tico_id NULL) no
--    entran. Todo formulario que uso un tipo tiene su copia, asi que `dest` siempre existe.
UPDATE "t_operativo" o
SET "tico_id" = dest."tico_id"
FROM "t_tipo_control" orig
JOIN "t_tipo_control" dest ON dest."tico_nombre" = orig."tico_nombre"
WHERE o."tico_id" = orig."tico_id"
  AND dest."form_id" = o."form_id";

-- 5) Un tipo sin ningun vinculo carece de sentido en el nuevo modelo: se retira. No puede
--    estar referenciado por un operativo (habria violado la pertenencia al formulario).
DELETE FROM "t_tipo_control" WHERE "form_id" IS NULL;

-- 6) Retirar el join y consolidar las restricciones del nuevo modelo.
DROP TABLE "t_formulario_tipo_control";

ALTER TABLE "t_tipo_control" ALTER COLUMN "form_id" SET NOT NULL;

ALTER TABLE "t_tipo_control"
  ADD CONSTRAINT "fk_tipo_control_formulario"
  FOREIGN KEY ("form_id") REFERENCES "t_formulario"("form_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "uq_tipo_control_form_nombre" ON "t_tipo_control"("form_id", "tico_nombre");
CREATE INDEX "idx_tipo_control_formulario" ON "t_tipo_control"("form_id");
