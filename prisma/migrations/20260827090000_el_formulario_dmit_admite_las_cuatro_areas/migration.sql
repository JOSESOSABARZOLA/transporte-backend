-- ═══════════════════════════════════════════════════════════════════════════════
-- EL 7 · OPERATIVO DMIT ADMITE LAS CUATRO ÁREAS. 2026-08-27.
--
-- Es el único de los nueve que no coincidía con el reparto que el negocio declaró: pedía
-- «aquí se muestra todo el personal» y la base solo admitía INSTRUCCION y OPERATIVOS, así
-- que un inspector técnico o general no aparecía siquiera en la lista de elegibles.
--
-- NO ES UNA REGLA NUEVA, ES UN DATO QUE FALTABA. La restricción por área existe desde el
-- esquema inicial (RF-014, VAL-10): `GET /personal/elegible` filtra en SQL por
-- `t_formulario_area` y quien no es del área no aparece; `reglaAreaAdmitida` lo vuelve a
-- comprobar al asignar. Aquí solo se completan dos filas.
--
-- `farea_es_compartida = false` EN LAS DOS, y es deliberado: esa marca dice de qué área
-- aporta un rol con acceso `APORTA`, y en el DMIT no hay ninguno —los roles que participan
-- en ese formulario tienen `ESCRITURA`—. Marcarlas no habría abierto nada y habría dejado
-- una marca sin dueño, que es lo que confundió en la ECU el 25-AGO.
--
-- Se busca el formulario POR SU CÓDIGO y no por el identificador 245: el `form_id` es de
-- la semilla y una base reconstruida puede numerarlos de otro modo.
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.t_formulario_area (form_id, farea_area, farea_es_compartida)
SELECT f.form_id, 'GENERAL', false
  FROM public.t_formulario f
 WHERE f.form_codigo = 'DMIT'
ON CONFLICT DO NOTHING;

INSERT INTO public.t_formulario_area (form_id, farea_area, farea_es_compartida)
SELECT f.form_id, 'TECNICO', false
  FROM public.t_formulario f
 WHERE f.form_codigo = 'DMIT'
ON CONFLICT DO NOTHING;

-- Comprobación: si el formulario no quedó con sus cuatro áreas, la migración falla en
-- lugar de dejar el reparto a medias sin que nadie se entere.
DO $$
DECLARE
  cuantas integer;
BEGIN
  SELECT count(*) INTO cuantas
    FROM public.t_formulario_area a
    JOIN public.t_formulario f ON f.form_id = a.form_id
   WHERE f.form_codigo = 'DMIT';

  IF cuantas <> 4 THEN
    RAISE EXCEPTION 'El formulario DMIT quedó con % áreas y debía quedar con 4.', cuantas;
  END IF;
END $$;
