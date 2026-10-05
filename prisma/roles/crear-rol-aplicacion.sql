-- Microservicio: transporte
-- Modulo: Cuadro de Colores
-- Archivo: crear-rol-aplicacion.sql
-- Responsabilidad: Crear el rol con que corre la aplicacion, sin privilegios de esquema.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-08-19
--
-- POR QUE EXISTE. Hasta hoy la aplicacion se conectaba como `postgres`: superusuario, con
-- CREATEDB, CREATEROLE y BYPASSRLS, y una clave de cinco caracteres. Una inyeccion SQL o
-- una credencial filtrada no comprometian el modulo, comprometian el servidor entero. Era
-- el hallazgo 01 de la auditoria previa a produccion.
--
-- NO ES UNA MIGRACION, Y POR ESO NO VIVE EN prisma/migrations/. Las migraciones describen
-- la ESTRUCTURA de la base y se aplican en cadena; esto describe QUIEN accede a ella, se
-- ejecuta UNA VEZ por base y necesita privilegios que la propia aplicacion no tiene. Si
-- fuera una migracion, el rol tendria que crearse a si mismo.
--
-- COMO SE EJECUTA. Una vez por base, como `postgres`, despues de la primera migracion:
--
--   docker exec -i -e PGPASSWORD=<clave> transportedb \
--     psql -U postgres -d transportedb -v ON_ERROR_STOP=1 \
--     -v clave="'<clave del rol>'" -f - < prisma/roles/crear-rol-aplicacion.sql
--
-- Y TAMBIEN sobre transportedb_pruebas: las suites de integracion corren con este mismo
-- rol a proposito, para que un permiso que falte aparezca en las pruebas y no en produccion.
--
-- ES IDEMPOTENTE. Se puede volver a ejecutar para rotar la clave o reparar permisos.

-- ─────────────────── 1. El rol ───────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'transporte_app') THEN
    CREATE ROLE transporte_app LOGIN;
  END IF;
END $$;

-- Los cinco NO son el contenido de esta decision. Sin ellos el rol heredaria lo que la
-- instalacion tenga por defecto, que no es necesariamente nada.
ALTER ROLE transporte_app WITH PASSWORD :clave
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT NOREPLICATION;

-- El tope de consulta va POR ROL y no global: global rompe las migraciones si alguna tarda
-- mas de la cuenta, y las migraciones corren como `postgres`, que no lo hereda.
ALTER ROLE transporte_app SET statement_timeout = '30s';

-- ─────────────────── 2. Lo que puede hacer ───────────────────
GRANT USAGE ON SCHEMA public TO transporte_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO transporte_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO transporte_app;

-- ─────────────────── 3. Lo que se olvida siempre ───────────────────
--
-- Los GRANT de arriba alcanzan SOLO a lo que ya existe. Sin lo que sigue, la proxima
-- migracion que cree una tabla la dejaria inaccesible para la aplicacion: el fallo no
-- aparece al migrar -que corre como postgres y funciona- sino despues, en ejecucion, como
-- un `permission denied` sobre una tabla que en el esquema se ve perfectamente.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO transporte_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO transporte_app;

-- ─────────────────── 4. Lo que NO debe alcanzar ───────────────────
-- El historial de migraciones no es asunto de la aplicacion: leerlo no le sirve de nada y
-- escribirlo le permitiria falsear en que version cree estar la base.
REVOKE ALL ON TABLE _prisma_migrations FROM transporte_app;
