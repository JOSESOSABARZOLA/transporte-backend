-- ═══════════════════════════════════════════════════════════════════════════════
-- LA 4 · PATRULLA ECU DIURNA VUELVE A SER UN FORMULARIO DE APORTE. 2026-08-27.
--
-- El negocio fijó la gestión así: **DMIP Operativos registra** los operativos y el DMIT
-- **solo asigna** hasta dos personas de Instrucción sobre lo que aquel registró. Ni edita
-- el operativo ni lo retira: aportar personal no es tener el formulario (PER-08).
--
-- ES UN CICLO QUE SE CIERRA, Y CONVIENE CONTARLO ENTERO:
--
--   · Hasta el 25-AGO el DMIT aportaba en la ECU, con cupo 2.
--   · El 25-AGO el negocio lo escaló a `ESCRITURA`: los dos departamentos registraban.
--   · Hoy vuelve al modelo de aporte, con el mismo cupo de entonces.
--
-- Quien lea esto sin la historia podría pensar que la migración del 25-AGO fue un error.
-- No lo fue: fue una decisión que el negocio revisó tres días después.
--
-- NO HAY OPERATIVOS QUE QUEDEN HUÉRFANOS. El único de la ECU al escribir esto lo registró
-- `DMIP_OPERATIVOS`, que conserva su `ESCRITURA`. Si lo hubiera creado el DMIT, dejaría de
-- poder editarlo, y por eso la migración lo comprueba antes de tocar nada.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1 · Nadie pierde lo suyo. Si el DMIT tuviera operativos vivos en la ECU, se detiene.
DO $$
DECLARE
  suyos integer;
BEGIN
  SELECT count(*) INTO suyos
    FROM public.t_operativo o
    JOIN public.t_formulario f ON f.form_id = o.form_id
    JOIN public.t_cuadro_diario c ON c.cuad_id = o.cuad_id
   WHERE f.form_codigo = 'ECU'
     AND o.oper_activo
     AND o.oper_creado_por_rol = 'DMIT_INSTRUCTOR'
     AND c.cuad_estado <> 'CERRADO';

  IF suyos <> 0 THEN
    RAISE EXCEPTION
      'El DMIT tiene % operativo(s) vivo(s) en la ECU: al pasar a APORTA dejaria de poder editarlos. Resuelvalos antes.', suyos;
  END IF;
END $$;

-- ── 2 · El DMIT vuelve a aportar, con el cupo que tenía.
UPDATE public.t_formulario_rol
   SET frol_acceso = 'APORTA', frol_cupo = 2
 WHERE frol_rol = 'DMIT_INSTRUCTOR'
   AND form_id = (SELECT form_id FROM public.t_formulario WHERE form_codigo = 'ECU');

-- ── 3 · Y DE QUÉ ÁREA APORTA. Esta es la fila que se olvida.
--
-- `farea_es_compartida` es lo que dice de qué área saca su gente el rol que aporta.
-- Sin ella, `reglaCupoCompartido` rechaza TODAS sus asignaciones con «participa con
-- personal de: ninguna área», y el cambio parece aplicado pero no funciona. Es
-- literalmente la lección que dejó escrita la migración del 25-AGO.
UPDATE public.t_formulario_area
   SET farea_es_compartida = true
 WHERE farea_area = 'INSTRUCCION'
   AND form_id = (SELECT form_id FROM public.t_formulario WHERE form_codigo = 'ECU');

-- ── 4 · Las tres condiciones que tienen que cumplirse a la vez.
DO $$
DECLARE
  escriben integer;
  aportan integer;
  compartidas integer;
BEGIN
  SELECT
      count(*) FILTER (WHERE r.frol_acceso = 'ESCRITURA'),
      count(*) FILTER (WHERE r.frol_acceso = 'APORTA' AND r.frol_cupo = 2)
    INTO escriben, aportan
    FROM public.t_formulario_rol r
    JOIN public.t_formulario f ON f.form_id = r.form_id
   WHERE f.form_codigo = 'ECU';

  SELECT count(*) INTO compartidas
    FROM public.t_formulario_area a
    JOIN public.t_formulario f ON f.form_id = a.form_id
   WHERE f.form_codigo = 'ECU' AND a.farea_es_compartida;

  IF escriben <> 1 OR aportan <> 1 OR compartidas <> 1 THEN
    RAISE EXCEPTION
      'La ECU quedo con % rol(es) de escritura, % de aporte con cupo 2 y % area(s) compartida(s); se esperaba 1, 1 y 1.',
      escriben, aportan, compartidas;
  END IF;
END $$;
