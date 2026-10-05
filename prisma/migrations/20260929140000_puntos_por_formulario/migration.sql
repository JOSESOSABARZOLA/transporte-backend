-- Puntos de encuentro INDEPENDIENTES por formulario (2026-09-29).
--
-- Antes: un punto por (nombre, zonal) GLOBAL, compartido entre formularios via el join
-- `t_formulario_punto`. Crear «Estacion Rio Coca» para un formulario chocaba con el de otro
-- formulario en la misma zonal, porque el nombre era unico por zonal, no por formulario.
--
-- Ahora: cada punto PERTENECE A UN FORMULARIO; el nombre es unico por (formulario, zonal,
-- nombre). Los puntos compartidos se DUPLICAN (una copia por formulario) y cada operativo se
-- reapunta a la copia de su formulario. Se preserva todo el dato existente. La zonal sigue
-- siendo global. Misma receta que 20260907120000 (tipos de control por formulario).

-- 1) Columna del formulario, nullable mientras se rellena.
ALTER TABLE "t_punto_encuentro" ADD COLUMN "form_id" INTEGER;

-- 1b) El nombre deja de ser unico (nombre, zonal) GLOBAL: se retira antes de duplicar, o el
--     paso 3 chocaria con el al crear una copia del mismo nombre/zonal para otro formulario.
DROP INDEX IF EXISTS "uq_punto_nombre_zonal";

-- 2) Cada punto existente queda asignado al formulario de MENOR id entre sus vinculos.
UPDATE "t_punto_encuentro" p
SET "form_id" = sub.min_form
FROM (
  SELECT "pcto_id", MIN("form_id") AS min_form
  FROM "t_formulario_punto"
  GROUP BY "pcto_id"
) sub
WHERE p."pcto_id" = sub."pcto_id";

-- 3) Una copia por cada formulario ADICIONAL que ofrecia el punto (los compartidos). La
--    secuencia de pcto_id esta por delante de los ids existentes, asi que no colisiona.
INSERT INTO "t_punto_encuentro" ("pcto_nombre", "zona_id", "pcto_activo", "form_id")
SELECT p."pcto_nombre", p."zona_id", p."pcto_activo", fp."form_id"
FROM "t_formulario_punto" fp
JOIN "t_punto_encuentro" p ON p."pcto_id" = fp."pcto_id"
WHERE fp."form_id" <> p."form_id";

-- 4) Reapuntar cada operativo a la copia del punto que pertenece a SU formulario (mismo
--    nombre y zonal, form_id del operativo). Los operativos con punto libre (pcto_id NULL) no
--    entran. Todo formulario que uso un punto tiene su copia, asi que `dest` siempre existe.
UPDATE "t_operativo" o
SET "pcto_id" = dest."pcto_id"
FROM "t_punto_encuentro" orig
JOIN "t_punto_encuentro" dest
  ON dest."pcto_nombre" = orig."pcto_nombre" AND dest."zona_id" = orig."zona_id"
WHERE o."pcto_id" = orig."pcto_id"
  AND dest."form_id" = o."form_id";

-- 5) Un punto sin ningun vinculo carece de sentido en el nuevo modelo: se retira. No puede
--    estar referenciado por un operativo (habria violado la pertenencia al formulario).
DELETE FROM "t_punto_encuentro" WHERE "form_id" IS NULL;

-- 6) Retirar el join y consolidar las restricciones del nuevo modelo.
DROP TABLE "t_formulario_punto";

ALTER TABLE "t_punto_encuentro" ALTER COLUMN "form_id" SET NOT NULL;

ALTER TABLE "t_punto_encuentro"
  ADD CONSTRAINT "fk_punto_formulario"
  FOREIGN KEY ("form_id") REFERENCES "t_formulario"("form_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "uq_punto_form_zona_nombre" ON "t_punto_encuentro"("form_id", "zona_id", "pcto_nombre");
CREATE INDEX "idx_punto_formulario" ON "t_punto_encuentro"("form_id");
