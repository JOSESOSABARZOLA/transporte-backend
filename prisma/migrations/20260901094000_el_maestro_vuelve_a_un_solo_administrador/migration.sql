-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: el_maestro_vuelve_a_un_solo_administrador
-- Responsabilidad: Dar a ADMINISTRADOR_DMIP el alcance sobre las cuatro direcciones.
-- Fuente: decision del negocio del 2026-09-01, posterior a 20260901093000.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-09-01
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- P-07 «PERSONAL Y DISPONIBILIDAD» PASA A SER EXCLUSIVA DE `ADMINISTRADOR_DMIP`.
--
-- El negocio lo decidio despues de ver la pantalla en marcha. Salen de ella los tres
-- roles departamentales -que la abrian desde PER-09, 27-AGO- y tambien
-- `ADMINISTRADOR_DMIT` y `ADMINISTRADOR_DAF`, que la habian recibido esa misma manana.
--
-- ESTA MIGRACION EXISTE PORQUE ESA DECISION, SOLA, DEJABA GENTE SIN ADMINISTRADOR.
-- `ADMINISTRADOR_DMIP` alcanzaba las dos unidades de la DMIP: si es el unico que entra,
-- el personal de Instruccion y de la DAF no lo puede dar de alta, editar ni dar de baja
-- nadie. No fallaria nada al desplegar; se descubriria semanas despues, cuando alguien
-- buscara a esa persona y no estuviera.
--
-- Se arregla con dos filas y no tocando el codigo: el alcance sigue saliendo de
-- `t_rol_direccion`, que es lo que permite deshacer esto -o volver a repartirlo- sin
-- desplegar.
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- LAS FILAS DE LOS OTROS DOS SE CONSERVAN, y es deliberado. No abren ningun endpoint
-- desde hoy, asi que no conceden nada; describen un reparto que el negocio ya acordo y
-- que vuelve a estar a una linea de distancia el dia que se retome. Borrarlas obligaria
-- a redescubrirlo.

INSERT INTO public.t_rol_direccion (rodi_rol, rodi_direccion) VALUES
  ('ADMINISTRADOR_DMIP', 'DMIT_INSTRUCTOR'),
  ('ADMINISTRADOR_DMIP', 'DAF')
ON CONFLICT (rodi_rol, rodi_direccion) DO NOTHING;

-- ─────────────────────────── Comprobacion ───────────────────────────

-- Ninguna direccion con personal puede quedar fuera del alcance del unico rol que abre
-- la pantalla. Es justo el defecto que esta migracion viene a evitar, asi que se afirma.
DO $$
DECLARE
  fuera text;
BEGIN
  SELECT string_agg(d.direccion, ', ') INTO fuera
    FROM (VALUES ('DMIP_OPERATIVOS'), ('DMIP_INSPECCIONES'),
                 ('DMIT_INSTRUCTOR'), ('DAF')) AS d(direccion)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.t_rol_direccion
      WHERE rodi_rol = 'ADMINISTRADOR_DMIP'
        AND rodi_direccion = d.direccion::public.e_rol_departamental
        AND rodi_activo
   );

  IF fuera IS NOT NULL THEN
    RAISE EXCEPTION
      'ADMINISTRADOR_DMIP no alcanza %, y es el unico que abre P-07: ese personal quedaria sin administrador.',
      fuera;
  END IF;

  RAISE NOTICE 'ADMINISTRADOR_DMIP alcanza las cuatro direcciones con personal.';
END $$;
