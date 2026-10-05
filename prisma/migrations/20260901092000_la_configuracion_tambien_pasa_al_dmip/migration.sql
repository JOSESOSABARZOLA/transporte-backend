-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: la_configuracion_tambien_pasa_al_dmip
-- Responsabilidad: Repuntar al DMIP las dos filas de configuracion que nombraban al rol retirado.
-- Fuente: decision del negocio del 2026-09-01.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-09-01
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- LA MIGRACION DEL 091000 MOVIO LAS CUENTAS Y SE DEJO LA CONFIGURACION.
--
-- `t_usuario_rol` paso a `ADMINISTRADOR_DMIP` aquel dia, pero otras dos tablas siguen
-- nombrando al rol que quedo vacio. Ninguna de las dos impide entrar al sistema -los roles
-- se leen de `t_usuario_rol` y de ningun otro sitio-, y por eso el hueco no se vio hasta
-- repasar las pantallas que las pintan.
--
-- NO SE TOCA `t_auditoria`, Y ESA ES LA DISTINCION QUE ORDENA ESTA MIGRACION. Sus 687
-- filas con `ADMINISTRADOR` son historia: dicen quien hizo que y bajo que rol en su
-- momento. Reescribirlas seria falsificar el registro. Las dos de aqui son configuracion
-- vigente, que describe como funciona el sistema HOY.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ────────────────────── 1 · La correspondencia con Auth ──────────────────────

-- El rol 58 de Auth central -«Transporte - Administrador»- es el que deja elegir este
-- modulo en el portal. Sigue siendo el mismo rol y con el mismo nombre EN AUTH: lo que
-- cambia es a que rol del modulo lo hacemos corresponder.
--
-- Sin esto, la pantalla «Roles de Auth central» decia lo contrario de la verdad: listaba
-- `ADMINISTRADOR_DMIP` -el rol que administra de verdad- entre los que no tienen
-- correspondencia, con el aviso de que esa persona no podria entrar, y mostraba el rol
-- retirado como si fuera el bueno.
UPDATE public.t_rol_auth
   SET rola_rol = 'ADMINISTRADOR_DMIP',
       rola_actualizado_en = now()
 WHERE rola_rol = 'ADMINISTRADOR';

-- ────────────────────── 2 · La ventana de carga ──────────────────────

-- `uq_ventana_rol` es unico por rol y no existe fila para `ADMINISTRADOR_DMIP`, asi que
-- el UPDATE no colisiona.
--
-- El efecto es menor y conviene decirlo: la fila esta INACTIVA, y una ventana inactiva
-- -igual que una ausente- se resuelve como «su rol no tiene restriccion horaria». El
-- comportamiento no cambia. Lo que se arregla es la pantalla «Ventanas y parametros»,
-- que mostraba una ventana del rol retirado y ninguna del que administra.
UPDATE public.t_ventana_carga
   SET vcar_rol = 'ADMINISTRADOR_DMIP'
 WHERE vcar_rol = 'ADMINISTRADOR';

-- ────────────────────── 3 · Comprobacion ──────────────────────

-- Solo se afirma que no queda nada apuntando al rol retirado. NO se exige que las filas
-- existan: `transportedb_pruebas` no siembra ni correspondencias ni ventanas, y una
-- comprobacion de existencia volveria a dejar la suite de integracion sin poder correr,
-- que es justo el error del 27-AGO. Ver DESPLIEGUE.md seccion 4.1.
DO $$
DECLARE
  correspondencias integer;
  ventanas integer;
BEGIN
  SELECT count(*) INTO correspondencias
    FROM public.t_rol_auth WHERE rola_rol = 'ADMINISTRADOR';

  SELECT count(*) INTO ventanas
    FROM public.t_ventana_carga WHERE vcar_rol = 'ADMINISTRADOR';

  IF correspondencias <> 0 OR ventanas <> 0 THEN
    RAISE EXCEPTION
      'Quedo configuracion apuntando a ADMINISTRADOR: % en t_rol_auth y % en t_ventana_carga.',
      correspondencias, ventanas;
  END IF;

  RAISE NOTICE 'Configuracion repuntada al DMIP. La auditoria conserva su historia intacta.';
END $$;
