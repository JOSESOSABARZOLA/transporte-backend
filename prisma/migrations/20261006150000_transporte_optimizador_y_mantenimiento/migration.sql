-- Transporte DAF · Fases 3 y 5 (2026-10-06): optimizador, fin del día, insumo de la orden de
-- movilización y mantenimiento (citas de taller con TAREA, checklist diario, kilometraje y vales).
--
-- La orden de movilización OFICIAL (con número) la emite el sistema de órdenes de movilización de
-- la DAF: aquí NO se crea ninguna numeración.
--
-- ADITIVA E IDEMPOTENTE: solo agrega tipos, columnas, tablas, índices y parámetros. Se puede aplicar
-- dos veces sin efecto. REGLA 2: los umbrales nuevos son parámetros (ON CONFLICT DO NOTHING).

BEGIN;

-- ───────────────────────────── Tipos ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'e_estado_mantenimiento') THEN
    CREATE TYPE public.e_estado_mantenimiento AS ENUM ('PROGRAMADO', 'EN_TALLER', 'LISTO');
  END IF;
END $$;

-- ───────────────────────────── Columnas nuevas ─────────────────────────────
-- Cita de taller: su estado y la zonal del taller (destino de la TAREA «Llevar a taller»). Solo
-- aplica a las filas de vehículo; las ausencias del personal no las usan.
ALTER TABLE public.t_disponibilidad
  ADD COLUMN IF NOT EXISTS disp_estado_mantenimiento public.e_estado_mantenimiento,
  ADD COLUMN IF NOT EXISTS disp_zonal_taller_id INTEGER;

-- Las citas que ya existían quedan PROGRAMADAS (es lo que eran: una parada anunciada).
UPDATE public.t_disponibilidad
   SET disp_estado_mantenimiento = 'PROGRAMADO'
 WHERE vehi_id IS NOT NULL
   AND disp_estado = 'MANTENIMIENTO'
   AND disp_estado_mantenimiento IS NULL;

-- La TAREA de taller recuerda la cita que la originó (se borra con ella).
ALTER TABLE public.t_tramo_transporte
  ADD COLUMN IF NOT EXISTS disp_id INTEGER;

-- Quién se llevó el vehículo a su domicilio: al día siguiente se le repite el vehículo.
ALTER TABLE public.t_destino_vehiculo
  ADD COLUMN IF NOT EXISTS cond_id INTEGER;

-- ───────────────────────────── Tablas nuevas ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.t_checklist_vehiculo (
  chve_id             SERIAL PRIMARY KEY,
  vehi_id             INTEGER NOT NULL,
  cond_id             INTEGER NOT NULL,
  chve_fecha          DATE NOT NULL,
  chve_items          JSONB NOT NULL,
  chve_observacion    VARCHAR(400),
  chve_km_salida      INTEGER,
  chve_registrado_por INTEGER NOT NULL,
  chve_creado_en      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_checklist_km CHECK (chve_km_salida IS NULL OR chve_km_salida >= 0)
);

CREATE TABLE IF NOT EXISTS public.t_kilometraje_vehiculo (
  kive_id             SERIAL PRIMARY KEY,
  vehi_id             INTEGER NOT NULL,
  cond_id             INTEGER,
  kive_fecha          DATE NOT NULL,
  kive_km             INTEGER NOT NULL,
  kive_registrado_por INTEGER NOT NULL,
  kive_creado_en      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_kilometraje_km CHECK (kive_km >= 0)
);

CREATE TABLE IF NOT EXISTS public.t_vale_combustible (
  vaco_id             SERIAL PRIMARY KEY,
  cond_id             INTEGER NOT NULL,
  vehi_id             INTEGER NOT NULL,
  vaco_fecha          DATE NOT NULL,
  vaco_monto          SMALLINT NOT NULL,
  vaco_numero         VARCHAR(40),
  vaco_registrado_por INTEGER NOT NULL,
  vaco_creado_en      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Los vales de la DAF son de 10 o de 20 dólares.
  CONSTRAINT ck_vale_monto CHECK (vaco_monto IN (10, 20))
);

