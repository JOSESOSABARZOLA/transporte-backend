-- ═══════════════════════════════════════════════════════════════════════════════
-- CADA ADMINISTRADOR VE Y DA DE ALTA A SU PROPIO PERSONAL. 2026-09-01, tarde.
--
-- El negocio lo fijo asi para P-07:
--
--   · `ADMINISTRADOR_DMIP` -> Unidad de Operativos, Inspector General y Inspector Tecnico.
--   · `ADMINISTRADOR_DMIT` -> Personal de Instruccion, y solo el.
--
-- ─────────────────────────── No hace falta ningun concepto nuevo ───────────────────────────
--
-- Esas cuatro etiquetas son AREAS, y cada area pertenece a una direccion desde que existe
-- `ROL_DEL_AREA`: OPERATIVOS es del DMIP de Operativos, GENERAL y TECNICO del DMIP de
-- Inspecciones, e INSTRUCCION del DMIT. La regla pedida es, palabra por palabra, «cada
-- administrador alcanza las areas de las direcciones que administra», y eso ya lo resuelve
-- `direccionesAlAlcance` contra esta tabla.
--
-- POR ESO ESTA MIGRACION SOLO BORRA DOS FILAS. Lo que sobraba era el reparto, no el codigo.
--
-- ─────────────────────────── De donde venian esas dos filas ───────────────────────────
--
-- De la migracion `el_maestro_vuelve_a_un_solo_administrador`, del 2026-09-01 por la
-- manana. Ese mismo dia el negocio decidio que P-07 la abriera **solo** `ADMINISTRADOR_DMIP`,
-- y para que ninguna direccion quedara sin administrador se le dieron las otras tres. Fue
-- correcto mientras esa decision estuvo en pie; hoy se revisa y las filas sobran.
--
-- NADIE QUEDA HUERFANO, y el bloque final lo comprueba: INSTRUCCION pasa a
-- `ADMINISTRADOR_DMIT` -que ya la tenia- y la DAF a `ADMINISTRADOR_DAF`, que la recibio
-- esta misma tarde con las dos pantallas de flota.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1 · El DMIP deja de administrar lo que no es suyo.
DELETE FROM public.t_rol_direccion
 WHERE rodi_rol = 'ADMINISTRADOR_DMIP'
   AND rodi_direccion IN ('DMIT_INSTRUCTOR', 'DAF');

-- ── 2 · Las dos condiciones que tienen que cumplirse a la vez.
DO $$
DECLARE
  huerfanas text;
  duplicadas integer;
BEGIN
  -- NINGUNA DIRECCION CON PERSONAL SE QUEDA SIN ADMINISTRADOR. Si una lo hiciera, sus
  -- fichas dejarian de poder editarse desde cualquier pantalla y nadie se enteraria hasta
  -- que alguien las buscara.
  SELECT string_agg(d.direccion, ', ')
    INTO huerfanas
    FROM (VALUES ('DMIP_OPERATIVOS'), ('DMIP_INSPECCIONES'), ('DMIT_INSTRUCTOR'), ('DAF'))
         AS d(direccion)
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.t_rol_direccion rd
      WHERE rd.rodi_direccion = d.direccion::public.e_rol_departamental
   );

  IF huerfanas IS NOT NULL THEN
    RAISE EXCEPTION
      'Estas direcciones quedarian sin administrador: %. Asignelas antes de aplicar.', huerfanas;
  END IF;

  -- Y EL DMIP SE QUEDA EXACTAMENTE CON DOS: las de sus tres areas. Si quedara con mas, el
  -- borrado no hizo lo que dice; si con menos, se llevo por delante lo que si era suyo.
  SELECT count(*) INTO duplicadas
    FROM public.t_rol_direccion
   WHERE rodi_rol = 'ADMINISTRADOR_DMIP';

  IF duplicadas <> 2 THEN
    RAISE EXCEPTION
      'ADMINISTRADOR_DMIP deberia administrar 2 direcciones y administra %.', duplicadas;
  END IF;
END $$;
