-- Parámetros del MOTOR DE EQUIDAD DE CARGA e ÍNDICE DE FATIGA (FRMS / ISO 45001), 2026-09-24.
--
-- El índice de carga por persona y el semáforo de fatiga (VERDE/AMBAR/ROJO) NO usan constantes: sus
-- umbrales y pesos viven como PARÁMETRO de política (regla 2 de CLAUDE.md), editables por el
-- administrador en «Ventanas y parámetros», de modo que el negocio los calibra sin recompilar.
-- La sugerencia que producen es ADVISORY: no bloquea la asignación, solo la ordena y la señala.
--
-- Sin tablas nuevas: el índice se DERIVA de los antecedentes que `ElegibilidadService` ya reúne por
-- lote (horas del día, salidas pesadas del período, patrulla reciente). Aquí solo se dan de alta los
-- valores configurables.
--
-- `PERIODO_EQUIDAD` es TEXTO (sin rango numérico: para_minimo/para_maximo = NULL, exentos de
-- ck_parametro_rango). Los umbrales y pesos son DECIMAL con rango [0, 100], que ck_parametro_rango
-- verifica. Se omite para_id: lo asigna la secuencia. ON CONFLICT DO NOTHING hace la migración
-- idempotente por la clave única.
INSERT INTO public.t_parametro_politica
  (para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en)
VALUES
  ('PERIODO_EQUIDAD', 'MENSUAL', 'TEXTO', 'Equidad de carga. Período de calendario sobre el que se reparte la carga entre el personal. Valores: SEMANAL, QUINCENAL, MENSUAL.', NULL, NULL, NULL, NULL, now()),
  ('FATIGA_UMBRAL_AMBAR', '6', 'DECIMAL', 'Índice de fatiga (FRMS). A partir de este valor del índice, el semáforo pasa de VERDE a ÁMBAR (aviso, no bloquea).', 'puntos', '0', '100', NULL, now()),
  ('FATIGA_UMBRAL_ROJO', '10', 'DECIMAL', 'Índice de fatiga (FRMS). A partir de este valor del índice, el semáforo pasa a ROJO (carga alta; sigue asignable, el operador decide).', 'puntos', '0', '100', NULL, now()),
  ('PESO_HORAS_DIA', '1', 'DECIMAL', 'Índice de carga. Peso de cada hora ya asignada a la persona en el día al calcular el índice.', 'puntos/hora', '0', '100', NULL, now()),
  ('PESO_SALIDAS_PESADAS', '2', 'DECIMAL', 'Índice de carga. Peso de cada salida pesada (nocturna o de fin de semana) acumulada en el período de equidad.', 'puntos/salida', '0', '100', NULL, now()),
  ('PESO_PATRULLA_RECIENTE', '3', 'DECIMAL', 'Índice de carga. Peso que suma haber salido en patrulla recientemente (RN-24), como factor de fatiga acumulada.', 'puntos', '0', '100', NULL, now())
ON CONFLICT DO NOTHING;
