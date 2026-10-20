-- Trámite de Inspección por persona asignada · 2026-10-07
--
-- Al registrar un operativo, el operador elige, para cada inspector del personal asignado, uno de
-- los trámites que el sistema de Inspección le tiene asignados en la fecha de la jornada. El
-- trámite se COPIA aquí en el momento de elegirlo: la orden de servicio lo lee de esta tabla y no
-- cambia si después Inspección lo modifica.
--
-- Uno por asignación (`uq_tramite_inspeccion_asignacion`): un inspector lleva un solo trámite en
-- cada operativo. ON DELETE CASCADE: quitar a la persona del operativo borra su trámite.
-- Aditiva e idempotente.

BEGIN;

CREATE TABLE IF NOT EXISTS public.t_operativo_tramite_inspeccion (
  otin_id             SERIAL PRIMARY KEY,
  aper_id             INTEGER NOT NULL,
  otin_codigo_tramite VARCHAR(60) NOT NULL,
  otin_nro_sitra      VARCHAR(80) NULL,
  otin_predio         VARCHAR(40) NULL,
  otin_zonal          VARCHAR(80) NULL,
  otin_materia        VARCHAR(160) NULL,
  otin_tipo_tramite   VARCHAR(60) NULL,
  otin_estado         VARCHAR(40) NULL,
  otin_tomado_por     INTEGER NOT NULL,
  otin_tomado_en      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_tramite_inspeccion_codigo CHECK (btrim(otin_codigo_tramite) <> '')
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tramite_inspeccion_asignacion') THEN
    ALTER TABLE public.t_operativo_tramite_inspeccion
      ADD CONSTRAINT fk_tramite_inspeccion_asignacion FOREIGN KEY (aper_id)
      REFERENCES public.t_asignacion_personal (aper_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tramite_inspeccion_asignacion
  ON public.t_operativo_tramite_inspeccion (aper_id);

COMMIT;
