-- ═══════════════════════════════════════════════════════════════════════════════
-- COMPARTIR UNIDAD ENTRE OPERATIVOS · 2026-10-19 (plan «compartir unidad»)
--
-- Quien registra un operativo puede pedir que viaje en la MISMA unidad que otro operativo de su
-- ámbito con mismo día, punto y horario, o justificar por qué necesita vehículo exclusivo. Es una
-- INTENCIÓN: la DAF la ejecuta (RN-40). Esta migración guarda solo esa intención.
--
--   · oper_compartir_con_id        → el operativo anfitrión con el que pide viajar. ON DELETE SET
--                                    NULL: si el anfitrión desaparece, la intención se pierde, no
--                                    el operativo.
--   · oper_justificacion_exclusivo → por qué pide vehículo exclusivo (opción C del registro).
--
-- ADITIVA E IDEMPOTENTE: columnas nulas, sin tocar datos; cada objeto con IF NOT EXISTS o un
-- bloque que comprueba su existencia. Repetirla no cambia nada.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE t_operativo ADD COLUMN IF NOT EXISTS oper_compartir_con_id INTEGER NULL;
ALTER TABLE t_operativo ADD COLUMN IF NOT EXISTS oper_justificacion_exclusivo VARCHAR(300) NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_operativo_compartir_con') THEN
    ALTER TABLE t_operativo
      ADD CONSTRAINT fk_operativo_compartir_con
      FOREIGN KEY (oper_compartir_con_id) REFERENCES t_operativo (oper_id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- Un operativo no comparte unidad consigo mismo.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_operativo_compartir_no_propio') THEN
    ALTER TABLE t_operativo
      ADD CONSTRAINT ck_operativo_compartir_no_propio
      CHECK (oper_compartir_con_id IS NULL OR oper_compartir_con_id <> oper_id);
  END IF;

  -- Compartir y vehículo exclusivo se excluyen: el macrooperativo no comparte carro.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_operativo_compartir_o_exclusivo') THEN
    ALTER TABLE t_operativo
      ADD CONSTRAINT ck_operativo_compartir_o_exclusivo
      CHECK (NOT (oper_compartir_con_id IS NOT NULL AND oper_es_macrooperativo));
  END IF;
END $$;

-- Quiénes piden viajar con un operativo (la DAF lo consulta; SET NULL lo recorre al borrar).
CREATE INDEX IF NOT EXISTS idx_operativo_compartir_con
  ON t_operativo (oper_compartir_con_id)
  WHERE oper_compartir_con_id IS NOT NULL;

-- Coincidencias del registro: mismo cuadro y mismo punto de encuentro.
CREATE INDEX IF NOT EXISTS idx_operativo_cuadro_punto
  ON t_operativo (cuad_id, pcto_id);
