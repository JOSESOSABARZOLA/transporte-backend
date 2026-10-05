-- ACUMULACIÓN DE CARGA POR PERÍODO en el índice de fatiga (equidad), 2026-09-25.
--
-- Hasta ahora el semáforo se calculaba solo por DÍA (las horas de ese día), así que la carga de
-- la semana no se reflejaba en los demás días. Se activa `PERIODO_EQUIDAD` (que estaba sembrado sin
-- uso): el índice suma las horas que la persona YA tiene asignadas en el período de equidad, en
-- días DISTINTOS al que se registra, para que la carga de la semana pese en todos sus días.
--
-- `PERIODO_EQUIDAD` pasa a SEMANAL (a pedido del negocio). `PESO_CARGA_PERIODO` pondera esas horas
-- acumuladas: 1 = cuentan igual que las horas del día. Es DECIMAL con rango [0,100] (ck_parametro_rango).
UPDATE public.t_parametro_politica
   SET para_valor = 'SEMANAL', para_modificado_en = now()
 WHERE para_clave = 'PERIODO_EQUIDAD';

INSERT INTO public.t_parametro_politica
  (para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en)
VALUES
  ('PESO_CARGA_PERIODO', '1', 'DECIMAL', 'Índice de carga (equidad). Peso de cada hora que la persona ya tiene asignada en el período de equidad (PERIODO_EQUIDAD), en días distintos al que se registra, para reflejar la carga acumulada de la semana/mes.', 'puntos/hora', '0', '100', NULL, now())
ON CONFLICT DO NOTHING;
