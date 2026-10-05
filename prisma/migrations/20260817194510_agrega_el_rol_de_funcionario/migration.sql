-- Microservicio: transporte
-- Modulo: Cuadro de Colores
-- Archivo: migration.sql
-- Responsabilidad: Agregar el rol FUNCIONARIO al enumerado de roles del modulo.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-08-17
--
-- CIERRA F-01. El frontend ofrece el perfil «Funcionario de campo» desde M-21, con el
-- identificador 7, y el servidor no lo conocia: toda peticion suya recibia 401 y la
-- pantalla P-06 «Mis ordenes» no se podia usar por nadie. Ver 17_KNOWN_ISSUES.md.
--
-- NO ES UN ROL DEPARTAMENTAL, aunque viva en el mismo enumerado. Los seis anteriores
-- poseen formularios, tienen ventana de carga y escriben en el cuadro. Este no posee
-- ninguno, NO recibe ventana de carga y no escribe nada: su unico acceso es
-- GET /ordenes-servicio/mias, que a proposito no lleva @Roles porque ahi el filtro no
-- es el rol sino la identidad. Cada quien ve las suyas.
--
-- POR ESO NO SE SIEMBRA UNA VENTANA PARA EL. t_ventana_carga sigue con seis filas, una
-- por rol que escribe. Agregarle una sugeriria que hay algo que puede cargar.

-- AlterEnum
ALTER TYPE "e_rol_departamental" ADD VALUE 'FUNCIONARIO';

-- Los cuatro ALTER que siguen los genera Prisma al tocar cualquier enumerado, y son
-- NO-OPS: los cuatro valores por defecto ya existen en la base con exactamente ese
-- valor, comprobado contra information_schema antes de aplicar. Se conservan tal como
-- Prisma los emite para que una regeneracion futura no produzca diferencias.

-- AlterTable
ALTER TABLE "t_cuadro_diario" ALTER COLUMN "cuad_estado" SET DEFAULT 'BORRADOR';

-- AlterTable
ALTER TABLE "t_formulario" ALTER COLUMN "form_politica_vehiculo" SET DEFAULT 'CONDICIONAL';

-- AlterTable
ALTER TABLE "t_operativo" ALTER COLUMN "oper_estado_transporte" SET DEFAULT 'PENDIENTE';

-- AlterTable
ALTER TABLE "t_solicitud_apoyo" ALTER COLUMN "sapo_estado" SET DEFAULT 'SOLICITADA';
