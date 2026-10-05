-- El prefijo del identificador del Formulario 5 (PATRULLA REACCIÓN DIURNA, UIG-UIT) depende
-- del AREA del personal (PV-27, resuelto 2026-09-09): GENERAL -> IGECU, TECNICO -> ITECU.
-- Como el 8, el generador elige el prefijo por el area de la gente asignada y RECHAZA mezclar
-- Inspectores Generales con Tecnicos en un mismo operativo. El 5 NO tiene prefijos adicionales.
--
-- ES SOLO DATO. Los prefijos IGECU/ITECU ya existen desde la carga de catalogos, con
-- `fpre_area_aplica` NULL —por eso registrar en el 5 se detenia con «varios prefijos y ninguno
-- predeterminado»—. El indice unico ya distingue (form, area, esAdicional) desde la migracion
-- del 8, asi que no se toca aqui.
--
-- `form_numero = 5` para no depender del id, que puede variar entre entornos. En la base de
-- pruebas no hay estos prefijos (no siembra los catalogos institucionales) y el UPDATE no toca
-- ninguna fila, que es lo correcto.

UPDATE "t_formulario_prefijo" p
   SET "fpre_area_aplica" = 'GENERAL', "fpre_es_adicional" = false
 WHERE p."fpre_prefijo" = 'IGECU'
   AND p."form_id" = (SELECT "form_id" FROM "t_formulario" WHERE "form_numero" = 5);

UPDATE "t_formulario_prefijo" p
   SET "fpre_area_aplica" = 'TECNICO', "fpre_es_adicional" = false
 WHERE p."fpre_prefijo" = 'ITECU'
   AND p."form_id" = (SELECT "form_id" FROM "t_formulario" WHERE "form_numero" = 5);
