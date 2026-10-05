-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: rbac_permisos
-- Responsabilidad: RBAC por permisos atomicos. Catalogo de roles (t_rol), catalogo de
--   permisos (t_permiso) y matriz rol<->permiso (t_rol_permiso). La semilla de la matriz
--   reproduce 1:1 los @Roles de hoy (red de paridad): al migrar los controladores el acceso
--   no cambia. El enum e_rol_departamental sigue siendo la identidad del rol.
-- Fecha: 2026-09-16

-- ─────────────────────────────── DDL ───────────────────────────────

CREATE TABLE "t_rol" (
    "rol_codigo"    "e_rol_departamental" NOT NULL,
    "rol_nombre"    VARCHAR(120) NOT NULL,
    "rol_orden"     SMALLINT NOT NULL,
    "rol_asignable" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "t_rol_pkey" PRIMARY KEY ("rol_codigo")
);

CREATE TABLE "t_permiso" (
    "perm_codigo"      VARCHAR(60) NOT NULL,
    "perm_modulo"      VARCHAR(40) NOT NULL,
    "perm_descripcion" VARCHAR(200) NOT NULL,
    "perm_activo"      BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "t_permiso_pkey" PRIMARY KEY ("perm_codigo")
);

CREATE TABLE "t_rol_permiso" (
    "rper_rol"     "e_rol_departamental" NOT NULL,
    "rper_permiso" VARCHAR(60) NOT NULL,
    CONSTRAINT "t_rol_permiso_pkey" PRIMARY KEY ("rper_rol","rper_permiso")
);

CREATE INDEX "idx_permiso_modulo" ON "t_permiso"("perm_modulo");
CREATE INDEX "idx_rol_permiso_rol" ON "t_rol_permiso"("rper_rol");
CREATE INDEX "idx_rol_permiso_permiso" ON "t_rol_permiso"("rper_permiso");

ALTER TABLE "t_rol_permiso" ADD CONSTRAINT "fk_rol_permiso_rol"
    FOREIGN KEY ("rper_rol") REFERENCES "t_rol"("rol_codigo") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "t_rol_permiso" ADD CONSTRAINT "fk_rol_permiso_permiso"
    FOREIGN KEY ("rper_permiso") REFERENCES "t_permiso"("perm_codigo") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────── Semilla: t_rol (catalogo) ───────────────────────
-- Nombre del organigrama (= NOMBRE_ROL), orden del enum, asignable salvo FUNCIONARIO.
INSERT INTO "t_rol" ("rol_codigo","rol_nombre","rol_orden","rol_asignable") VALUES
  ('DMIP_OPERATIVOS',    'DMIP · Unidad de Operativos',                1, true),
  ('DMIP_INSPECCIONES',  'DMIP · Inspecciones Técnicas y Generales',   2, true),
  ('DMIT_INSTRUCTOR',    'DMIT · Instrucción',                         3, true),
  ('DAF',                'DAF · Transportes',                          4, true),
  ('DIRECTOR',           'Dirección',                                  5, true),
  ('FUNCIONARIO',        'Funcionario (rol retirado)',                 6, false),
  ('ADMINISTRADOR_DMIP', 'Administración · DMIP',                      7, true),
  ('ADMINISTRADOR_DMIT', 'Administración · DMIT',                      8, true),
  ('ADMINISTRADOR_DAF',  'Administración · DAF',                       9, true),
  ('ADMINISTRADOR',      'Administración del sistema',                10, true)
ON CONFLICT ("rol_codigo") DO NOTHING;

