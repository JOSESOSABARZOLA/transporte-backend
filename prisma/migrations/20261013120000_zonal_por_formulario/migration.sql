-- ═══════════════════════════════════════════════════════════════════════════════
-- Microservicio: transporte · Módulo: Cuadro de Colores · Feature: Formularios y catálogos
-- Migración: 20261013120000_zonal_por_formulario (2026-10-13). ADITIVA E IDEMPOTENTE.
--
-- CADA FORMULARIO TIENE SUS PROPIAS ZONALES. Regla de negocio: al elegir un formulario se cargan
-- SOLO sus configuraciones, y un cambio en uno nunca afecta a otro. Los puntos, los tipos de
-- control y las instituciones ya eran de un formulario; la zonal era la única pieza global.
--
-- `t_zonal` NO CAMBIA: pasa a ser la ZONA DE LA CIUDAD, que siguen usando la ficha de personal, la
-- flota, los tramos, la matriz de traslados y Transporte para reconocer el mismo sitio entre
-- operativos de formularios distintos. Duplicarla por formulario rompía todo eso.
--
-- `t_zonal_formulario` (nueva) es la zonal DE UN formulario: nombre y estado propios, y la zona de
-- la ciudad a la que corresponde. Una por (formulario, zona); el nombre, único en el formulario.
-- Los puntos y `t_operativo_zonal` siguen guardando `zona_id`: el formulario lo dan el punto y el
-- operativo, así que NINGÚN operativo histórico se reapunta.
--
-- PASOS
--   1. La tabla, sus únicos y sus FK.
--   2. Se borran las cuatro «zonales» que en realidad eran puntos de encuentro (aprobado por
--      negocio el 2026-10-13), SOLO si nunca se usaron: ni operativos en sus puntos, ni
--      `t_operativo_zonal`, ni fichas, ni flota, ni traslados, ni tramos, ni talleres. Si alguna
--      tiene uso, se conserva y el paso 3 le crea su zonal de formulario; queda para el script
--      `limpieza-catalogos` (`--incluir-zonales`), que la fusiona o la reporta.
--   3. Una zonal de formulario por cada par (formulario, zona) que hoy tiene puntos u operativos,
--      con el nombre, el estado y el orden de su zona. Las zonas que el formulario nunca usó no se
--      crean: el administrador las agrega desde «Catálogos del cuadro».
--   4. La FK compuesta punto → zonal de SU formulario. Tras el paso 3 no puede haber huérfanos;
--      se agrega NOT VALID y se valida aparte para que, si los hubiera, falle con su nombre.
--
-- IDEMPOTENTE: `IF NOT EXISTS`, `ON CONFLICT DO NOTHING` y comprobación en `pg_constraint`.
-- REVERSIÓN: la tabla nueva puede borrarse sin tocar nada más (antes, la FK del punto). Las cuatro
-- zonas borradas en el paso 2 no se recuperan sin el respaldo: hacer `pg_dump` antes.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1) La tabla ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.t_zonal_formulario (
  zofo_id     SERIAL       PRIMARY KEY,
  form_id     INTEGER      NOT NULL,
  zona_id     INTEGER      NOT NULL,
  zofo_nombre VARCHAR(90)  NOT NULL,
  zofo_activo BOOLEAN      NOT NULL DEFAULT true,
  zofo_orden  INTEGER      NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_zonal_formulario_zona
  ON public.t_zonal_formulario (form_id, zona_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_zonal_formulario_nombre
  ON public.t_zonal_formulario (form_id, zofo_nombre);
CREATE INDEX IF NOT EXISTS idx_zonal_formulario_zona
  ON public.t_zonal_formulario (zona_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_zonal_formulario_formulario') THEN
    ALTER TABLE public.t_zonal_formulario
      ADD CONSTRAINT fk_zonal_formulario_formulario FOREIGN KEY (form_id)
      REFERENCES public.t_formulario (form_id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_zonal_formulario_zona') THEN
    ALTER TABLE public.t_zonal_formulario
      ADD CONSTRAINT fk_zonal_formulario_zona FOREIGN KEY (zona_id)
      REFERENCES public.t_zonal (zona_id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 2) Las cuatro «zonales» que eran puntos, solo si nunca se usaron ──────────────────
-- Tabla temporal SIN «ON COMMIT DROP»: si la migración no corre en una transacción, se borraría
-- al terminar su propia sentencia. Se borra a mano al final del paso.
DROP TABLE IF EXISTS tmp_zonas_sobrantes;
CREATE TEMP TABLE tmp_zonas_sobrantes AS
SELECT z.zona_id
FROM public.t_zonal z
WHERE z.zona_codigo IN (
        'HOSPITAL_CARLOS_ANDRADE_MARIN',
        'CAJA_DEL_SEGURO',
        'BOULEVARD_NNUU',
        'PATRULLA_MOVIL_2_LIMPIA_PARABR'
      )
  AND NOT EXISTS (SELECT 1 FROM public.t_operativo_zonal oz WHERE oz.zona_id = z.zona_id)
  AND NOT EXISTS (
        SELECT 1 FROM public.t_operativo o
        JOIN public.t_punto_encuentro p ON p.pcto_id = o.pcto_id
        WHERE p.zona_id = z.zona_id
      )
  AND NOT EXISTS (SELECT 1 FROM public.t_funcionario f WHERE f.func_zonal_id = z.zona_id)
  AND NOT EXISTS (SELECT 1 FROM public.t_ubicacion_flota u WHERE u.zona_id = z.zona_id)
  AND NOT EXISTS (
        SELECT 1 FROM public.t_tramo_transporte t
        WHERE t.trtr_zonal_origen_id = z.zona_id OR t.trtr_zonal_destino_id = z.zona_id
      )
  AND NOT EXISTS (
        SELECT 1 FROM public.t_traslado_zonal t
        WHERE t.trzo_zonal_origen_id = z.zona_id OR t.trzo_zonal_destino_id = z.zona_id
      )
  AND NOT EXISTS (SELECT 1 FROM public.t_disponibilidad d WHERE d.disp_zonal_taller_id = z.zona_id);

DELETE FROM public.t_punto_encuentro p
USING tmp_zonas_sobrantes s
WHERE p.zona_id = s.zona_id;

DELETE FROM public.t_zonal_formulario zf
USING tmp_zonas_sobrantes s
WHERE zf.zona_id = s.zona_id;

DELETE FROM public.t_zonal z
USING tmp_zonas_sobrantes s
WHERE z.zona_id = s.zona_id;

DROP TABLE tmp_zonas_sobrantes;

-- 3) Una zonal de formulario por cada par (formulario, zona) en uso ─────────────────
INSERT INTO public.t_zonal_formulario (form_id, zona_id, zofo_nombre, zofo_activo, zofo_orden)
SELECT pares.form_id, z.zona_id, z.zona_nombre, z.zona_activo, z.zona_orden
FROM (
  SELECT p.form_id, p.zona_id FROM public.t_punto_encuentro p
  UNION
  SELECT o.form_id, oz.zona_id
  FROM public.t_operativo_zonal oz
  JOIN public.t_operativo o ON o.oper_id = oz.oper_id
) pares
JOIN public.t_zonal z ON z.zona_id = pares.zona_id
ORDER BY pares.form_id, z.zona_orden
ON CONFLICT DO NOTHING;

-- 4) El punto cuelga de una zonal de SU formulario ───────────────────────────────────
-- NO ACTION (no RESTRICT): se comprueba al final de la sentencia, así que borrar un formulario
-- —que arrastra en cascada sus puntos y sus zonales— no choca por el orden del borrado.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_punto_zonal_formulario') THEN
    ALTER TABLE public.t_punto_encuentro
      ADD CONSTRAINT fk_punto_zonal_formulario FOREIGN KEY (form_id, zona_id)
      REFERENCES public.t_zonal_formulario (form_id, zona_id)
      ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE public.t_punto_encuentro VALIDATE CONSTRAINT fk_punto_zonal_formulario;
