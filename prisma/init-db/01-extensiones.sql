-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Archivo: 01-extensiones.sql
-- Responsabilidad: Habilitar pg_stat_statements en la puesta en marcha. M-30.
--
-- POR QUE SE MIDE DESDE EL PRIMER DIA.
--
-- pg_stat_statements acumula el tiempo de cada consulta desde que la base arranca. Si se
-- habilita despues, cuando alguien se queja de que "va lento", no hay con que comparar:
-- se empieza a medir justo el dia en que el problema ya existe.
--
-- La extension necesita las DOS cosas: la biblioteca precargada -que se declara en el
-- `command:` del servicio en docker-compose.yml, porque shared_preload_libraries solo se
-- lee al arrancar el proceso- y esta sentencia, que crea los objetos en la base.
--
-- ESTE ARCHIVO SOLO SE EJECUTA CON EL VOLUMEN VACIO. Es como funciona
-- /docker-entrypoint-initdb.d en la imagen oficial de PostgreSQL: si `transporte_pgdata`
-- ya tiene datos, el script no corre. Sobre un despliegue existente hay que ejecutar la
-- sentencia a mano, y el manual de despliegue lo indica.

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
