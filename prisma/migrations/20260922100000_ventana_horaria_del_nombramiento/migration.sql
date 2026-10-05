-- Jornada del personal de NOMBRAMIENTO (RN-26). Regla de negocio del 2026-09-22: el personal de
-- nombramiento trabaja SOLO de lunes a viernes de 08:00 a 16:00, y fuera de esa ventana no se le
-- asigna (ni de noche, ni en fin de semana, ni en horas extra). Antes se permitian las horas extra
-- en dia laborable; el negocio pidio endurecerlo. Los limites viven como PARAMETRO de politica
-- (regla 2 de CLAUDE.md), editables por el administrador general en «Ventanas y parametros», no
-- por el ADMINISTRADOR_DMIT (esos son los parametros de turno de la cobertura de Instruccion).
--
-- Tipo TEXTO (hora HH:MM); sin rango numerico (para_minimo/para_maximo = NULL, exentos de
-- ck_parametro_rango). ON CONFLICT DO NOTHING hace la migracion idempotente por su clave unica.
INSERT INTO public.t_parametro_politica
  (para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en)
VALUES
  ('HORA_NOMBRAMIENTO_INICIO', '08:00', 'TEXTO', 'Jornada del personal de nombramiento (RN-26). Inicio de la ventana de lunes a viernes; fuera de ella no se asigna al nombramiento.', NULL, NULL, NULL, NULL, now()),
  ('HORA_NOMBRAMIENTO_FIN', '16:00', 'TEXTO', 'Jornada del personal de nombramiento (RN-26). Fin de la ventana de lunes a viernes.', NULL, NULL, NULL, NULL, now())
ON CONFLICT DO NOTHING;
