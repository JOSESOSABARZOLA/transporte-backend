-- Datos generales del Director en la plantilla de la orden de servicio (2026-10-02).
-- La plantilla (única, global) suma un bloque de DATOS GENERALES —dirección responsable, número y
-- fecha del memorando de designación, y funcionario designado— que resuelven los tokens del cuerpo.
-- Aditivo e idempotente: no toca los apartados ya guardados ni ninguna otra columna.
ALTER TABLE t_plantilla_orden
  ADD COLUMN IF NOT EXISTS plor_datos_generales JSONB;
