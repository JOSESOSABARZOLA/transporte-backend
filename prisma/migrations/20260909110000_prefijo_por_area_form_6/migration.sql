-- El prefijo del identificador del Formulario 6 (PATRULLA REACCIÓN NOCTURNA) depende del AREA
-- del personal (PV-27, resuelto 2026-09-09): GENERAL -> IGNECU, TECNICO -> ITNECU,
-- INSTRUCCION -> ICNECU. Como el 8 y el 5, el generador elige el prefijo por el area de la
-- gente asignada y RECHAZA mezclar areas en un mismo operativo. El 6 NO tiene prefijos
-- adicionales.
--
-- ICNECU -> INSTRUCCION queda MAPEADO PERO INERTE: en el 6 la Instruccion es un CUPO COMPARTIDO
-- que DMIT anade a un operativo que registra DMIP (el cual ya toma IGNECU/ITNECU por su area);
-- anadir esa persona no regenera el identificador. Un operativo de SOLO Instruccion —que tomaria
-- ICNECU— no se crea hoy porque DMIT no registra operativos del 6, solo aporta. Se deja el
-- mapeo completo por consistencia y para el dia en que el negocio lo habilite.
--
-- ES SOLO DATO. Los tres prefijos ya existen desde la carga de catalogos, con `fpre_area_aplica`
-- NULL —por eso registrar en el 6 se detenia con «varios prefijos y ninguno predeterminado»—.
-- El indice unico ya distingue (form, area, esAdicional) desde la migracion del 8, sin cambios.
--
-- `form_numero = 6` para no depender del id. En la base de pruebas no hay estos prefijos (no
-- siembra los catalogos institucionales) y el UPDATE no toca ninguna fila, que es lo correcto.

UPDATE "t_formulario_prefijo" p
   SET "fpre_area_aplica" = 'GENERAL', "fpre_es_adicional" = false
 WHERE p."fpre_prefijo" = 'IGNECU'
   AND p."form_id" = (SELECT "form_id" FROM "t_formulario" WHERE "form_numero" = 6);

UPDATE "t_formulario_prefijo" p
   SET "fpre_area_aplica" = 'TECNICO', "fpre_es_adicional" = false
 WHERE p."fpre_prefijo" = 'ITNECU'
   AND p."form_id" = (SELECT "form_id" FROM "t_formulario" WHERE "form_numero" = 6);

UPDATE "t_formulario_prefijo" p
   SET "fpre_area_aplica" = 'INSTRUCCION', "fpre_es_adicional" = false
 WHERE p."fpre_prefijo" = 'ICNECU'
   AND p."form_id" = (SELECT "form_id" FROM "t_formulario" WHERE "form_numero" = 6);
