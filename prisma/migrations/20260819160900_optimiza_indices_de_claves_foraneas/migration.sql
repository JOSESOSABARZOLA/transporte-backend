-- Microservicio: transporte
-- Modulo: Cuadro de Colores
-- Archivo: migration.sql
-- Responsabilidad: Retirar dos indices redundantes y cubrir las claves foraneas que
--                  obligan a recorrer t_operativo entera.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-08-19
--
-- ORIGEN: revision de la base con las reglas de rendimiento de PostgreSQL, 2026-08-19.
-- Se descartaron deliberadamente los hallazgos que no aplican a este sistema; lo que
-- sigue es lo que si tiene efecto medible cuando la base deje de estar vacia.
--
-- POR QUE AHORA, CON LA BASE VACIA. Precisamente por eso: crear un indice sobre una
-- tabla con datos toma un bloqueo de escritura, y sobre t_operativo eso significaria
-- detener el registro del cuadro del dia siguiente. Hoy es instantaneo.

-- ═══════════════════ 1. Dos indices que sobraban ═══════════════════
--
-- Los dos duplicaban EXACTAMENTE las columnas de una restriccion unica de su misma
-- tabla. Una restriccion unica ya crea su indice, de modo que el gemelo no podia
-- acelerar ninguna consulta y si encarecia cada insercion y cada actualizacion.
--
-- El de t_operativo era identico columna por columna. El de t_historial_jornada
-- declaraba `fecha DESC`, y se comprobo que la direccion tampoco lo justifica: la
-- unica consulta ordenada es `WHERE funcionarioId = X ORDER BY fecha DESC`
-- -historial-jornada.repository.ts:133- y el indice unico la resuelve recorriendo el
-- btree hacia atras, que es algo que PostgreSQL hace sin coste.

-- DropIndex
DROP INDEX "idx_operativo_cuad_form";

-- DropIndex
DROP INDEX "idx_historial_func_fecha";

-- ═══════════════════ 2. Claves foraneas sin cubrir ═══════════════════
--
-- PostgreSQL NO indexa las claves foraneas por su cuenta. Las tres que siguen son
-- RESTRICT o CASCADE, y sin indice cada comprobacion de integridad recorre la tabla
-- referenciante completa.
--
-- El caso que mas duele es t_operativo: es la tabla que crece todos los dias, y sin
-- estos indices DESACTIVAR UN TIPO DE CONTROL desde P-08 obliga a recorrerla entera
-- para comprobar que ningun operativo lo referencia.
--
-- Se dejaron fuera a proposito las de t_formulario_institucion, t_formulario_punto y
-- t_formulario_tipo_control: son catalogo, entre 15 y 47 filas, y no crecen. Ahi el
-- coste de escritura del indice superaria al ahorro.

-- CreateIndex
CREATE INDEX "idx_operativo_tipo_control" ON "t_operativo"("tico_id");

-- CreateIndex
CREATE INDEX "idx_oper_inst_institucion" ON "t_operativo_institucion"("inst_id");

-- CreateIndex
CREATE INDEX "idx_solicitud_operativo" ON "t_solicitud_apoyo"("oper_id");

-- ═══════════════════ 3. El vehiculo, y es PARCIAL ═══════════════════
--
-- Va aparte y en SQL crudo porque Prisma no expresa predicados de indice. NO se declara
-- en schema.prisma: si se declarara, Prisma no reconoceria el WHERE, lo reportaria como
-- indice eliminado y la siguiente migracion lo recrearia COMPLETO, destruyendo el
-- predicado en silencio. Es la misma razon por la que los otros cinco parciales tampoco
-- estan alli. Ver la cabecera de schema.prisma y prisma/README.md.
--
-- ES PARCIAL PORQUE EL DOMINIO LO PIDE: conductor y vehiculo NACEN NULOS al registrar el
-- operativo y solo la DAF los completa, asi que la mayoria de las filas tienen vehi_id
-- nulo mientras esa direccion no interviene. Indexarlas seria pagar por filas que nunca
-- se consultan. Es el mismo criterio de idx_operativo_conductor.
--
-- Queda anotado en INDICES_PARCIALES_ESPERADOS de prisma/verificar-objetos.ts, que es lo
-- que detecta si una migracion futura le quita el predicado.

CREATE INDEX "idx_operativo_vehiculo"
  ON "t_operativo" ("vehi_id")
  WHERE "vehi_id" IS NOT NULL;

-- ═══════════════════ 4. Los cuatro ALTER de siempre ═══════════════════
--
-- Los genera Prisma al tocar cualquier enumerado, y son NO-OPS: los cuatro valores por
-- defecto ya existen en la base con exactamente ese valor. Se conservan tal como Prisma
-- los emite para que una regeneracion futura no produzca diferencias, igual que en la
-- migracion 20260817194510.

-- AlterTable
ALTER TABLE "t_cuadro_diario" ALTER COLUMN "cuad_estado" SET DEFAULT 'BORRADOR';

-- AlterTable
ALTER TABLE "t_formulario" ALTER COLUMN "form_politica_vehiculo" SET DEFAULT 'CONDICIONAL';

-- AlterTable
ALTER TABLE "t_operativo" ALTER COLUMN "oper_estado_transporte" SET DEFAULT 'PENDIENTE';

-- AlterTable
ALTER TABLE "t_solicitud_apoyo" ALTER COLUMN "sapo_estado" SET DEFAULT 'SOLICITADA';
