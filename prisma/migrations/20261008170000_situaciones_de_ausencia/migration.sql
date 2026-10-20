-- ═══════════════════════════════════════════════════════════════════════════════
-- Microservicio: transporte · Módulo: Cuadro de Colores · Feature: Disponibilidad del personal
-- Migración: 20261008170000_situaciones_de_ausencia (2026-10-08). SOLO ENUMERADO, ADITIVA.
--
-- TRES SITUACIONES DE AUSENCIA NUEVAS: LICENCIA, CAPACITACION y COMISION_SERVICIOS, pedidas en el
-- rediseño de «Personal y disponibilidad». Como las cuatro anteriores, EXCLUYEN a la persona del
-- cuadro (RN-30): lo decide `ESTADOS_QUE_EXCLUYEN` en `reglas-personal.ts`, no la base.
--
-- IDEMPOTENTE: `ADD VALUE IF NOT EXISTS`. No se borra ni renombra ningún valor —REPOSO_MEDICO y
-- CALAMIDAD cambian solo de NOMBRE VISIBLE en el frontend («Permiso médico», «Calamidad
-- doméstica»)—, así que los registros existentes no se tocan. Va SIN transacción explícita: un
-- valor de enumerado recién añadido no puede usarse en la misma transacción, y esta migración no
-- lo usa.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TYPE "e_estado_disponibilidad" ADD VALUE IF NOT EXISTS 'LICENCIA';
ALTER TYPE "e_estado_disponibilidad" ADD VALUE IF NOT EXISTS 'CAPACITACION';
ALTER TYPE "e_estado_disponibilidad" ADD VALUE IF NOT EXISTS 'COMISION_SERVICIOS';
