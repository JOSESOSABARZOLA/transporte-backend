-- Cobertura por turnos (Instrucción) · 2026-10-05
--
-- 1) ESTADO DEL MES: Borrador / Publicado / Publicado con cambios. Es SOLO INFORMATIVO (decisión del
--    usuario): la elegibilidad usa la matriz esté publicada o no. Una fila por (mes, dirección al
--    alcance); sin fila = BORRADOR. Aditiva e idempotente.
-- 2) PARÁMETROS DE AVISOS ENTRE DÍAS (regla 2): se siembran APAGADOS, porque t_parametro_politica
--    exige un valor no vacío (NOT NULL + ck_parametro_valor). 0 y SIN_CONFIGURAR = «no se evalúa»
--    hasta que el administrador los configure en «Ventanas y parámetros».

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'e_estado_cobertura_mes') THEN
    CREATE TYPE public.e_estado_cobertura_mes AS ENUM ('BORRADOR', 'PUBLICADO', 'PUBLICADO_CON_CAMBIOS');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.t_cobertura_mes (
  comes_id             SERIAL PRIMARY KEY,
  comes_mes            VARCHAR(7) NOT NULL,
  comes_direccion      public.e_rol_departamental NOT NULL,
  comes_estado         public.e_estado_cobertura_mes NOT NULL DEFAULT 'BORRADOR',
  comes_publicado_por  INTEGER NULL,
  comes_publicado_en   TIMESTAMPTZ(3) NULL,
  comes_actualizado_en TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_cobertura_mes_formato CHECK (comes_mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cobertura_mes_direccion
  ON public.t_cobertura_mes (comes_mes, comes_direccion);

INSERT INTO public.t_parametro_politica
  (para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en)
VALUES
  ('COBERTURA_MAX_DIAS_SIN_DESCANSO', '0', 'ENTERO', 'Cobertura por turnos (Instrucción). Máximo de días seguidos trabajados (diurno o nocturno) sin descanso antes de AVISAR en la matriz. 0 = no se evalúa. Solo avisa, no bloquea.', 'días', '0', '31', NULL, now()),
  ('COBERTURA_PERMITE_NOCTURNO_A_DIURNO', 'SIN_CONFIGURAR', 'TEXTO', 'Cobertura por turnos (Instrucción). ¿Se admite un turno diurno al día siguiente de uno nocturno? SI, NO o SIN_CONFIGURAR (no se evalúa). Con NO, la matriz AVISA. Solo avisa, no bloquea.', NULL, NULL, NULL, NULL, now())
ON CONFLICT DO NOTHING;

COMMIT;
