-- ═══════════════════════════════════════════════════════════════════════════════
-- Microservicio: transporte · Módulo: Cuadro de Colores · Feature: Ventanas de carga
-- Migración: 20261007171000_ventanas_tipo_y_marcadores (2026-10-07). SOLO DATOS.
--
-- 1. Una ventana desactivada pasa a SIN_RESTRICCION: desde esta fecha «sin restricción» es un
--    TIPO y `vcar_activo` se deriva de él (activo = tipo <> SIN_RESTRICCION).
-- 2. SEMANAL e INTERVALO pasan a DIARIO: la pantalla ya no los ofrece. El evaluador decide por
--    días y horas, así que el comportamiento no cambia (los días, si los hubiera, se conservan).
-- 3. MARCADORES EN EL MENSAJE. Una hora fija del mensaje (18H25 o 18:25) que coincide con la de
--    cierre o la de apertura se reemplaza por {cierre} / {apertura}: así el texto sigue a la hora
--    cuando el administrador la mueva. Las horas que NO coinciden con ninguna NO se tocan: se
--    listan con RAISE NOTICE para revisarlas a mano en «Ventanas y parámetros».
--
-- IDEMPOTENTE: repetirla no cambia nada (un mensaje ya con marcadores no tiene horas fijas que
-- coincidan; los tipos ya pasados no vuelven a cumplir las condiciones).
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1 · Desactivada → SIN_RESTRICCION.
UPDATE t_ventana_carga
   SET vcar_tipo = 'SIN_RESTRICCION'
 WHERE NOT vcar_activo
   AND vcar_tipo <> 'SIN_RESTRICCION';

-- Coherencia del derivado: un SIN_RESTRICCION nunca queda activo.
UPDATE t_ventana_carga
   SET vcar_activo = FALSE
 WHERE vcar_tipo = 'SIN_RESTRICCION'
   AND vcar_activo;

-- 2 · SEMANAL / INTERVALO → DIARIO.
UPDATE t_ventana_carga
   SET vcar_tipo = 'DIARIO'
 WHERE vcar_tipo IN ('SEMANAL', 'INTERVALO');

-- 3 · Horas fijas que coinciden con cierre / apertura → marcadores. Se aceptan «18H25», «18h25»
--     y «18:25». Solo se reemplaza la hora EXACTA de la ventana (con o sin cero inicial).
DO $$
DECLARE
  fila      RECORD;
  mensaje   TEXT;
  hora      TEXT;
  coincide  TEXT;
BEGIN
  FOR fila IN
    SELECT vcar_id, vcar_rol, vcar_hora_apertura, vcar_hora_cierre, vcar_mensaje_cierre
      FROM t_ventana_carga
     ORDER BY vcar_id
  LOOP
    mensaje := fila.vcar_mensaje_cierre;

    IF fila.vcar_hora_cierre IS NOT NULL THEN
      mensaje := regexp_replace(
        mensaje,
        '(^|[^0-9])0?' || split_part(fila.vcar_hora_cierre, ':', 1)::int || '[Hh:]'
          || split_part(fila.vcar_hora_cierre, ':', 2) || '(?![0-9])',
        '\1{cierre}', 'g');
    END IF;

    IF fila.vcar_hora_apertura IS NOT NULL THEN
      mensaje := regexp_replace(
        mensaje,
        '(^|[^0-9])0?' || split_part(fila.vcar_hora_apertura, ':', 1)::int || '[Hh:]'
          || split_part(fila.vcar_hora_apertura, ':', 2) || '(?![0-9])',
        '\1{apertura}', 'g');
    END IF;

    IF mensaje IS DISTINCT FROM fila.vcar_mensaje_cierre THEN
      UPDATE t_ventana_carga SET vcar_mensaje_cierre = mensaje WHERE vcar_id = fila.vcar_id;
    END IF;

    -- Lo que queda con hora fija no coincide con la ventana: se informa, no se toca.
    FOR hora IN
      SELECT m[1] FROM regexp_matches(mensaje, '((?:[01]?[0-9]|2[0-3])[Hh:][0-5][0-9])', 'g') AS m
    LOOP
      coincide := COALESCE(fila.vcar_hora_cierre, '-');
      RAISE NOTICE 'REVISAR A MANO · ventana % (%): el mensaje dice % y la ventana es % a %.',
        fila.vcar_id, fila.vcar_rol, hora,
        COALESCE(fila.vcar_hora_apertura, '(sin apertura)'), coincide;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
