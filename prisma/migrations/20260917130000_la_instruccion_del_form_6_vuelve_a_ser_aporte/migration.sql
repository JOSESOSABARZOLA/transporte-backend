-- LA INSTRUCCIÓN DEL FORMULARIO 6 VUELVE A SER APORTE DEL DMIT. 2026-09-17.
--
-- Revierte `20260917110000` (que puso al DMIT en ESCRITURA para registrar la Instrucción aparte).
-- El negocio precisó el modelo: el DMIP REGISTRA la patrulla (Inspector General/Técnico →
-- IGNECU/ITNECU) y el DMIT AGREGA (aporta) su persona de Instrucción a esa patrulla YA creada. Ese
-- aporte genera su propio código `INECU` y queda en el MISMO lote (`grupoRegistro`); la lógica vive
-- en `asignarPersonal` (rama de formularios `variosPorPersona`), no en el acceso del rol.
--
-- NO se toca `farea_es_compartida` de INSTRUCCION (sigue true: es lo que `reglaCupoCompartido` usa
-- para acotar al DMIT a Instrucción) ni el prefijo `INECU→INSTRUCCION` (imprescindible: el aporte
-- lo usa). `form_numero = 6` para no depender del id; la base de pruebas no lo toca.
--
-- EL CUPO (1) NO ACOTA el número de miembros de Instrucción por patrulla: como cada aporte crea un
-- operativo NUEVO (no suma al destino), `reglaCupoCompartido` cuenta 0 en el destino y nunca
-- bloquea. Solo habilita el aporte y su restricción de área (Instrucción). Aportes ilimitados.

DO $$
DECLARE
  fid integer;
BEGIN
  SELECT "form_id" INTO fid FROM "t_formulario" WHERE "form_numero" = 6;
  IF fid IS NULL THEN
    RETURN; -- base de pruebas / sin catálogos: nada que revertir.
  END IF;

  UPDATE "t_formulario_rol"
     SET "frol_acceso" = 'APORTA', "frol_cupo" = 1
   WHERE "frol_rol" = 'DMIT_INSTRUCTOR' AND "form_id" = fid;

  IF (SELECT count(*) FROM "t_formulario_rol"
        WHERE "form_id" = fid AND "frol_rol" = 'DMIT_INSTRUCTOR'
          AND "frol_acceso" = 'APORTA' AND "frol_cupo" = 1) <> 1
     OR (SELECT count(*) FROM "t_formulario_area"
        WHERE "form_id" = fid AND "farea_area" = 'INSTRUCCION' AND "farea_es_compartida") <> 1
     OR (SELECT count(*) FROM "t_formulario_prefijo"
        WHERE "form_id" = fid AND "fpre_prefijo" = 'INECU'
          AND "fpre_area_aplica" = 'INSTRUCCION') <> 1
  THEN
    RAISE EXCEPTION 'El Form 6 no quedo con DMIT APORTA(cupo 1) + INSTRUCCION compartida + INECU->INSTRUCCION.';
  END IF;
END $$;
