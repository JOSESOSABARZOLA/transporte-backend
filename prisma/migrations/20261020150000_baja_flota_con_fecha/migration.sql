-- ═══════════════════════════════════════════════════════════════════════════════
-- CUÁNDO Y QUIÉN DIO DE BAJA · 2026-10-20 (plan «flota-mantenimiento-baja», D1)
--
-- «De baja» sigue siendo `*_activo = false`: es lo que lee toda la planificación y un segundo
-- estado duplicaría la verdad. Lo que faltaba era la fecha y el autor, que solo vivían en
-- t_auditoria y la pantalla de Flota no podía mostrar:
--
--   · vehi_baja_en / vehi_baja_por   → vehículo
--   · cond_baja_en / cond_baja_por   → conductor
--   · ubic_baja_en / ubic_baja_por   → garaje
--
-- `*_baja_por` es el usuario, sin FK, igual que oper_creado_por. Se llenan al dar de baja y se
-- vacían al reactivar (FlotaService).
--
-- RELLENO DE LO EXISTENTE: a lo que ya está de baja y no tiene fecha se le pone la ÚLTIMA traza
-- `*_activo true → false` de t_auditoria (momento y usuario). Sin traza, queda nulo: no se inventa.
--
-- ADITIVA E IDEMPOTENTE: columnas nulas con IF NOT EXISTS; el relleno solo toca filas de baja sin
-- fecha, así que repetirla no cambia nada.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE t_vehiculo ADD COLUMN IF NOT EXISTS vehi_baja_en TIMESTAMPTZ(3) NULL;
ALTER TABLE t_vehiculo ADD COLUMN IF NOT EXISTS vehi_baja_por INTEGER NULL;
ALTER TABLE t_conductor ADD COLUMN IF NOT EXISTS cond_baja_en TIMESTAMPTZ(3) NULL;
ALTER TABLE t_conductor ADD COLUMN IF NOT EXISTS cond_baja_por INTEGER NULL;
ALTER TABLE t_ubicacion_flota ADD COLUMN IF NOT EXISTS ubic_baja_en TIMESTAMPTZ(3) NULL;
ALTER TABLE t_ubicacion_flota ADD COLUMN IF NOT EXISTS ubic_baja_por INTEGER NULL;

UPDATE t_vehiculo v
   SET vehi_baja_en = a.audi_momento, vehi_baja_por = a.audi_usuario
  FROM (SELECT DISTINCT ON (audi_entidad_id) audi_entidad_id, audi_momento, audi_usuario
          FROM t_auditoria
         WHERE audi_entidad = 't_vehiculo' AND audi_campo = 'vehi_activo' AND audi_valor_nuevo = 'false'
         ORDER BY audi_entidad_id, audi_momento DESC, audi_id DESC) a
 WHERE a.audi_entidad_id = v.vehi_id
   AND v.vehi_activo = false
   AND v.vehi_baja_en IS NULL;

UPDATE t_conductor c
   SET cond_baja_en = a.audi_momento, cond_baja_por = a.audi_usuario
  FROM (SELECT DISTINCT ON (audi_entidad_id) audi_entidad_id, audi_momento, audi_usuario
          FROM t_auditoria
         WHERE audi_entidad = 't_conductor' AND audi_campo = 'cond_activo' AND audi_valor_nuevo = 'false'
         ORDER BY audi_entidad_id, audi_momento DESC, audi_id DESC) a
 WHERE a.audi_entidad_id = c.cond_id
   AND c.cond_activo = false
   AND c.cond_baja_en IS NULL;

UPDATE t_ubicacion_flota u
   SET ubic_baja_en = a.audi_momento, ubic_baja_por = a.audi_usuario
  FROM (SELECT DISTINCT ON (audi_entidad_id) audi_entidad_id, audi_momento, audi_usuario
          FROM t_auditoria
         WHERE audi_entidad = 't_ubicacion_flota' AND audi_campo = 'ubic_activo' AND audi_valor_nuevo = 'false'
         ORDER BY audi_entidad_id, audi_momento DESC, audi_id DESC) a
 WHERE a.audi_entidad_id = u.ubic_id
   AND u.ubic_activo = false
   AND u.ubic_baja_en IS NULL;
