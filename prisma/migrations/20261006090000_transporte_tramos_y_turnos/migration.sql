-- Transporte DAF · Fases 1 y 2 (2026-10-06): tramos, traslados, turnos de conductores, activación de
-- libres, garajes autorizados y ubicación del vehículo por día.
--
-- Fuente: reunión con Planificación de Transporte (DAF), Excel «HORARIO AGOSTO» y el Reglamento de
-- Control de Vehículos del Sector Público (Acuerdo 042-CG-2016, reforma 028-CG-2024).
--
-- ADITIVA E IDEMPOTENTE: solo agrega tipos, columnas, tablas, índices y datos de catálogo; nada se
-- borra ni se reescribe. Se puede aplicar dos veces sin efecto.
--
-- REGLA 2: todo umbral nuevo es un parámetro de t_parametro_politica (ON CONFLICT DO NOTHING). Los
-- valores son los acordados con el usuario el 2026-10-06 (traslados 15/30/60, tramo PMO 30, jornada
-- 14 h, aviso 12 h, descanso 9 h, nombramiento de conductores hasta 16:30). Las ventanas de turno de
-- conductor y los costos del optimizador son SUPUESTOS editables en «Ventanas y parámetros».

BEGIN;

-- ───────────────────────────── Tipos ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'e_tipo_transporte') THEN
    CREATE TYPE public.e_tipo_transporte AS ENUM ('COMPLETO', 'SOLO_INICIO', 'SOLO_FIN', 'INICIO_Y_FIN', 'PROPIOS_MEDIOS');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'e_tipo_tramo') THEN
    CREATE TYPE public.e_tipo_tramo AS ENUM ('DEJAR', 'RETIRAR', 'COMPLETO', 'TAREA');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'e_turno_conductor') THEN
    CREATE TYPE public.e_turno_conductor AS ENUM ('DIA', 'NOCHE', 'ECU_NOCHE', 'LIBRE', 'ADMINISTRATIVO');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'e_tipo_ubicacion_vehiculo') THEN
    CREATE TYPE public.e_tipo_ubicacion_vehiculo AS ENUM ('GARAJE', 'DOMICILIO', 'TALLER');
  END IF;
END $$;

-- ───────────────────────────── Columnas nuevas ─────────────────────────────
-- Operativo: cómo pide transporte quien registra, y si es macrooperativo (no comparte carro).
ALTER TABLE public.t_operativo
  ADD COLUMN IF NOT EXISTS oper_tipo_transporte public.e_tipo_transporte NOT NULL DEFAULT 'COMPLETO',
  ADD COLUMN IF NOT EXISTS oper_es_macrooperativo BOOLEAN NOT NULL DEFAULT false;

-- Conductor: acta del parqueadero autorizado (Art. 8). La obligatoriedad la valida el servicio.
ALTER TABLE public.t_conductor
  ADD COLUMN IF NOT EXISTS cond_acta_parqueadero_numero VARCHAR(60),
  ADD COLUMN IF NOT EXISTS cond_acta_parqueadero_desde DATE,
  ADD COLUMN IF NOT EXISTS cond_acta_parqueadero_hasta DATE;

-- Vehículo: datos de circulación.
ALTER TABLE public.t_vehiculo
  ADD COLUMN IF NOT EXISTS vehi_tipo VARCHAR(40),
  ADD COLUMN IF NOT EXISTS vehi_asientos SMALLINT,
  ADD COLUMN IF NOT EXISTS vehi_kilometraje INTEGER,
  ADD COLUMN IF NOT EXISTS vehi_matricula_vencimiento DATE,
  ADD COLUMN IF NOT EXISTS vehi_soat_vencimiento DATE;

-- Zonal: sector de la ciudad (traslado por defecto «mismo sector»).
ALTER TABLE public.t_zonal
  ADD COLUMN IF NOT EXISTS zona_sector public.e_sector_ciudad;

