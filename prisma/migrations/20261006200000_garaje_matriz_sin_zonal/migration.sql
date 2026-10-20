-- ═══════════════════════════════════════════════════════════════════════════════
-- Garaje «Matriz» SIN zonal (2026-10-06, mejoras de usabilidad DAF).
--
-- La siembra del 2026-10-06 lo había asociado a «Zonal La Mariscal». Decisión del negocio: el
-- garaje de la Matriz (Alpallana E6-113) NO se asocia a ninguna zonal del cuadro. Sin zonal, los
-- traslados hacia o desde él usan la regla general de OTRO sector (ver `traslados.ts`).
--
-- Solo datos, idempotente: re-ejecutarla deja lo mismo. Compara sin tildes ni mayúsculas.
-- ═══════════════════════════════════════════════════════════════════════════════
BEGIN;

UPDATE t_ubicacion_flota
   SET zona_id = NULL
 WHERE upper(btrim(ubic_nombre)) = 'MATRIZ'
   AND zona_id IS NOT NULL;

COMMIT;
