-- Transporte DAF · «Planificar el día» como flujo guiado en 4 pasos (2026-10-08).
--
--   · t_vehiculo_jornada: QUÉ vehículos salen ese día (paso 1). El conteo sigue en
--     t_capacidad_flota (RN-46); aquí se guarda la lista para corregirla vehículo a vehículo.
--   · t_hoja_ruta_emision: cuándo se emitió la hoja de ruta de cada conductor y con qué huella de
--     tramos (paso 4). Si los tramos cambian después, la hoja vuelve a «pendiente».
--   · t_destino_vehiculo.dest_acta_numero: el número de acta con que la DAF deja un vehículo en el
--     domicilio del conductor (paso 3, Art. 8). Se valida contra el acta vigente del conductor.
--
-- ADITIVA E IDEMPOTENTE: solo crea tablas, una columna, índices y llaves. Nada se borra ni se
-- reescribe; aplicarla dos veces no tiene efecto. No siembra datos ni permisos (se reutilizan
-- `transporte:asignar`, `flota:capacidad:declarar` y `transporte:destino:fijar`).

BEGIN;

ALTER TABLE public.t_destino_vehiculo
  ADD COLUMN IF NOT EXISTS dest_acta_numero VARCHAR(60);

CREATE TABLE IF NOT EXISTS public.t_vehiculo_jornada (
  vejo_id             SERIAL PRIMARY KEY,
  vejo_fecha          DATE        NOT NULL,
  vehi_id             INTEGER     NOT NULL,
  vejo_sale           BOOLEAN     NOT NULL,
  vejo_registrado_por INTEGER     NOT NULL,
  vejo_registrado_en  TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehiculo_jornada
  ON public.t_vehiculo_jornada (vejo_fecha, vehi_id);
CREATE INDEX IF NOT EXISTS idx_vehiculo_jornada_fecha
  ON public.t_vehiculo_jornada (vejo_fecha);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vehiculo_jornada_vehiculo') THEN
    ALTER TABLE public.t_vehiculo_jornada
      ADD CONSTRAINT fk_vehiculo_jornada_vehiculo FOREIGN KEY (vehi_id)
      REFERENCES public.t_vehiculo (vehi_id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.t_hoja_ruta_emision (
  hore_id          SERIAL PRIMARY KEY,
  hore_fecha       DATE        NOT NULL,
  cond_id          INTEGER     NOT NULL,
  hore_huella      VARCHAR(64) NOT NULL,
  hore_emitida_por INTEGER     NOT NULL,
  hore_emitida_en  TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hoja_ruta_fecha_conductor
  ON public.t_hoja_ruta_emision (hore_fecha, cond_id);
CREATE INDEX IF NOT EXISTS idx_hoja_ruta_fecha
  ON public.t_hoja_ruta_emision (hore_fecha);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_hoja_ruta_conductor') THEN
    ALTER TABLE public.t_hoja_ruta_emision
      ADD CONSTRAINT fk_hoja_ruta_conductor FOREIGN KEY (cond_id)
      REFERENCES public.t_conductor (cond_id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