-- ───────────────────────────── Índices y únicos ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tramo_mantenimiento ON public.t_tramo_transporte (disp_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_checklist_vehi_cond_fecha ON public.t_checklist_vehiculo (vehi_id, cond_id, chve_fecha);
CREATE INDEX IF NOT EXISTS idx_checklist_fecha ON public.t_checklist_vehiculo (chve_fecha);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kilometraje_vehi_fecha ON public.t_kilometraje_vehiculo (vehi_id, kive_fecha);
CREATE INDEX IF NOT EXISTS idx_vale_fecha ON public.t_vale_combustible (vaco_fecha);
CREATE INDEX IF NOT EXISTS idx_vale_conductor_fecha ON public.t_vale_combustible (cond_id, vaco_fecha);

-- ───────────────────────────── Claves foráneas ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_disponibilidad_zonal_taller') THEN
    ALTER TABLE public.t_disponibilidad ADD CONSTRAINT fk_disponibilidad_zonal_taller
      FOREIGN KEY (disp_zonal_taller_id) REFERENCES public.t_zonal (zona_id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tramo_mantenimiento') THEN
    ALTER TABLE public.t_tramo_transporte ADD CONSTRAINT fk_tramo_mantenimiento
      FOREIGN KEY (disp_id) REFERENCES public.t_disponibilidad (disp_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_destino_conductor') THEN
    ALTER TABLE public.t_destino_vehiculo ADD CONSTRAINT fk_destino_conductor
      FOREIGN KEY (cond_id) REFERENCES public.t_conductor (cond_id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_checklist_vehiculo') THEN
    ALTER TABLE public.t_checklist_vehiculo ADD CONSTRAINT fk_checklist_vehiculo
      FOREIGN KEY (vehi_id) REFERENCES public.t_vehiculo (vehi_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_checklist_conductor') THEN
    ALTER TABLE public.t_checklist_vehiculo ADD CONSTRAINT fk_checklist_conductor
      FOREIGN KEY (cond_id) REFERENCES public.t_conductor (cond_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_kilometraje_vehiculo') THEN
    ALTER TABLE public.t_kilometraje_vehiculo ADD CONSTRAINT fk_kilometraje_vehiculo
      FOREIGN KEY (vehi_id) REFERENCES public.t_vehiculo (vehi_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_kilometraje_conductor') THEN
    ALTER TABLE public.t_kilometraje_vehiculo ADD CONSTRAINT fk_kilometraje_conductor
      FOREIGN KEY (cond_id) REFERENCES public.t_conductor (cond_id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vale_conductor') THEN
    ALTER TABLE public.t_vale_combustible ADD CONSTRAINT fk_vale_conductor
      FOREIGN KEY (cond_id) REFERENCES public.t_conductor (cond_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vale_vehiculo') THEN
    ALTER TABLE public.t_vale_combustible ADD CONSTRAINT fk_vale_vehiculo
      FOREIGN KEY (vehi_id) REFERENCES public.t_vehiculo (vehi_id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ───────────────────────────── Parámetros (regla 2) ─────────────────────────────
INSERT INTO public.t_parametro_politica
  (para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en)
VALUES
  ('COMPARTIR_VENTANA_MIN', '30', 'ENTERO', 'Transporte. Diferencia máxima de hora de inicio para que dos operativos compartan carro (misma zona o sector, mismo tipo de tramo, ninguno macrooperativo).', 'minutos', '0', '180', NULL, now()),
  ('GUARDA_HORA_TARDE', '20:00', 'TEXTO', 'Transporte. Si el último tramo del vehículo termina a partir de esta hora, la guarda sugerida es el garaje más cercano al domicilio del conductor (o su domicilio, si tiene acta vigente).', NULL, NULL, NULL, NULL, now()),
  ('DURACION_TAREA_TALLER_MIN', '60', 'ENTERO', 'Transporte. Duración de la TAREA «Llevar a taller» que genera una cita de mantenimiento.', 'minutos', '10', '480', NULL, now())
ON CONFLICT (para_clave) DO NOTHING;

COMMIT;
