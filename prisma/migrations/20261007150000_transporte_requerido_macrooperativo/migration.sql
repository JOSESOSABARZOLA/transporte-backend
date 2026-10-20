-- Transporte requerido y macrooperativo · 2026-10-07
--
-- 1. El defecto del transporte de los formularios 1 (Fijos), 2 (PMO), 3 (Limpiaparabrisas) y
--    4 (Patrulla ECU diurna) pasa a PROPIOS_MEDIOS. Es solo la SUGERENCIA del combo al registrar:
--    quien registra decide. Los operativos ya registrados CONSERVAN su tipo (no se tocan).
-- 2. Los formularios nuevos nacen con PROPIOS_MEDIOS salvo que el administrador configure otro.
-- 3. `oper_transporte_liberado_en`: cuándo el registro cambió el tipo de un operativo que ya tenía
--    transporte asignado y la asignación se liberó. Mientras siga pendiente de reasignar, el
--    operativo lleva la alerta «Transporte liberado» (ALV-07) para la DAF. Se limpia al reasignar.
-- Aditiva e idempotente.

BEGIN;

UPDATE public.t_formulario
   SET form_tipo_transporte_defecto = 'PROPIOS_MEDIOS'
 WHERE form_numero IN (1, 2, 3, 4)
   AND form_tipo_transporte_defecto <> 'PROPIOS_MEDIOS';

ALTER TABLE public.t_formulario
  ALTER COLUMN form_tipo_transporte_defecto SET DEFAULT 'PROPIOS_MEDIOS';

ALTER TABLE public.t_operativo
  ADD COLUMN IF NOT EXISTS oper_transporte_liberado_en TIMESTAMPTZ(3) NULL;

COMMIT;
