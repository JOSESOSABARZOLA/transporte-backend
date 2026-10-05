-- Señal de EQUIDAD de reparto (cuota justa), separada de la de fatiga, 2026-09-29.
--
-- El sistema pasa a DOS señales advisory distintas sobre el personal:
--   1) FATIGA (seguridad, FRMS / ISO 45001): usa FATIGA_UMBRAL_* (umbrales ABSOLUTOS). ¿La persona
--      está cerca de un límite de fatiga? No depende del grupo.
--   2) EQUIDAD (reparto): compara la carga de cada persona con la CUOTA JUSTA del grupo (la media)
--      y la sitúa DEBAJO / EQUILIBRADO / ENCIMA. ¿Carga más o menos que su parte?
--
-- `EQUIDAD_MARGEN` es la banda (fracción) alrededor de la cuota dentro de la cual se considera
-- equilibrado; 0.25 = ±25 %. Se edita en «Ventanas y parámetros» (regla 2: sin constantes en el
-- código). DECIMAL con rango [0, 1], que ck_parametro_rango verifica. Se omite para_id (lo asigna la
-- secuencia). ON CONFLICT DO NOTHING hace la migración idempotente por la clave única.
INSERT INTO public.t_parametro_politica
  (para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en)
VALUES
  ('EQUIDAD_MARGEN', '0.25', 'DECIMAL', 'Equidad de carga. Banda (fracción) alrededor de la cuota justa del grupo dentro de la cual la carga se considera equilibrada; fuera de ella la persona queda por debajo o por encima de su parte. Ej.: 0.25 = ±25%.', 'fracción', '0', '1', NULL, now())
ON CONFLICT DO NOTHING;