-- ─────────────────────── Semilla: t_permiso (catalogo) ───────────────────────
INSERT INTO "t_permiso" ("perm_codigo","perm_modulo","perm_descripcion") VALUES
  ('operativos:leer',              'operativos',    'Consultar operativos del cuadro'),
  ('operativos:registrar',         'operativos',    'Registrar operativos'),
  ('operativos:editar',            'operativos',    'Editar operativos'),
  ('operativos:retirar',           'operativos',    'Retirar operativos'),
  ('operativos:personal:gestionar','operativos',    'Asignar, cambiar turno y retirar personal de un operativo'),
  ('operativos:adicional:crear',   'operativos',    'Disponer un operativo adicional del día'),
  ('operativos:apoyo:solicitar',   'operativos',    'Solicitar apoyo entre departamentos'),
  ('operativos:apoyo:ver',         'operativos',    'Ver las solicitudes de apoyo de un operativo'),
  ('operativos:apoyo:bandeja',     'operativos',    'Ver la bandeja de solicitudes de apoyo'),
  ('cuadro:abrir',                 'cuadro',        'Abrir el cuadro del día'),
  ('cuadro:cerrar-reabrir',        'cuadro',        'Cerrar y reabrir el cuadro del día'),
  ('transporte:pendientes:ver',    'transporte',    'Ver operativos pendientes de transporte'),
  ('transporte:vehiculos:ver',     'transporte',    'Ver la flota de vehículos para asignar'),
  ('transporte:conductores:ver',   'transporte',    'Ver los conductores disponibles'),
  ('transporte:destinos:ver',      'transporte',    'Ver los destinos de los vehículos'),
  ('transporte:jornada:ver',       'transporte',    'Ver la jornada de los conductores'),
  ('transporte:asignar',           'transporte',    'Asignar conductor y placa a un operativo'),
  ('transporte:destino:fijar',     'transporte',    'Fijar el destino de un vehículo'),
  ('transporte:propios-medios',    'transporte',    'Marcar un operativo por medios propios'),
  ('transporte:desasignar',        'transporte',    'Devolver un operativo a pendiente'),
  ('flota:administrar',            'flota',         'Administrar conductores y vehículos'),
  ('flota:mantenimiento',          'flota',         'Registrar el mantenimiento de vehículos'),
  ('flota:capacidad:ver',          'flota',         'Consultar la capacidad de flota'),
  ('flota:capacidad:declarar',     'flota',         'Declarar la capacidad de flota'),
  ('matriz:ver',                   'documentos',    'Ver y exportar la matriz consolidada'),
  ('ordenes:gestionar',            'documentos',    'Emitir y consultar órdenes de servicio'),
  ('jornada:ver',                  'documentos',    'Ver la jornada del día'),
  ('personal:administrar',         'personal',      'Administrar el maestro de personal y sus ausencias'),
  ('personal:directorio:ver',      'personal',      'Consultar el directorio de Auth central'),
  ('catalogos:administrar',        'configuracion', 'Administrar catálogos del cuadro y áreas'),
  ('usuarios:administrar',         'configuracion', 'Administrar las cuentas del cuadro'),
  ('ventanas:administrar',         'configuracion', 'Administrar las ventanas de carga'),
  ('roles-auth:administrar',       'configuracion', 'Administrar la homologación de roles de Auth'),
  ('roles:ver',                    'configuracion', 'Consultar el catálogo de roles'),
  ('parametros:administrar',       'configuracion', 'Administrar los parámetros de política'),
  ('permisos:administrar',         'configuracion', 'Administrar la matriz de permisos por rol')
ON CONFLICT ("perm_codigo") DO NOTHING;

