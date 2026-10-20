-- ═══════════════════════════════════════════════════════════════════════════════
-- Microservicio: transporte · Módulo: Cuadro de Colores
-- Feature: Transporte DAF · versión consolidada
-- Migración: 20261007090000_transporte_consolidada
-- Desarrollador: Jose Sosa · Fecha: 2026-10-07
--
-- ADITIVA E IDEMPOTENTE. Se puede ejecutar dos veces sin efecto en la segunda.
--
--  1. t_formulario.form_tipo_transporte_defecto (COMPLETO); el PMO arranca en INICIO_Y_FIN.
--  2. Los operativos PMO activos en COMPLETO y SIN conductor (ni en el operativo ni en ningún
--     tramo) pasan a INICIO_Y_FIN, y se BORRAN sus tramos (todos sin asignar). Los tramos de
--     dejar/retirar los vuelve a crear la generación idempotente de siempre
--     (`POST /transporte/tramos/generar`, que la pantalla de planificación llama al abrir el día,
--     y el optimizador): genera los tramos de todo operativo que no tiene ninguno. Así el plan de
--     tramos sale del mismo código (`plan-tramos.ts`) y no de un SQL paralelo.
--  3. Renombre de cuatro parámetros al prefijo DAF_, conservando su valor.
--  4. Parámetros nuevos de la DAF (mínimos por turno, días sin libre, noche→día, vencimientos).
--  5. t_conductor.cond_patron_rotacion (VARCHAR(14), D/N/E/L/A).
--  6. Permiso carga-inicial:administrar (solo ADMINISTRADOR) y parametros:administrar para el
--     ADMINISTRADOR_DAF.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1 · Tipo de transporte por defecto del formulario
ALTER TABLE public.t_formulario
  ADD COLUMN IF NOT EXISTS form_tipo_transporte_defecto public.e_tipo_transporte NOT NULL DEFAULT 'COMPLETO';

UPDATE public.t_formulario
   SET form_tipo_transporte_defecto = 'INICIO_Y_FIN'
 WHERE form_codigo = 'PMO'
   AND form_tipo_transporte_defecto = 'COMPLETO';

-- 2 · Operativos PMO existentes → INICIO_Y_FIN (solo los que nadie ha asignado todavía)
WITH candidatos AS (
  SELECT o.oper_id
    FROM public.t_operativo o
    JOIN public.t_formulario f ON f.form_id = o.form_id
   WHERE f.form_codigo = 'PMO'
     AND o.oper_activo = true
     AND o.oper_tipo_transporte = 'COMPLETO'
     AND o.cond_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.t_tramo_transporte t
        WHERE t.oper_id = o.oper_id AND t.cond_id IS NOT NULL
     )
), borrados AS (
  DELETE FROM public.t_tramo_transporte t
   USING candidatos c
   WHERE t.oper_id = c.oper_id
)
UPDATE public.t_operativo o
   SET oper_tipo_transporte = 'INICIO_Y_FIN'
  FROM candidatos c
 WHERE o.oper_id = c.oper_id;

-- 3 · Renombres al prefijo DAF_ (conservan el valor; idempotente: solo si el nuevo no existe)
UPDATE public.t_parametro_politica p
   SET para_clave = r.nueva
  FROM (VALUES
    ('DURACION_TRAMO_PMO_MIN', 'DAF_DURACION_TRAMO_MIN'),
    ('MAX_JORNADA_HORAS',      'DAF_MAX_JORNADA_HORAS'),
    ('JORNADA_AVISO_HORAS',    'DAF_JORNADA_AVISO_HORAS'),
    ('DESCANSO_MIN_HORAS',     'DAF_DESCANSO_MIN_HORAS')
  ) AS r(vieja, nueva)
 WHERE p.para_clave = r.vieja
   AND NOT EXISTS (SELECT 1 FROM public.t_parametro_politica x WHERE x.para_clave = r.nueva);

UPDATE public.t_parametro_politica
   SET para_descripcion = 'Transporte DAF. Duración de un tramo de dejar o retirar personal (operativos que solo piden inicio, fin o ambos, como el PMO).'
 WHERE para_clave = 'DAF_DURACION_TRAMO_MIN';

-- 4 · Parámetros nuevos de la DAF («sin configurar» = SIN_CONFIGURAR o 0: no se evalúa)
INSERT INTO public.t_parametro_politica
  (para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en)
VALUES
  ('DAF_MIN_CONDUCTORES_DIA', 'SIN_CONFIGURAR', 'TEXTO', 'Transporte DAF. Mínimo de conductores en turno DÍA por día de la semana: siete enteros L,M,X,J,V,S,D separados por comas, o SIN_CONFIGURAR (no se evalúa).', NULL, NULL, NULL, NULL, now()),
  ('DAF_MIN_CONDUCTORES_NOCHE', 'SIN_CONFIGURAR', 'TEXTO', 'Transporte DAF. Mínimo de conductores en turno NOCHE por día de la semana: siete enteros L,M,X,J,V,S,D separados por comas, o SIN_CONFIGURAR (no se evalúa).', NULL, NULL, NULL, NULL, now()),
  ('DAF_MAX_DIAS_SIN_LIBRE', '0', 'ENTERO', 'Transporte DAF. Máximo de días seguidos con turno sin un LIBRE. 0 = no se evalúa.', 'días', '0', '31', NULL, now()),
  ('DAF_PERMITE_NOCHE_A_DIA', 'SIN_CONFIGURAR', 'TEXTO', 'Transporte DAF. ¿Se admite un turno DÍA al día siguiente de una NOCHE? SI, NO o SIN_CONFIGURAR (no se evalúa).', NULL, NULL, NULL, NULL, now()),
  ('DAF_DIAS_AVISO_VENCIMIENTO', '30', 'ENTERO', 'Transporte DAF. Días de anticipación con que se avisa que vence la matrícula o el SOAT de un vehículo.', 'días', '1', '365', NULL, now())
ON CONFLICT DO NOTHING;

-- 5 · Patrón de rotación del conductor
ALTER TABLE public.t_conductor
  ADD COLUMN IF NOT EXISTS cond_patron_rotacion VARCHAR(14);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_conductor_patron_rotacion') THEN
    ALTER TABLE public.t_conductor
      ADD CONSTRAINT ck_conductor_patron_rotacion
      CHECK (cond_patron_rotacion IS NULL OR cond_patron_rotacion ~ '^[DNELA]{2,14}$');
  END IF;
END $$;

-- 6 · Permisos
INSERT INTO "t_permiso" ("perm_codigo","perm_modulo","perm_descripcion")
VALUES ('carga-inicial:administrar', 'administracion', 'Cargar datos iniciales desde Excel (conductores, vehículos, garajes y turnos)')
ON CONFLICT DO NOTHING;

INSERT INTO "t_rol_permiso" ("rper_rol","rper_permiso")
VALUES ('ADMINISTRADOR', 'carga-inicial:administrar'),
       ('ADMINISTRADOR_DAF', 'parametros:administrar')
ON CONFLICT DO NOTHING;
