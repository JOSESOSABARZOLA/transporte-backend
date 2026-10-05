-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: las_cuentas_administradoras_pasan_al_dmip
-- Responsabilidad: Traspasar las cuentas de ADMINISTRADOR a ADMINISTRADOR_DMIP.
-- Fuente: decision del negocio del 2026-09-01.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-09-01
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- ES LA MIGRACION QUE IMPIDE QUEDARSE FUERA DEL SISTEMA.
--
-- `ADMINISTRADOR_DMIP` hereda todos los accesos del antiguo `ADMINISTRADOR`, asi que el
-- traspaso es la continuidad: sin el, al desplegar el codigo nuevo la unica cuenta
-- administradora dejaria de abrir nada.
--
-- Y NO SE PODRIA ARREGLAR DESDE LA APLICACION. Los roles se asignan en P-11 «Cuentas del
-- cuadro», que es de administrador: quien pierde el rol pierde tambien la pantalla donde
-- volveria a darselo. La salida seria un UPDATE a mano en produccion.
--
-- POR ESO EL ORDEN DEL DESPLIEGUE NO ES NEGOCIABLE: migraciones primero, codigo despues.
-- Ver DESPLIEGUE.md seccion 3.
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- VA SEPARADA DE LA ANTERIOR POR UNA RESTRICCION DE POSTGRESQL, no por gusto:
-- `ALTER TYPE ... ADD VALUE` no admite usar el valor nuevo en la misma transaccion, y
-- Prisma envuelve cada migracion en una. Fusionarlas rompe el despliegue.

-- ─────────────────────────── 1 · El traspaso ───────────────────────────

UPDATE public.t_usuario_rol
   SET usro_rol = 'ADMINISTRADOR_DMIP'
 WHERE usro_rol = 'ADMINISTRADOR';

-- ─────────────────────────── 2 · Comprobacion ───────────────────────────

-- Si quedara una sola cuenta en el rol viejo, esa persona se quedaria sin accesos al
-- desplegar el codigo. Mejor que la migracion falle aqui, con la base intacta.
DO $$
DECLARE
  huerfanas integer;
  administradores integer;
BEGIN
  SELECT count(*) INTO huerfanas
    FROM public.t_usuario_rol WHERE usro_rol = 'ADMINISTRADOR';

  IF huerfanas <> 0 THEN
    RAISE EXCEPTION
      'Quedaron % cuentas en ADMINISTRADOR y debian quedar 0.', huerfanas;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- Y AL MENOS UNA TIENE QUE ADMINISTRAR. Sin ninguna, el sistema queda sin
  -- catalogos, sin ventanas, sin parametros y sin forma de crear cuentas: se
  -- arreglaria solo con SQL a mano.
  --
  -- SE OMITE EN LA BASE DE PRUEBAS, que no tiene cuentas sembradas. Es la guarda que
  -- les faltaba a las cuatro migraciones del 27-AGO y que dejo la suite de integracion
  -- sin poder ejecutarse durante dias. Ver DESPLIEGUE.md seccion 4.1.
  -- ═══════════════════════════════════════════════════════════════════════════
  IF current_database() = 'transportedb_pruebas' THEN
    RAISE NOTICE 'Base de pruebas: se omite la comprobacion de administradores.';
    RETURN;
  END IF;

  SELECT count(*) INTO administradores
    FROM public.t_usuario_rol WHERE usro_rol = 'ADMINISTRADOR_DMIP';

  IF administradores = 0 THEN
    RAISE EXCEPTION
      'No queda ninguna cuenta con ADMINISTRADOR_DMIP: el sistema se quedaria sin administracion.';
  END IF;

  RAISE NOTICE 'Traspaso correcto: % cuentas administran como ADMINISTRADOR_DMIP.', administradores;
END $$;
