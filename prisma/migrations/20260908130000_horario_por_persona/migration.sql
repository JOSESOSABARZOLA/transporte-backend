-- Horario POR PERSONA dentro de un operativo (2026-09-08). Override OPCIONAL: la asignacion
-- gana una ventana propia; si es NULL la persona cumple el horario del operativo (el caso de
-- siempre). Sin migracion de datos: las asignaciones existentes quedan en NULL y no cambian.

ALTER TABLE "t_asignacion_personal" ADD COLUMN "aper_hora_inicio" VARCHAR(5);
ALTER TABLE "t_asignacion_personal" ADD COLUMN "aper_hora_fin" VARCHAR(5);

-- RN-07: horas en :00 o :30, o NULL. Mismo patron que ck_operativo_hora_*.
ALTER TABLE "t_asignacion_personal"
  ADD CONSTRAINT "ck_asignacion_hora_inicio"
  CHECK ("aper_hora_inicio" IS NULL OR "aper_hora_inicio" ~ '^([01][0-9]|2[0-3]):(00|30)$');
ALTER TABLE "t_asignacion_personal"
  ADD CONSTRAINT "ck_asignacion_hora_fin"
  CHECK ("aper_hora_fin" IS NULL OR "aper_hora_fin" ~ '^([01][0-9]|2[0-3]):(00|30)$');

-- Las dos van juntas: o ambas NULL (usa el horario del operativo) o ambas con valor.
ALTER TABLE "t_asignacion_personal"
  ADD CONSTRAINT "ck_asignacion_hora_par"
  CHECK (("aper_hora_inicio" IS NULL) = ("aper_hora_fin" IS NULL));

-- Un rango no empieza y termina a la misma hora (RangoHorario.de tambien lo rechaza).
ALTER TABLE "t_asignacion_personal"
  ADD CONSTRAINT "ck_asignacion_hora_distinta"
  CHECK ("aper_hora_inicio" IS NULL OR "aper_hora_inicio" <> "aper_hora_fin");
