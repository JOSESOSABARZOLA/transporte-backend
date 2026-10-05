-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: el_administrador_general_recupera_su_rol_de_auth
-- Responsabilidad: Devolver la correspondencia de Auth «Transporte - Administrador» al rol general ADMINISTRADOR.
-- Fuente: decision del negocio del 2026-09-10 (ADMINISTRADOR se reactiva como administrador general).
-- Desarrollador: Jose Sosa
-- Fecha: 2026-09-10
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- REVIERTE EL REPUNTE DEL 2026-09-01.
--
-- Aquel dia, al vaciarse ADMINISTRADOR, la fila 58 de t_rol_auth -«Transporte -
-- Administrador», la que deja elegir este modulo en el portal- se repunto a
-- ADMINISTRADOR_DMIP. Hoy ADMINISTRADOR vuelve a ser el administrador general del sistema
-- (ve TODO el modulo de administracion, incluida la flota), asi que esa correspondencia
-- vuelve a el.
--
-- CONSECUENCIA, Y CONVIENE DECIRLA: ADMINISTRADOR_DMIP queda sin correspondencia de Auth. NO
-- pierde accesos -sigue siendo asignable en «Cuentas del cuadro» (t_usuario_rol) y ninguna
-- cuenta actual se toca-, pero el panorama de «Roles de Auth central» lo listara como sin
-- correspondencia. Si el negocio quiere una entrada de Auth propia para el admin-sin-flota,
-- Auth central debe definir un rol nuevo y mapearlo desde esa pantalla.
--
-- NO SE TOCA t_usuario_rol NI t_auditoria: los roles efectivos se leen de t_usuario_rol y
-- ninguna cuenta cambia; la auditoria es historia y no se reescribe.
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE public.t_rol_auth
   SET rola_rol = 'ADMINISTRADOR',
       rola_actualizado_en = now()
 WHERE rola_id_auth = 58
   AND rola_rol = 'ADMINISTRADOR_DMIP';

-- Comprobacion: la 58, si existe, ya no apunta al DMIP. NO se exige que exista -la base de
-- pruebas no siembra correspondencias-, solo que no quede en el estado anterior.
DO $$
DECLARE
  pendientes integer;
BEGIN
  SELECT count(*) INTO pendientes
    FROM public.t_rol_auth
   WHERE rola_id_auth = 58 AND rola_rol = 'ADMINISTRADOR_DMIP';

  IF pendientes <> 0 THEN
    RAISE EXCEPTION 'La correspondencia 58 sigue apuntando a ADMINISTRADOR_DMIP.';
  END IF;

  RAISE NOTICE 'La correspondencia «Transporte - Administrador» vuelve al rol general ADMINISTRADOR.';
END $$;
