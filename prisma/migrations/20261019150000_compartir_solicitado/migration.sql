-- ═══════════════════════════════════════════════════════════════════════════════
-- QUIÉN PIDIÓ COMPARTIR UNIDAD, Y CUÁNDO · 2026-10-19 (plan «acciones-icono-notas», N2)
--
-- La tabla del registro (P-01) y de Mis operativos (P-02) pinta la solicitud de compartir unidad
-- como una TARJETA más entre las notas, con su autor y su hora. La intención
-- (oper_compartir_con_id, migración 20261019090000) no guardaba ninguna de las dos:
--
--   · oper_compartir_solicitado_por → el usuario que la pidió. Sin FK, igual que
--                                     oper_creado_por y oper_modificado_por.
--   · oper_compartir_solicitado_en  → cuándo la pidió.
--
-- Se llenan al fijar o cambiar la intención y se vacían al retirarla (servicio de operativos).
--
-- RELLENO DE LO EXISTENTE: a las intenciones ya guardadas sin fecha se les pone el creador y la
-- fecha de creación del operativo, que es la mejor aproximación disponible (la intención solo se
-- pedía al registrar o al editar el mismo día).
--
-- ADITIVA E IDEMPOTENTE: columnas nulas con IF NOT EXISTS; el relleno solo toca filas con la
-- intención y sin fecha, así que repetirla no cambia nada.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE t_operativo ADD COLUMN IF NOT EXISTS oper_compartir_solicitado_por INTEGER NULL;
ALTER TABLE t_operativo ADD COLUMN IF NOT EXISTS oper_compartir_solicitado_en TIMESTAMPTZ(3) NULL;

UPDATE t_operativo
   SET oper_compartir_solicitado_por = oper_creado_por,
       oper_compartir_solicitado_en  = oper_creado_en
 WHERE oper_compartir_con_id IS NOT NULL
   AND oper_compartir_solicitado_en IS NULL;