-- Ubicación de la flota: garaje autorizado y su zonal.
ALTER TABLE public.t_ubicacion_flota
  ADD COLUMN IF NOT EXISTS ubic_garaje_autorizado BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS zona_id INTEGER;

-- Destino del vehículo (guarda final): tipo GARAJE | DOMICILIO | TALLER.
ALTER TABLE public.t_destino_vehiculo
  ADD COLUMN IF NOT EXISTS dest_tipo public.e_tipo_ubicacion_vehiculo;

-- ───────────────────────────── Tablas nuevas ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.t_tramo_transporte (
  trtr_id                SERIAL PRIMARY KEY,
  oper_id                INTEGER,
  cond_id                INTEGER,
  vehi_id                INTEGER,
  trtr_fecha             DATE NOT NULL,
  trtr_tipo              public.e_tipo_tramo NOT NULL,
  trtr_hora_inicio       VARCHAR(5) NOT NULL,
  trtr_hora_fin          VARCHAR(5) NOT NULL,
  trtr_cruza_medianoche  BOOLEAN NOT NULL DEFAULT false,
  trtr_zonal_origen_id   INTEGER,
  trtr_zonal_destino_id  INTEGER,
  trtr_compartido_con_id INTEGER,
  trtr_descripcion       VARCHAR(200),
  trtr_creado_por        INTEGER NOT NULL,
  trtr_creado_en         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Una TAREA puede no tener operativo; un tramo de operativo siempre lo tiene.
  CONSTRAINT ck_tramo_operativo CHECK (trtr_tipo = 'TAREA' OR oper_id IS NOT NULL),
  CONSTRAINT ck_tramo_horas CHECK (trtr_hora_inicio ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND trtr_hora_fin ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

CREATE TABLE IF NOT EXISTS public.t_traslado_zonal (
  trzo_id               SERIAL PRIMARY KEY,
  trzo_zonal_origen_id  INTEGER NOT NULL,
  trzo_zonal_destino_id INTEGER NOT NULL,
  trzo_minutos          SMALLINT NOT NULL,
  CONSTRAINT ck_traslado_minutos CHECK (trzo_minutos >= 0 AND trzo_minutos <= 600)
);

CREATE TABLE IF NOT EXISTS public.t_turno_conductor (
  tuco_id             SERIAL PRIMARY KEY,
  cond_id             INTEGER NOT NULL,
  tuco_fecha          DATE NOT NULL,
  tuco_turno          public.e_turno_conductor NOT NULL,
  tuco_registrado_por INTEGER,
  tuco_creado_en      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tuco_actualizado_en TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.t_turno_conductor_mes (
  tcme_id             SERIAL PRIMARY KEY,
  tcme_mes            VARCHAR(7) NOT NULL,
  tcme_estado         public.e_estado_cobertura_mes NOT NULL DEFAULT 'BORRADOR',
  tcme_publicado_por  INTEGER,
  tcme_publicado_en   TIMESTAMPTZ(3),
  tcme_actualizado_en TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_turno_conductor_mes_formato CHECK (tcme_mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

CREATE TABLE IF NOT EXISTS public.t_activacion_conductor (
  acco_id           SERIAL PRIMARY KEY,
  cond_id           INTEGER NOT NULL,
  acco_fecha        DATE NOT NULL,
  acco_motivo       VARCHAR(220) NOT NULL,
  acco_activado_por INTEGER NOT NULL,
  acco_creado_en    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ───────────────────────────── Índices ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tramo_conductor_fecha ON public.t_tramo_transporte (cond_id, trtr_fecha);
CREATE INDEX IF NOT EXISTS idx_tramo_operativo ON public.t_tramo_transporte (oper_id);
CREATE INDEX IF NOT EXISTS idx_tramo_fecha ON public.t_tramo_transporte (trtr_fecha);
CREATE UNIQUE INDEX IF NOT EXISTS uq_traslado_par ON public.t_traslado_zonal (trzo_zonal_origen_id, trzo_zonal_destino_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_turno_conductor_fecha ON public.t_turno_conductor (cond_id, tuco_fecha);
CREATE INDEX IF NOT EXISTS idx_turno_conductor_fecha ON public.t_turno_conductor (tuco_fecha);
CREATE UNIQUE INDEX IF NOT EXISTS uq_turno_conductor_mes ON public.t_turno_conductor_mes (tcme_mes);
CREATE UNIQUE INDEX IF NOT EXISTS uq_activacion_conductor_fecha ON public.t_activacion_conductor (cond_id, acco_fecha);

-- ───────────────────────────── Claves foráneas ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ubicacion_zonal') THEN
    ALTER TABLE public.t_ubicacion_flota ADD CONSTRAINT fk_ubicacion_zonal
      FOREIGN KEY (zona_id) REFERENCES public.t_zonal (zona_id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tramo_operativo') THEN
    ALTER TABLE public.t_tramo_transporte ADD CONSTRAINT fk_tramo_operativo
      FOREIGN KEY (oper_id) REFERENCES public.t_operativo (oper_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tramo_conductor') THEN
    ALTER TABLE public.t_tramo_transporte ADD CONSTRAINT fk_tramo_conductor
      FOREIGN KEY (cond_id) REFERENCES public.t_conductor (cond_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tramo_vehiculo') THEN
    ALTER TABLE public.t_tramo_transporte ADD CONSTRAINT fk_tramo_vehiculo
      FOREIGN KEY (vehi_id) REFERENCES public.t_vehiculo (vehi_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tramo_zonal_origen') THEN
    ALTER TABLE public.t_tramo_transporte ADD CONSTRAINT fk_tramo_zonal_origen
      FOREIGN KEY (trtr_zonal_origen_id) REFERENCES public.t_zonal (zona_id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tramo_zonal_destino') THEN
    ALTER TABLE public.t_tramo_transporte ADD CONSTRAINT fk_tramo_zonal_destino
      FOREIGN KEY (trtr_zonal_destino_id) REFERENCES public.t_zonal (zona_id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tramo_compartido') THEN
    ALTER TABLE public.t_tramo_transporte ADD CONSTRAINT fk_tramo_compartido
      FOREIGN KEY (trtr_compartido_con_id) REFERENCES public.t_tramo_transporte (trtr_id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_traslado_origen') THEN
    ALTER TABLE public.t_traslado_zonal ADD CONSTRAINT fk_traslado_origen
      FOREIGN KEY (trzo_zonal_origen_id) REFERENCES public.t_zonal (zona_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_traslado_destino') THEN
    ALTER TABLE public.t_traslado_zonal ADD CONSTRAINT fk_traslado_destino
      FOREIGN KEY (trzo_zonal_destino_id) REFERENCES public.t_zonal (zona_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_turno_conductor') THEN
    ALTER TABLE public.t_turno_conductor ADD CONSTRAINT fk_turno_conductor
      FOREIGN KEY (cond_id) REFERENCES public.t_conductor (cond_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_activacion_conductor') THEN
    ALTER TABLE public.t_activacion_conductor ADD CONSTRAINT fk_activacion_conductor
      FOREIGN KEY (cond_id) REFERENCES public.t_conductor (cond_id) ON DELETE CASCADE;
  END IF;
END $$;

-- ───────────────────────────── Datos de catálogo ─────────────────────────────
-- Sector de las zonales administrativas (SUPUESTO editable: por la ubicación de cada zonal en Quito).
UPDATE public.t_zonal SET zona_sector = 'NORTE'  WHERE zona_sector IS NULL AND zona_codigo IN ('EUGENIO_ESPEJO', 'LA_DELICIA', 'CALDERON', 'CHOCO_ANDINO');
UPDATE public.t_zonal SET zona_sector = 'CENTRO' WHERE zona_sector IS NULL AND zona_codigo IN ('LA_MARISCAL', 'MANUELA_SAENZ');
UPDATE public.t_zonal SET zona_sector = 'SUR'    WHERE zona_sector IS NULL AND zona_codigo IN ('ELOY_ALFARO', 'QUITUMBE');
UPDATE public.t_zonal SET zona_sector = 'VALLE'  WHERE zona_sector IS NULL AND zona_codigo IN ('VALLE_DE_LOS_CHILLOS', 'TUMBACO');

-- Chocó Andino queda lejos de todo (~1h30, reunión DAF): traslado explícito en los dos sentidos.
INSERT INTO public.t_traslado_zonal (trzo_zonal_origen_id, trzo_zonal_destino_id, trzo_minutos)
SELECT c.zona_id, z.zona_id, 90
  FROM public.t_zonal c
  JOIN public.t_zonal z ON z.zona_id <> c.zona_id
 WHERE c.zona_codigo = 'CHOCO_ANDINO'
   AND z.zona_codigo IN ('EUGENIO_ESPEJO', 'LA_DELICIA', 'CALDERON', 'ELOY_ALFARO', 'QUITUMBE', 'LA_MARISCAL', 'MANUELA_SAENZ', 'VALLE_DE_LOS_CHILLOS', 'TUMBACO')
ON CONFLICT DO NOTHING;
INSERT INTO public.t_traslado_zonal (trzo_zonal_origen_id, trzo_zonal_destino_id, trzo_minutos)
SELECT z.zona_id, c.zona_id, 90
  FROM public.t_zonal c
  JOIN public.t_zonal z ON z.zona_id <> c.zona_id
 WHERE c.zona_codigo = 'CHOCO_ANDINO'
   AND z.zona_codigo IN ('EUGENIO_ESPEJO', 'LA_DELICIA', 'CALDERON', 'ELOY_ALFARO', 'QUITUMBE', 'LA_MARISCAL', 'MANUELA_SAENZ', 'VALLE_DE_LOS_CHILLOS', 'TUMBACO')
ON CONFLICT DO NOTHING;

-- Garajes autorizados (Reglamento, Art. 8). Si la ubicación ya existe, se marca como garaje.
-- La Matriz se asocia a la zonal La Mariscal (SUPUESTO editable).
INSERT INTO public.t_ubicacion_flota (ubic_nombre, ubic_activo, ubic_garaje_autorizado, zona_id)
VALUES
  ('Matriz',      true, true, (SELECT zona_id FROM public.t_zonal WHERE zona_codigo = 'LA_MARISCAL')),
  ('Eloy Alfaro', true, true, (SELECT zona_id FROM public.t_zonal WHERE zona_codigo = 'ELOY_ALFARO')),
  ('Calderón',    true, true, (SELECT zona_id FROM public.t_zonal WHERE zona_codigo = 'CALDERON')),
  ('Quitumbe',    true, true, (SELECT zona_id FROM public.t_zonal WHERE zona_codigo = 'QUITUMBE')),
  ('Los Chillos', true, true, (SELECT zona_id FROM public.t_zonal WHERE zona_codigo = 'VALLE_DE_LOS_CHILLOS'))
ON CONFLICT (ubic_nombre) DO UPDATE
  SET ubic_garaje_autorizado = true,
      zona_id = COALESCE(public.t_ubicacion_flota.zona_id, EXCLUDED.zona_id);

-- ───────────────────────────── Parámetros (regla 2) ─────────────────────────────
INSERT INTO public.t_parametro_politica
  (para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en)
VALUES
  ('HORA_NOMBRAMIENTO_CONDUCTOR_FIN', '16:30', 'TEXTO', 'Transporte. Fin de la jornada del CONDUCTOR de nombramiento (el personal usa HORA_NOMBRAMIENTO_FIN). Fuera de HORA_NOMBRAMIENTO_INICIO a esta hora no se le asigna.', NULL, NULL, NULL, NULL, now()),
  ('INICIO_JORNADA_TRANSPORTE', '05:00', 'TEXTO', 'Transporte. Hora en que empieza la línea de tiempo de la jornada (05H00 a 05H00): una hora anterior pertenece a la noche del mismo día.', NULL, NULL, NULL, NULL, now()),
  ('DURACION_TRAMO_PMO_MIN', '30', 'ENTERO', 'Transporte. Duración de un tramo de dejar o retirar personal (PMO que solo pide inicio, fin o ambos).', 'minutos', '5', '240', NULL, now()),
  ('MAX_JORNADA_HORAS', '14', 'ENTERO', 'Transporte. Jornada máxima de un conductor (primer inicio al último fin del día). Por encima, no se asigna.', 'horas', '1', '24', NULL, now()),
  ('JORNADA_AVISO_HORAS', '12', 'ENTERO', 'Transporte. Jornada de un conductor a partir de la cual se AVISA (no bloquea).', 'horas', '1', '24', NULL, now()),
  ('DESCANSO_MIN_HORAS', '9', 'ENTERO', 'Transporte. Descanso mínimo entre el último tramo de ayer y el primero de hoy. Por debajo, se AVISA.', 'horas', '0', '24', NULL, now()),
  ('TRASLADO_MISMA_ZONA_MIN', '15', 'ENTERO', 'Transporte. Minutos de traslado por defecto dentro de la misma zonal.', 'minutos', '0', '600', NULL, now()),
  ('TRASLADO_MISMO_SECTOR_MIN', '30', 'ENTERO', 'Transporte. Minutos de traslado por defecto entre zonales del mismo sector.', 'minutos', '0', '600', NULL, now()),
  ('TRASLADO_OTRO_SECTOR_MIN', '60', 'ENTERO', 'Transporte. Minutos de traslado por defecto entre zonales de sectores distintos.', 'minutos', '0', '600', NULL, now()),
  ('COSTO_PENALIZACION_AVISO', '30', 'ENTERO', 'Transporte. Penalización (en minutos equivalentes) por cada aviso al elegir un conductor. SUPUESTO editable.', 'minutos', '0', '1000', NULL, now()),
  ('COSTO_ACTIVAR_LIBRE', '120', 'ENTERO', 'Transporte. Penalización por activar a un conductor libre (horas extra). SUPUESTO editable.', 'minutos', '0', '1000', NULL, now()),
  ('COSTO_ARRANQUE_LEJOS', '20', 'ENTERO', 'Transporte. Penalización por arrancar lejos de donde amanece el vehículo. SUPUESTO editable.', 'minutos', '0', '1000', NULL, now()),
  ('HORA_TURNO_CONDUCTOR_DIA_INICIO', '06:00', 'TEXTO', 'Transporte. Inicio del turno DÍA del conductor. SUPUESTO editable.', NULL, NULL, NULL, NULL, now()),
  ('HORA_TURNO_CONDUCTOR_DIA_FIN', '18:00', 'TEXTO', 'Transporte. Fin del turno DÍA del conductor. SUPUESTO editable.', NULL, NULL, NULL, NULL, now()),
  ('HORA_TURNO_CONDUCTOR_NOCHE_INICIO', '18:00', 'TEXTO', 'Transporte. Inicio del turno NOCHE del conductor. SUPUESTO editable.', NULL, NULL, NULL, NULL, now()),
  ('HORA_TURNO_CONDUCTOR_NOCHE_FIN', '06:00', 'TEXTO', 'Transporte. Fin del turno NOCHE del conductor (día siguiente). SUPUESTO editable.', NULL, NULL, NULL, NULL, now()),
  ('HORA_TURNO_CONDUCTOR_ECU_NOCHE_INICIO', '20:00', 'TEXTO', 'Transporte. Inicio del turno ECU NOCHE del conductor. SUPUESTO editable.', NULL, NULL, NULL, NULL, now()),
  ('HORA_TURNO_CONDUCTOR_ECU_NOCHE_FIN', '05:00', 'TEXTO', 'Transporte. Fin del turno ECU NOCHE del conductor (día siguiente). SUPUESTO editable.', NULL, NULL, NULL, NULL, now())
ON CONFLICT DO NOTHING;

COMMIT;
