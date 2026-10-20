-- ═══════════════════════════════════════════════════════════════════════════════
-- Microservicio: transporte · Módulo: Cuadro de Colores · Feature: Ventanas de carga
-- Migración: 20261006210000_ventanas_mensajes_horas_reales (2026-10-06). SOLO DATOS.
--
-- LOS MENSAJES DE CIERRE DECÍAN OTRAS HORAS. Las ventanas se movieron en «Ventanas y parámetros»
-- (registro de operativos hasta las 18H25; DAF de 18H25 a 18H28) y el texto libre
-- `vcar_mensaje_cierre` siguió diciendo «15H00» / «15H00 a 16H30». El banner y el 423 mostraban
-- ese texto, contradiciendo a la lista «Antes de asignar» (que usa las horas reales).
--
-- Desde esta fecha el horario mostrado se CALCULA de las horas (horario-ventana.ts) y el texto
-- libre es solo una nota. Aun así se actualiza, para que la nota no contradiga al horario.
-- Decisión del usuario: MANTENER las horas actuales y corregir solo los textos.
--
-- IDEMPOTENTE Y PRUDENTE: solo toca los textos que aún mencionan «15H00» (los viejos), así no
-- pisa un mensaje que el administrador haya redactado después. Las horas NO se tocan.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE t_ventana_carga
   SET vcar_mensaje_cierre = 'La ventana de carga de su departamento cerró a las '
       || replace(vcar_hora_cierre, ':', 'H') || '. Vuelve a abrirse mañana.'
 WHERE vcar_rol IN ('DMIP_OPERATIVOS', 'DMIP_INSPECCIONES', 'DMIT_INSTRUCTOR')
   AND vcar_activo
   AND vcar_hora_cierre IS NOT NULL
   AND vcar_mensaje_cierre LIKE '%15H00%'
   AND vcar_hora_cierre <> '15:00';

UPDATE t_ventana_carga
   SET vcar_mensaje_cierre = 'La ventana de asignación de transporte va de '
       || replace(vcar_hora_apertura, ':', 'H') || ' a ' || replace(vcar_hora_cierre, ':', 'H')
       || '. Fuera de ese intervalo no se puede asignar conductor ni vehículo.'
 WHERE vcar_rol = 'DAF'
   AND vcar_activo
   AND vcar_hora_apertura IS NOT NULL
   AND vcar_hora_cierre IS NOT NULL
   AND vcar_mensaje_cierre LIKE '%15H00%'
   AND NOT (vcar_hora_apertura = '15:00' AND vcar_hora_cierre = '16:30');

COMMIT;
