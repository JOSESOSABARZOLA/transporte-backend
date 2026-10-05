-- El prefijo de Instruccion del Formulario 6 (PATRULLA REACCIÓN NOCTURNA) se renombra
-- ICNECU -> INECU (2026-09-09), a peticion del negocio: sigue el patron I+NECU de los otros
-- —IGNECU (General), ITNECU (Tecnico)—. El area (INSTRUCCION) no cambia; sigue mapeado pero
-- inerte hasta que se habilite registrar operativos de solo Instruccion en el 6.
--
-- ES SOLO DATO. `form_numero = 6` para no depender del id. INECU no existe aun en el 6, asi
-- que el renombre no choca con la unicidad del prefijo. En la base de pruebas no hay estos
-- prefijos (no siembra los catalogos) y el UPDATE no toca ninguna fila.

UPDATE "t_formulario_prefijo" p
   SET "fpre_prefijo" = 'INECU'
 WHERE p."fpre_prefijo" = 'ICNECU'
   AND p."form_id" = (SELECT "form_id" FROM "t_formulario" WHERE "form_numero" = 6);
