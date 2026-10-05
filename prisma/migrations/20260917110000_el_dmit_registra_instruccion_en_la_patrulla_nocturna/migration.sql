-- EL DMIT REGISTRA SU CUPO DE INSTRUCCIÓN EN LA PATRULLA NOCTURNA (FORMULARIO 6). 2026-09-17.
--
-- Hasta hoy el DMIT solo APORTABA una persona de Instrucción a un operativo que registraba el
-- DMIP (PER-08), y ese aporte NO generaba código: por eso `INECU` estaba mapeado pero inerte.
-- El negocio decidió que la Instrucción del 6 salga con SU PROPIO código `INECU`, y para eso su
-- persona tiene que ser un operativo propio, no sumarse a uno ajeno. Es decir: el DMIT REGISTRA.
--
-- Es una excepción DELIBERADA a PER-08 acotada a este cupo del 6, con precedente técnico probado:
-- el Formulario 4/ECU tuvo al DMIT en ESCRITURA (20260825160000), revertido por decisión de
-- negocio, no por defecto. Aquí se hace lo INVERSO de 20260827160000.
--
-- VA DE LA MANO de `20260917100000_varios_por_persona_en_form_6`: con el split, la persona de
-- Instrucción que registra el DMIT sale como un operativo de UNA persona con prefijo `INECU`.
--
-- LA RESTRICCIÓN DE ÁREA la conserva `reglaAreaDelRegistranteInvitado` (composicion-personal.ts):
-- un ESCRITURA que no es el dueño solo pone áreas `esCompartida`. Por eso `farea_es_compartida`
-- de INSTRUCCION en el 6 se MANTIENE en true (no se toca) y no se añade prefijo adicional.
--
-- `form_numero = 6` para no depender del id. En la base de pruebas no hay estos catálogos y el
-- UPDATE no toca ninguna fila, que es lo correcto.

-- ── 1 · El DMIT pasa de aportar a registrar. `ck_formulario_rol_cupo` exige cupo NULL en ESCRITURA.
UPDATE "t_formulario_rol"
   SET "frol_acceso" = 'ESCRITURA', "frol_cupo" = NULL
 WHERE "frol_rol" = 'DMIT_INSTRUCTOR'
   AND "form_id" = (SELECT "form_id" FROM "t_formulario" WHERE "form_numero" = 6);

-- ── 2 · Verificación: si el Formulario 6 existe en esta base, debe quedar coherente.
DO $$
DECLARE
  fid integer;
  escriben integer;
  compartidas integer;
  inecu integer;
BEGIN
  SELECT "form_id" INTO fid FROM "t_formulario" WHERE "form_numero" = 6;
  IF fid IS NULL THEN
    RETURN; -- base de pruebas / sin catálogos institucionales: nada que verificar.
  END IF;

  SELECT count(*) INTO escriben
    FROM "t_formulario_rol"
   WHERE "form_id" = fid AND "frol_rol" = 'DMIT_INSTRUCTOR'
     AND "frol_acceso" = 'ESCRITURA' AND "frol_cupo" IS NULL;

  SELECT count(*) INTO compartidas
    FROM "t_formulario_area"
   WHERE "form_id" = fid AND "farea_area" = 'INSTRUCCION' AND "farea_es_compartida";

  SELECT count(*) INTO inecu
    FROM "t_formulario_prefijo"
   WHERE "form_id" = fid AND "fpre_prefijo" = 'INECU' AND "fpre_area_aplica" = 'INSTRUCCION';

  IF escriben <> 1 OR compartidas <> 1 OR inecu <> 1 THEN
    RAISE EXCEPTION
      'El Form 6 quedo con % rol DMIT en ESCRITURA(cupo NULL), % area INSTRUCCION compartida y % prefijo INECU->INSTRUCCION; se esperaba 1, 1 y 1.',
      escriben, compartidas, inecu;
  END IF;
END $$;
