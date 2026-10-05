-- PLANTILLA POR DIRECTOR (2026-10-05).
--
-- Hasta hoy la plantilla de la orden de servicio era UNA sola fila global (`clave='orden-servicio'`).
-- Desde aquí cada Director tiene SU plantilla (apartados + datos generales), versionada, y cada orden
-- recuerda con qué plantilla y versión se generó, para resolverse siempre con ella aunque después el
-- Director edite su plantilla (las Vigentes no cambian). Hay además UNA plantilla BASE institucional
-- (solo apartados, sin datos personales) de la que nace la plantilla de un Director nuevo.
--
-- Aditiva e idempotente: solo añade columnas, una tabla de historial e índices, y rellena lo que esté
-- en NULL. No modifica firmantes ni números de las órdenes existentes.
BEGIN;

-- ── t_plantilla_orden: dueño, versión y marca de base ──
ALTER TABLE t_plantilla_orden
  ADD COLUMN IF NOT EXISTS plor_director_id INTEGER,
  ADD COLUMN IF NOT EXISTS plor_version     INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS plor_es_base     BOOLEAN NOT NULL DEFAULT FALSE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_plantilla_director') THEN
    ALTER TABLE t_plantilla_orden
      ADD CONSTRAINT fk_plantilla_director FOREIGN KEY (plor_director_id)
      REFERENCES t_usuario (usua_id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Una plantilla por Director; una sola base.
CREATE UNIQUE INDEX IF NOT EXISTS uq_plantilla_director
  ON t_plantilla_orden (plor_director_id) WHERE plor_director_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_plantilla_base
  ON t_plantilla_orden (plor_es_base) WHERE plor_es_base;

-- ── Historial INMUTABLE de versiones ──
CREATE TABLE IF NOT EXISTS t_plantilla_orden_version (
  plov_id               SERIAL PRIMARY KEY,
  plor_id               INTEGER     NOT NULL,
  plov_version          INTEGER     NOT NULL,
  plov_apartados        JSONB       NOT NULL,
  plov_datos_generales  JSONB,
  plov_creado_por       INTEGER,
  plov_creado_en        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_plantilla_version_plantilla FOREIGN KEY (plor_id)
    REFERENCES t_plantilla_orden (plor_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plantilla_version
  ON t_plantilla_orden_version (plor_id, plov_version);

-- ── t_orden_servicio: quién la generó y con qué plantilla/versión ──
ALTER TABLE t_orden_servicio
  ADD COLUMN IF NOT EXISTS oser_director_id       INTEGER,
  ADD COLUMN IF NOT EXISTS oser_plantilla_id      INTEGER,
  ADD COLUMN IF NOT EXISTS oser_plantilla_version INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_orden_director') THEN
    ALTER TABLE t_orden_servicio
      ADD CONSTRAINT fk_orden_director FOREIGN KEY (oser_director_id)
      REFERENCES t_usuario (usua_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_orden_plantilla') THEN
    ALTER TABLE t_orden_servicio
      ADD CONSTRAINT fk_orden_plantilla FOREIGN KEY (oser_plantilla_id)
      REFERENCES t_plantilla_orden (plor_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orden_director  ON t_orden_servicio (oser_director_id);
CREATE INDEX IF NOT EXISTS idx_orden_plantilla ON t_orden_servicio (oser_plantilla_id);

-- ── El número AMC-OS es único entre las órdenes VIGENTES ──
-- La reemisión CONSERVA el número (G27): la nueva versión lo lleva y la anterior, ya reemplazada, lo
-- guarda como histórico. Con un índice único TOTAL esa reemisión chocaba consigo misma; se acota a
-- las vigentes, que es donde la unicidad tiene sentido.
DROP INDEX IF EXISTS uq_orden_numero;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orden_numero_vigente
  ON t_orden_servicio (oser_numero_anio, oser_numero_secuencial)
  WHERE oser_vigente AND oser_numero_secuencial IS NOT NULL;

-- ── Backfill ──
-- 1) La plantilla global pasa a ser la del Director 14 (decisión del usuario, 2026-10-05).
UPDATE t_plantilla_orden
   SET plor_director_id = 14,
       plor_clave       = 'director-14',
       plor_version     = 1
 WHERE plor_clave = 'orden-servicio'
   AND plor_director_id IS NULL
   AND EXISTS (SELECT 1 FROM t_usuario WHERE usua_id = 14);

-- 2) La BASE institucional: los mismos apartados, sin datos personales.
INSERT INTO t_plantilla_orden (plor_clave, plor_apartados, plor_datos_generales, plor_es_base, plor_version, plor_actualizado_en)
SELECT 'base', p.plor_apartados, NULL, TRUE, 1, CURRENT_TIMESTAMP
  FROM t_plantilla_orden p
 WHERE p.plor_director_id = 14
   AND NOT EXISTS (SELECT 1 FROM t_plantilla_orden b WHERE b.plor_es_base);

-- 3) Versión 1 de cada plantilla en el historial.
INSERT INTO t_plantilla_orden_version (plor_id, plov_version, plov_apartados, plov_datos_generales, plov_creado_por)
SELECT p.plor_id, p.plor_version, p.plor_apartados, p.plor_datos_generales, p.plor_actualizado_por
  FROM t_plantilla_orden p
 WHERE NOT EXISTS (
   SELECT 1 FROM t_plantilla_orden_version v
    WHERE v.plor_id = p.plor_id AND v.plov_version = p.plor_version
 );

-- 4) Órdenes existentes: su director es quien las emitió; su plantilla, la del Director 14 v1.
UPDATE t_orden_servicio
   SET oser_director_id = oser_emitida_por
 WHERE oser_director_id IS NULL
   AND EXISTS (SELECT 1 FROM t_usuario u WHERE u.usua_id = t_orden_servicio.oser_emitida_por);

UPDATE t_orden_servicio
   SET oser_plantilla_id      = (SELECT plor_id FROM t_plantilla_orden WHERE plor_director_id = 14),
       oser_plantilla_version = 1
 WHERE oser_plantilla_id IS NULL
   AND EXISTS (SELECT 1 FROM t_plantilla_orden WHERE plor_director_id = 14);

COMMIT;
