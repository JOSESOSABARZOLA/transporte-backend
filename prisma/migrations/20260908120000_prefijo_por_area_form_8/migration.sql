-- El prefijo del identificador del Formulario 8 depende del AREA del personal (PV-27):
-- GENERAL -> IG (ordinario) / IGA (adicional); TECNICO -> IT (ordinario) / ITA (adicional).
-- SOLO el 8: los demas formularios tienen `fpre_area_aplica` NULL y no cambian.
--
-- El unico pasa de (formulario, area) a (formulario, area, esAdicional): el 8 necesita DOS
-- prefijos en la misma area —el ordinario y el adicional—, que con el unico anterior no
-- podian coexistir. Los NULL de los otros formularios siguen siendo distintos entre si.

-- 1) Se retira el unico anterior para poder poblar dos prefijos en la misma area del 8.
DROP INDEX "uq_formulario_prefijo_area";

-- 2) Prefijos del formulario 8 por area (ordinario y adicional). `form_numero = 8` para no
--    depender del id, que puede variar entre entornos.
UPDATE "t_formulario_prefijo" p
   SET "fpre_area_aplica" = 'GENERAL', "fpre_es_adicional" = false
 WHERE p."fpre_prefijo" = 'IG'
   AND p."form_id" = (SELECT "form_id" FROM "t_formulario" WHERE "form_numero" = 8);

UPDATE "t_formulario_prefijo" p
   SET "fpre_area_aplica" = 'TECNICO', "fpre_es_adicional" = false
 WHERE p."fpre_prefijo" = 'IT'
   AND p."form_id" = (SELECT "form_id" FROM "t_formulario" WHERE "form_numero" = 8);

UPDATE "t_formulario_prefijo" p
   SET "fpre_area_aplica" = 'GENERAL', "fpre_es_adicional" = true
 WHERE p."fpre_prefijo" = 'IGA'
   AND p."form_id" = (SELECT "form_id" FROM "t_formulario" WHERE "form_numero" = 8);

UPDATE "t_formulario_prefijo" p
   SET "fpre_area_aplica" = 'TECNICO', "fpre_es_adicional" = true
 WHERE p."fpre_prefijo" = 'ITA'
   AND p."form_id" = (SELECT "form_id" FROM "t_formulario" WHERE "form_numero" = 8);

-- 3) El nuevo unico, que distingue ordinario de adicional dentro de la misma area.
CREATE UNIQUE INDEX "uq_formulario_prefijo_area" ON "t_formulario_prefijo"("form_id", "fpre_area_aplica", "fpre_es_adicional");
