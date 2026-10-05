-- LA CANTIDAD DE OPERATIVOS POR PERSONA SE SEPARA DEL «UNO POR PERSONA». 2026-09-14.
--
-- Hasta ahora `form_varios_por_persona` hacía DOS cosas a la vez: (a) que cada persona genere
-- su propio operativo —el split, que el 5 y el 8 necesitan para que cada área lleve su código—,
-- y (b) ofrecer el control «Cantidad de operativos» por persona (poder pedir N > 1), que solo
-- el 8 quiere. Al activar el split en el 5 se coló también el control de cantidad, que ahí sobra.
--
-- Se separan en dos flags:
--   · `form_varios_por_persona`  (existente): el SPLIT. Verdadero en el 5 y el 8.
--   · `form_cantidad_por_persona` (nuevo): ofrece el control de cantidad (> 1). Solo el 8.
--
-- Así el 5 divide por persona (cada área su código) pero SIN la columna de cantidad, y una
-- cantidad > 1 en el 5 se rechaza. No cambia el split; solo separa quién ofrece la cantidad.
ALTER TABLE "t_formulario"
  ADD COLUMN "form_cantidad_por_persona" BOOLEAN NOT NULL DEFAULT false;

UPDATE "t_formulario" SET "form_cantidad_por_persona" = true WHERE "form_numero" = 8;
