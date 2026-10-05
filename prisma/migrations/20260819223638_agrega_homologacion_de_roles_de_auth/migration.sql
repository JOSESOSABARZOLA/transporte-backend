-- Microservicio: transporte
-- Modulo: Cuadro de Colores
-- Archivo: migration.sql
-- Responsabilidad: Registrar la correspondencia entre los roles de Auth central y los de
--                  este modulo, y sembrarla con los seis que el negocio creo.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-08-19
--
-- POR QUE. Auth nombra sus roles "Transporte - Operativos"; este modulo los llama
-- DMIP_OPERATIVOS. Hasta hoy la equivalencia vivia como comentario en el JSON de la
-- semilla, y quien daba de alta a alguien la copiaba a ojo. Equivocarse hacia DIRECTOR
-- significa ver la matriz consolidada entera, y nada lo habria detectado.
--
-- LA LLAVE ES rola_id_auth Y NO EL NOMBRE. Un nombre para mostrar se edita desde la
-- pantalla de administracion de Auth. El dia que alguien escriba "Transporte - Direccion"
-- el modulo dejaria de reconocer al Director SIN QUE NADA LO AVISE. El numero es estable;
-- el nombre se guarda solo para mostrar y auditar.
--
-- QUE RESUELVE Y QUE NO. Si Auth crea un rol que corresponde a uno que YA existe aqui
-- -por ejemplo, separar la DAF en dos zonas-, es un INSERT: sin migracion y sin desplegar.
-- Pero un actor genuinamente nuevo -un "Auditor" que solo lee- SI exige migracion, porque
-- hay que definir que formularios posee, si tiene ventana de carga y que le permiten las
-- cuatro guardas. Que eso no se pueda hacer con una fila es una propiedad, no un defecto.
--
-- Los cuatro ALTER de abajo los genera Prisma al tocar cualquier enumerado y son NO-OPS:
-- los valores por defecto ya existen con exactamente ese valor. Se conservan tal como los
-- emite, igual que en las migraciones 20260817194510 y 20260819160900.

-- AlterTable
ALTER TABLE "t_cuadro_diario" ALTER COLUMN "cuad_estado" SET DEFAULT 'BORRADOR';

-- AlterTable
ALTER TABLE "t_formulario" ALTER COLUMN "form_politica_vehiculo" SET DEFAULT 'CONDICIONAL';

-- AlterTable
ALTER TABLE "t_operativo" ALTER COLUMN "oper_estado_transporte" SET DEFAULT 'PENDIENTE';

-- AlterTable
ALTER TABLE "t_solicitud_apoyo" ALTER COLUMN "sapo_estado" SET DEFAULT 'SOLICITADA';

-- ─────────────── La tabla ───────────────

CREATE TABLE "t_rol_auth" (
    "rola_id_auth" INTEGER NOT NULL,
    "rola_nombre_auth" VARCHAR(120) NOT NULL,
    "rola_rol" "e_rol_departamental" NOT NULL,
    "rola_subsistema" INTEGER NOT NULL DEFAULT 11,
    "rola_activo" BOOLEAN NOT NULL DEFAULT true,
    "rola_creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rola_actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "t_rol_auth_pkey" PRIMARY KEY ("rola_id_auth")
);

CREATE INDEX "idx_rol_auth_rol" ON "t_rol_auth"("rola_rol");

-- Prisma no expresa predicados CHECK. Dos filas activas no pueden apuntar al mismo rol
-- del modulo por caminos distintos sin que alguien lo decida a proposito, pero SI puede
-- haber varias -Auth podria separar la DAF por zonas-, asi que no se restringe. Lo que si
-- se acota es el subsistema: este modulo pertenece al 11, y una fila de otro subsistema
-- seria un error de captura.
ALTER TABLE "t_rol_auth"
  ADD CONSTRAINT "ck_rol_auth_subsistema" CHECK ("rola_subsistema" > 0);

-- ─────────────── Los seis roles que el negocio creo el 2026-08-17 ───────────────
--
-- LA CORRESPONDENCIA LA ENTREGO EL NEGOCIO, no se infirio: cada rol de Auth nombra su
-- contraparte de forma inequivoca. Se traslada aqui desde prisma/insumos/usuarios-cuadro.json,
-- que se retiro el mismo dia.
--
-- FALTA EL SEPTIMO. El Cuadro de Colores tiene siete roles y Auth solo creo los seis
-- departamentales: no existe "Transporte - Funcionario". Sin un rol de Transporte, quien
-- recibe una orden de servicio NO PUEDE elegir el modulo en el portal, y P-06 queda
-- inaccesible. Esta pedido a Auth central y es la incidencia F-01.

INSERT INTO "t_rol_auth" ("rola_id_auth", "rola_nombre_auth", "rola_rol", "rola_subsistema", "rola_actualizado_en") VALUES
  (53, 'Transporte - Operativos',      'DMIP_OPERATIVOS',   11, CURRENT_TIMESTAMP),
  (54, 'Transporte - DMIP Inspeccion', 'DMIP_INSPECCIONES', 11, CURRENT_TIMESTAMP),
  (55, 'Transporte - DMIT Instructor', 'DMIT_INSTRUCTOR',   11, CURRENT_TIMESTAMP),
  (56, 'Transporte - DAF',             'DAF',               11, CURRENT_TIMESTAMP),
  (57, 'Transporte - Director',        'DIRECTOR',          11, CURRENT_TIMESTAMP),
  (58, 'Transporte - Administrador',   'ADMINISTRADOR',     11, CURRENT_TIMESTAMP)
ON CONFLICT ("rola_id_auth") DO NOTHING;
