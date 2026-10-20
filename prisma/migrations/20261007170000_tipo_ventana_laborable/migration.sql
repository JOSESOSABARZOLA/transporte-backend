-- ═══════════════════════════════════════════════════════════════════════════════
-- Microservicio: transporte · Módulo: Cuadro de Colores · Feature: Ventanas de carga
-- Migración: 20261007170000_tipo_ventana_laborable (2026-10-07). SOLO ENUMERADO.
--
-- Dos tipos nuevos de ventana: LABORABLE (lunes a viernes; sábado y domingo sin carga) y
-- SIN_RESTRICCION (el rol carga a cualquier hora; reemplaza a «Ventana vigente» desmarcada).
--
-- VA SOLA, EN SU PROPIA MIGRACIÓN: PostgreSQL no deja USAR un valor de enumerado en la misma
-- transacción que lo agrega. Los datos se pasan en 20261007171000. ADITIVA E IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TYPE e_tipo_ventana ADD VALUE IF NOT EXISTS 'LABORABLE';
ALTER TYPE e_tipo_ventana ADD VALUE IF NOT EXISTS 'SIN_RESTRICCION';
