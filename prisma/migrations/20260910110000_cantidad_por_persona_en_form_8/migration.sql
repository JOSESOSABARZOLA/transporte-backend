-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: cantidad_por_persona_en_form_8
-- Responsabilidad: Habilitar "varios operativos POR PERSONA" y encenderlo en el formulario 8.
-- Fuente: decision del negocio del 2026-09-10.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-09-10
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- ES UN FLAG DE CONFIGURACION, NO UN `if` CON UN CODIGO DENTRO.
--
-- La cantidad de operativos deja de ser un contador global del registro (habilitado por
-- area, con UNA sola persona) y pasa a ser POR PERSONA: en un formulario con este flag,
-- cada persona asignada genera sus propios operativos —uno por unidad de su cantidad—,
-- dividiendo su horario. Hoy solo el 8 (INSP: Inspector General e Inspector Tecnico).
--
-- Encenderlo en otro formulario manana es un UPDATE de una fila, no un despliegue, igual
-- que `form_tipo_control_multiple`.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.t_formulario
  ADD COLUMN IF NOT EXISTS form_varios_por_persona BOOLEAN NOT NULL DEFAULT false;

-- El 8 es "8. INSPECCIONES TECNICAS Y GENERALES", codigo INSP. Se identifica por su NUMERO
-- (estable) para no atarse a un codigo que podria renombrarse.
UPDATE public.t_formulario
   SET form_varios_por_persona = true
 WHERE form_numero = 8;

-- Comprobacion: si el 8 existe, quedo encendido. NO se exige que exista (la base de pruebas
-- puede no sembrar el catalogo institucional), solo que ninguno quede en un estado imposible.
DO $$
DECLARE
  encendidos integer;
BEGIN
  SELECT count(*) INTO encendidos
    FROM public.t_formulario
   WHERE form_numero = 8 AND form_varios_por_persona = false;

  IF encendidos <> 0 THEN
    RAISE EXCEPTION 'El formulario 8 quedo sin form_varios_por_persona.';
  END IF;

  RAISE NOTICE 'La cantidad de operativos por persona queda habilitada en el formulario 8.';
END $$;
