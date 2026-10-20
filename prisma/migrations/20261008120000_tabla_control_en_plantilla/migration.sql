-- ═══════════════════════════════════════════════════════════════════════════════
-- Microservicio: transporte · Módulo: Cuadro de Colores · Feature: Órdenes de servicio
-- Migración: 20261008120000_tabla_control_en_plantilla (2026-10-08). SOLO DATOS.
--
-- LA TABLA DE CONTROL (Acción / Siglas Unidad / Fecha) SALE DE LA PLANTILLA DEL DIRECTOR. Hasta
-- hoy «Elaborado por» y el NUT eran de la config del DÍA (t_orden_config_cuadro) y las siglas un
-- parámetro global. El NUT deja de imprimirse; «Elaborado por» y las siglas pasan a los datos
-- generales de la plantilla, versionados como el resto.
--
-- A cada plantilla cuyos datos generales aún no tienen la clave `accion` se le crea una VERSIÓN
-- NUEVA con:
--   · accion        = 'Elaborado por'
--   · elaboradoPor  = el último «elaborado por» de una jornada en la que ese Director tiene órdenes
--                     con esta plantilla; si no hay, el último registrado por cualquiera; si no, ''.
--                     (t_orden_config_cuadro no guarda quién lo escribió: se deduce por las órdenes.)
--                     La plantilla BASE institucional no es de nadie: queda con ''.
--   · siglasUnidad  = el parámetro ORDEN_SIGLAS_UNIDAD en mayúsculas (máx. 20), o ''.
-- Solo los BORRADORES de esa plantilla (vigentes y sin número) pasan a la versión nueva. Las órdenes
-- Vigentes y Reemplazadas conservan su versión: no se regeneran.
--
-- IDEMPOTENTE: una plantilla que ya tiene `accion` no vuelve a cumplir la condición. No se borra
-- ninguna columna: ocuc_nut y ocuc_elaborado_por quedan (la segunda la lee el respaldo de las
-- órdenes emitidas con versiones anteriores).
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  plantilla     RECORD;
  siglas        TEXT;
  elaborado     TEXT;
  datos_nuevos  JSONB;
  version_nueva INT;
BEGIN
  SELECT UPPER(LEFT(BTRIM(p.para_valor), 20))
    INTO siglas
    FROM t_parametro_politica p
   WHERE p.para_clave = 'ORDEN_SIGLAS_UNIDAD';
  siglas := COALESCE(siglas, '');

  FOR plantilla IN
    SELECT plor_id, plor_version, plor_apartados, plor_datos_generales, plor_es_base
      FROM t_plantilla_orden
     WHERE plor_datos_generales IS NULL
        OR jsonb_typeof(plor_datos_generales) <> 'object'
        OR NOT (plor_datos_generales ? 'accion')
     ORDER BY plor_id
     FOR UPDATE
  LOOP
    -- El último «elaborado por» de una jornada con órdenes de esta plantilla.
    SELECT BTRIM(c.ocuc_elaborado_por)
      INTO elaborado
      FROM t_orden_config_cuadro c
     WHERE NULLIF(BTRIM(c.ocuc_elaborado_por), '') IS NOT NULL
       AND EXISTS (
             SELECT 1
               FROM t_orden_servicio o
               JOIN t_operativo op ON op.oper_id = o.oper_id
               JOIN t_cuadro_diario cu ON cu.cuad_id = op.cuad_id
              WHERE o.oser_plantilla_id = plantilla.plor_id
                AND cu.cuad_fecha = c.ocuc_fecha
           )
     ORDER BY c.ocuc_actualizado_en DESC
     LIMIT 1;

    -- Respaldo: el último registrado por cualquiera (no para la base, que no es de nadie).
    IF elaborado IS NULL AND NOT plantilla.plor_es_base THEN
      SELECT BTRIM(c.ocuc_elaborado_por)
        INTO elaborado
        FROM t_orden_config_cuadro c
       WHERE NULLIF(BTRIM(c.ocuc_elaborado_por), '') IS NOT NULL
       ORDER BY c.ocuc_actualizado_en DESC
       LIMIT 1;
    END IF;

    datos_nuevos :=
      (CASE
         WHEN jsonb_typeof(plantilla.plor_datos_generales) = 'object'
           THEN plantilla.plor_datos_generales
         ELSE '{}'::jsonb
       END)
      || jsonb_build_object(
           'accion', 'Elaborado por',
           'elaboradoPor', LEFT(COALESCE(elaborado, ''), 200),
           'siglasUnidad', siglas
         );
    version_nueva := plantilla.plor_version + 1;

    UPDATE t_plantilla_orden
       SET plor_datos_generales = datos_nuevos,
           plor_version = version_nueva,
           plor_actualizado_en = NOW()
     WHERE plor_id = plantilla.plor_id;

    INSERT INTO t_plantilla_orden_version
           (plor_id, plov_version, plov_apartados, plov_datos_generales, plov_creado_por)
    SELECT plantilla.plor_id, version_nueva, plantilla.plor_apartados, datos_nuevos, NULL
     WHERE NOT EXISTS (
             SELECT 1
               FROM t_plantilla_orden_version v
              WHERE v.plor_id = plantilla.plor_id
                AND v.plov_version = version_nueva
           );

    -- Solo los borradores pasan a la versión nueva.
    UPDATE t_orden_servicio
       SET oser_plantilla_version = version_nueva
     WHERE oser_plantilla_id = plantilla.plor_id
       AND oser_vigente
       AND oser_numero_secuencial IS NULL;
  END LOOP;
END
$$;

COMMIT;