-- ─────────────── Semilla: t_rol_permiso (matriz, paridad con los @Roles de hoy) ───────────────
-- CARGA = DMIP_OPERATIVOS, DMIP_INSPECCIONES, DMIT_INSTRUCTOR
INSERT INTO "t_rol_permiso" ("rper_rol","rper_permiso") VALUES
  -- operativos:leer  (CARGA + DAF + DIRECTOR)
  ('DMIP_OPERATIVOS','operativos:leer'),('DMIP_INSPECCIONES','operativos:leer'),('DMIT_INSTRUCTOR','operativos:leer'),('DAF','operativos:leer'),('DIRECTOR','operativos:leer'),
  -- operativos:registrar / editar / retirar / personal:gestionar / apoyo:solicitar  (CARGA)
  ('DMIP_OPERATIVOS','operativos:registrar'),('DMIP_INSPECCIONES','operativos:registrar'),('DMIT_INSTRUCTOR','operativos:registrar'),
  ('DMIP_OPERATIVOS','operativos:editar'),('DMIP_INSPECCIONES','operativos:editar'),('DMIT_INSTRUCTOR','operativos:editar'),
  ('DMIP_OPERATIVOS','operativos:retirar'),('DMIP_INSPECCIONES','operativos:retirar'),('DMIT_INSTRUCTOR','operativos:retirar'),
  ('DMIP_OPERATIVOS','operativos:personal:gestionar'),('DMIP_INSPECCIONES','operativos:personal:gestionar'),('DMIT_INSTRUCTOR','operativos:personal:gestionar'),
  ('DMIP_OPERATIVOS','operativos:apoyo:solicitar'),('DMIP_INSPECCIONES','operativos:apoyo:solicitar'),('DMIT_INSTRUCTOR','operativos:apoyo:solicitar'),
  -- operativos:adicional:crear  (CARGA + DIRECTOR)
  ('DMIP_OPERATIVOS','operativos:adicional:crear'),('DMIP_INSPECCIONES','operativos:adicional:crear'),('DMIT_INSTRUCTOR','operativos:adicional:crear'),('DIRECTOR','operativos:adicional:crear'),
  -- operativos:apoyo:ver  (CARGA + DAF + DIRECTOR + ADMINISTRADOR_DMIP)
  ('DMIP_OPERATIVOS','operativos:apoyo:ver'),('DMIP_INSPECCIONES','operativos:apoyo:ver'),('DMIT_INSTRUCTOR','operativos:apoyo:ver'),('DAF','operativos:apoyo:ver'),('DIRECTOR','operativos:apoyo:ver'),('ADMINISTRADOR_DMIP','operativos:apoyo:ver'),
  -- operativos:apoyo:bandeja  (CARGA + DIRECTOR + ADMINISTRADOR_DMIP)
  ('DMIP_OPERATIVOS','operativos:apoyo:bandeja'),('DMIP_INSPECCIONES','operativos:apoyo:bandeja'),('DMIT_INSTRUCTOR','operativos:apoyo:bandeja'),('DIRECTOR','operativos:apoyo:bandeja'),('ADMINISTRADOR_DMIP','operativos:apoyo:bandeja'),
  -- cuadro:abrir  (ADMINISTRADOR_DMIP + ADMINISTRADOR)
  ('ADMINISTRADOR_DMIP','cuadro:abrir'),('ADMINISTRADOR','cuadro:abrir'),
  -- cuadro:cerrar-reabrir  (DIRECTOR)
  ('DIRECTOR','cuadro:cerrar-reabrir'),
  -- transporte:pendientes:ver / conductores:ver / destinos:ver  (DAF + DIRECTOR)
  ('DAF','transporte:pendientes:ver'),('DIRECTOR','transporte:pendientes:ver'),
  ('DAF','transporte:conductores:ver'),('DIRECTOR','transporte:conductores:ver'),
  ('DAF','transporte:destinos:ver'),('DIRECTOR','transporte:destinos:ver'),
  -- transporte:vehiculos:ver  (DAF + DIRECTOR + ADMINISTRADOR_DAF)
  ('DAF','transporte:vehiculos:ver'),('DIRECTOR','transporte:vehiculos:ver'),('ADMINISTRADOR_DAF','transporte:vehiculos:ver'),
  -- transporte:jornada:ver / asignar / destino:fijar / propios-medios / desasignar  (DAF)
  ('DAF','transporte:jornada:ver'),
  ('DAF','transporte:asignar'),
  ('DAF','transporte:destino:fijar'),
  ('DAF','transporte:propios-medios'),
  ('DAF','transporte:desasignar'),
  -- flota:administrar / mantenimiento  (ADMINISTRADOR_DAF + DAF + ADMINISTRADOR)
  ('ADMINISTRADOR_DAF','flota:administrar'),('DAF','flota:administrar'),('ADMINISTRADOR','flota:administrar'),
  ('ADMINISTRADOR_DAF','flota:mantenimiento'),('DAF','flota:mantenimiento'),('ADMINISTRADOR','flota:mantenimiento'),
  -- flota:capacidad:ver  (DAF + DIRECTOR)
  ('DAF','flota:capacidad:ver'),('DIRECTOR','flota:capacidad:ver'),
  -- flota:capacidad:declarar  (DAF + ADMINISTRADOR_DMIP + ADMINISTRADOR)
  ('DAF','flota:capacidad:declarar'),('ADMINISTRADOR_DMIP','flota:capacidad:declarar'),('ADMINISTRADOR','flota:capacidad:declarar'),
  -- matriz:ver / ordenes:gestionar  (DIRECTOR)
  ('DIRECTOR','matriz:ver'),
  ('DIRECTOR','ordenes:gestionar'),
  -- jornada:ver  (CARGA)
  ('DMIP_OPERATIVOS','jornada:ver'),('DMIP_INSPECCIONES','jornada:ver'),('DMIT_INSTRUCTOR','jornada:ver'),
  -- personal:administrar / directorio:ver  (ADMINISTRADOR_DMIP + ADMINISTRADOR_DMIT + ADMINISTRADOR)
  ('ADMINISTRADOR_DMIP','personal:administrar'),('ADMINISTRADOR_DMIT','personal:administrar'),('ADMINISTRADOR','personal:administrar'),
  ('ADMINISTRADOR_DMIP','personal:directorio:ver'),('ADMINISTRADOR_DMIT','personal:directorio:ver'),('ADMINISTRADOR','personal:directorio:ver'),
  -- catalogos / usuarios / ventanas / roles-auth / roles:ver  (ADMINISTRADOR_DMIP + ADMINISTRADOR)
  ('ADMINISTRADOR_DMIP','catalogos:administrar'),('ADMINISTRADOR','catalogos:administrar'),
  ('ADMINISTRADOR_DMIP','usuarios:administrar'),('ADMINISTRADOR','usuarios:administrar'),
  ('ADMINISTRADOR_DMIP','ventanas:administrar'),('ADMINISTRADOR','ventanas:administrar'),
  ('ADMINISTRADOR_DMIP','roles-auth:administrar'),('ADMINISTRADOR','roles-auth:administrar'),
  ('ADMINISTRADOR_DMIP','roles:ver'),('ADMINISTRADOR','roles:ver'),
  -- parametros:administrar  (ADMINISTRADOR_DMIP + ADMINISTRADOR + ADMINISTRADOR_DMIT)
  ('ADMINISTRADOR_DMIP','parametros:administrar'),('ADMINISTRADOR','parametros:administrar'),('ADMINISTRADOR_DMIT','parametros:administrar'),
  -- permisos:administrar  (ADMINISTRADOR)
  ('ADMINISTRADOR','permisos:administrar')
ON CONFLICT ("rper_rol","rper_permiso") DO NOTHING;
