-- ═══════════════════════════════════════════════════════════════════════════════
-- AGREGAR UN PUNTO DE ENCUENTRO AL CATÁLOGO DESDE EL REGISTRO. 2026-09-24.
--
-- Unidad de Operativos pidió poder ingresar un punto de encuentro a mano al registrar y
-- que ese punto QUEDE en el catálogo, ligado a la zonal elegida (reutilizable por todos).
-- Es distinto de `form_captura_libre_punto` (que solo teclea texto suelto en el operativo).
--
-- Se gobierna por formulario con `form_punto_manual`, verdadero solo en los de Unidad de
-- Operativos —1 FIJOS, 2 PMO, 3 LIMPIA, 4 ECU—. Es un dato: habilitarlo en otro es un UPDATE.
--
-- Sobre `transportedb_pruebas` no hay formularios institucionales, así que el UPDATE no toca
-- ninguna fila; la columna se agrega con su `DEFAULT false` y las suites siembran lo que necesiten.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.t_formulario
  ADD COLUMN form_punto_manual boolean NOT NULL DEFAULT false;

UPDATE public.t_formulario
   SET form_punto_manual = true
 WHERE form_numero IN (1, 2, 3, 4);
