-- Cobertura por turnos (Instrucción): ventanas horarias de los turnos DIURNO y NOCTURNO.
-- Son parámetros de política editables por el administrador en «Ventanas y parámetros».
-- Al asignar a alguien de Instrucción, el horario del operativo debe caer dentro de la
-- ventana del turno que la persona tenga ese día en la matriz de cobertura.
--
-- Tipo TEXTO (hora HH:MM); sin rango numérico (para_minimo/para_maximo = NULL, exentos de
-- ck_parametro_rango). Se omite para_id: lo asigna la secuencia. ON CONFLICT DO NOTHING
-- hace la migración idempotente por su clave única.
INSERT INTO public.t_parametro_politica
  (para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en)
VALUES
  ('HORA_TURNO_DIURNO_INICIO', '08:00', 'TEXTO', 'Cobertura por turnos (Instrucción). Inicio del turno diurno; el horario del operativo al asignar debe caer dentro de esta ventana.', NULL, NULL, NULL, NULL, now()),
  ('HORA_TURNO_DIURNO_FIN', '16:30', 'TEXTO', 'Cobertura por turnos (Instrucción). Fin del turno diurno.', NULL, NULL, NULL, NULL, now()),
  ('HORA_TURNO_NOCTURNO_INICIO', '17:30', 'TEXTO', 'Cobertura por turnos (Instrucción). Inicio del turno nocturno (puede cruzar la medianoche).', NULL, NULL, NULL, NULL, now()),
  ('HORA_TURNO_NOCTURNO_FIN', '02:00', 'TEXTO', 'Cobertura por turnos (Instrucción). Fin del turno nocturno.', NULL, NULL, NULL, NULL, now())
ON CONFLICT DO NOTHING;
