-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: los_tres_administradores_departamentales
-- Responsabilidad: Anadir los tres roles de administracion al enumerado.
-- Fuente: decision del negocio del 2026-09-01.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-09-01
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- LA ADMINISTRACION SE REPARTE EN TRES.
--
-- Hasta hoy habia un unico `ADMINISTRADOR` que lo abria todo: catalogos, ventanas,
-- parametros, cuentas, personal y flota. El negocio lo divide por direccion:
--
--   ADMINISTRADOR_DMIP  hereda TODO lo que tenia ADMINISTRADOR.
--   ADMINISTRADOR_DMIT  sin accesos todavia.
--   ADMINISTRADOR_DAF   sin accesos todavia.
--
-- Los dos ultimos se crean ahora aunque no abran nada: el enumerado es la parte cara de
-- este cambio -exige migracion, porque `e_rol_departamental` es un tipo de PostgreSQL- y
-- anadirlos hoy evita repetirla el dia que se les de trabajo.
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- ESTA MIGRACION NO TOCA NINGUNA FILA, Y ESO ES DELIBERADO.
--
-- `ALTER TYPE ... ADD VALUE` **no puede usarse en la misma transaccion que lo anade**:
-- PostgreSQL rechaza el UPDATE con «unsafe use of new value of enum type». Prisma envuelve
-- cada migracion en una transaccion, asi que el traspaso de las cuentas va en la migracion
-- siguiente, `20260901091000_las_cuentas_administradoras_pasan_al_dmip`.
--
-- SI SE FUSIONAN LAS DOS, EL DESPLIEGUE FALLA. No es una cuestion de estilo.
--
-- `ADMINISTRADOR` NO SE RETIRA. PostgreSQL no admite quitar un valor de un enumerado sin
-- recrear el tipo entero y todas las columnas que lo usan -`t_usuario_rol`, `t_formulario`,
-- `t_formulario_rol`, `t_operativo`, `t_funcionario`, `t_auditoria`...-. Se deja vacio.

ALTER TYPE public.e_rol_departamental ADD VALUE IF NOT EXISTS 'ADMINISTRADOR_DMIP';
ALTER TYPE public.e_rol_departamental ADD VALUE IF NOT EXISTS 'ADMINISTRADOR_DMIT';
ALTER TYPE public.e_rol_departamental ADD VALUE IF NOT EXISTS 'ADMINISTRADOR_DAF';

COMMENT ON TYPE public.e_rol_departamental IS
  'Los nueve roles del modulo. ADMINISTRADOR quedo vacio el 2026-09-01: sus cuentas pasaron a ADMINISTRADOR_DMIP y el valor se conserva porque un enumerado no admite retirarlo.';
