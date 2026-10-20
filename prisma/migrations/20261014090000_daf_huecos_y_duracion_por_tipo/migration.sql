-- ═══════════════════════════════════════════════════════════════════════════════
-- Transporte DAF · horas libres y duración del tramo por tipo (2026-10-14)
--
-- Solo PARÁMETROS (t_parametro_politica). Aditiva e idempotente: ON CONFLICT DO NOTHING sobre la
-- clave única. No cambia ninguna tabla (siguen 53).
--
--   · DAF_HUECO_MINIMO_MIN = 60 (provisional, decisión D6): desde cuántos minutos útiles un hueco
--     del conductor se muestra como aprovechable en «Planificar el día».
--   · DAF_DURACION_DEJAR_MIN y DAF_DURACION_RETIRAR_MIN (decisión D7): una duración por tipo de
--     tramo. Nacen con el MISMO valor que DAF_DURACION_TRAMO_MIN tenga hoy en la base (30 en la
--     semilla), así que el comportamiento no cambia hasta que la DAF las ajuste.
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.t_parametro_politica
  (para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en)
VALUES
  ('DAF_HUECO_MINIMO_MIN', '60', 'ENTERO', 'Transporte DAF. Minutos útiles mínimos para mostrar un hueco libre de un conductor como aprovechable (descontado el traslado mínimo de ida y vuelta).', 'minutos', '15', '600', NULL, now())
ON CONFLICT DO NOTHING;

INSERT INTO public.t_parametro_politica
  (para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en)
SELECT n.clave,
       COALESCE((SELECT p.para_valor FROM public.t_parametro_politica p WHERE p.para_clave = 'DAF_DURACION_TRAMO_MIN'), '30'),
       'ENTERO', n.descripcion, 'minutos', '5', '240', NULL, now()
  FROM (VALUES
    ('DAF_DURACION_DEJAR_MIN',   'Transporte DAF. Duración del tramo de DEJAR al personal (solo dejar, o dejar y retirar). Si no está configurado se usa DAF_DURACION_TRAMO_MIN.'),
    ('DAF_DURACION_RETIRAR_MIN', 'Transporte DAF. Duración del tramo de RETIRAR al personal (solo retirar, o dejar y retirar). Si no está configurado se usa DAF_DURACION_TRAMO_MIN.')
  ) AS n(clave, descripcion)
ON CONFLICT DO NOTHING;
