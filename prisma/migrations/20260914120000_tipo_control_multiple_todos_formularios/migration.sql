-- TIPO DE CONTROL MULTIPLE EN TODOS LOS FORMULARIOS. 2026-09-14.
--
-- Hasta ahora `form_tipo_control_multiple` solo era verdadero en el 8 * INSPECCIONES
-- (migracion 20260907130000). El negocio pidio que el campo «Tipo de control» sea de
-- SELECCION MULTIPLE en LOS NUEVE formularios, igual que el 8.
--
-- La maquinaria ya es POR-DATO: tanto el frontend como el backend se ramifican por este
-- flag (`tipoControlMultiple` / `permiteMultiple`) y NINGUN numero de formulario aparece en
-- la logica —solo en comentarios—. Por eso basta activar el flag en todos y trasladar el
-- tipo unico de los operativos existentes al join. No hay cambios de codigo ni de esquema.

-- 1) El flag pasa a verdadero en TODOS los formularios.
UPDATE "t_formulario" SET "form_tipo_control_multiple" = true;

-- 2) Traslado del tipo unico existente al join `t_operativo_tipo_control`.
--    Los operativos anteriores a este cambio guardan su tipo en la columna escalar
--    `t_operativo.tico_id`; el frontend de edicion lee la lista desde el join, asi que sin
--    esto un operativo legado apareceria SIN tipo al corregirlo. Se CONSERVA el escalar: la
--    lectura de documentos (`textoDeTipoControl`) prefiere el join y cae al escalar solo si
--    el join esta vacio, de modo que nada se pierde en ningun caso. Los operativos del 8 ya
--    tienen `tico_id` nulo y sus tipos en el join, asi que la condicion los excluye sola.
INSERT INTO "t_operativo_tipo_control" ("oper_id", "tico_id")
SELECT "oper_id", "tico_id"
FROM "t_operativo"
WHERE "tico_id" IS NOT NULL
ON CONFLICT ("oper_id", "tico_id") DO NOTHING;
