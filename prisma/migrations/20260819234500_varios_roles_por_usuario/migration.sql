-- Microservicio: transporte
-- Modulo: Cuadro de Colores
-- Archivo: migration.sql
-- Responsabilidad: Permitir que una persona tenga varios roles del Cuadro de Colores.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-08-19
--
-- POR QUE. Auth central admite asignar VARIOS roles de Transporte a la misma persona
-- -de uno a los seis-, y este modulo solo podia representar uno: `usua_rol` era una
-- columna. Quien tuviera dos entraba con el que alguien hubiera escrito aqui, no con los
-- suyos.
--
-- SEMANTICA ACORDADA CON EL NEGOCIO EL 2026-08-19: varios A LA VEZ, no uno por sesion.
-- Quien tenga DAF y DMIP Operativos ve la UNION de los formularios de ambos. No es lo que
-- modela el portal -que hace elegir uno en su pantalla "Seleccione un rol"- pero es lo
-- unico construible mientras el canje no transmita cual se eligio, que es el desajuste
-- D-5 pendiente de Auth central. El dia que lo transmita, esta tabla sigue valiendo: lo
-- que cambiaria es que la sesion se quedaria con uno de los que la persona tiene.
--
-- SE PRESERVAN LOS ROLES EXISTENTES. El paso 2 traslada cada `usua_rol` a una fila de la
-- tabla nueva ANTES de eliminar la columna: es el patron expandir-migrar-contraer, el
-- mismo de la migracion 20260811120000. Sin ese paso intermedio, las cuentas quedarian
-- sin ningun rol y nadie podria entrar.

-- ═══════════════ 1. La tabla ═══════════════

CREATE TABLE "t_usuario_rol" (
    "usua_id" INTEGER NOT NULL,
    "usro_rol" "e_rol_departamental" NOT NULL,
    "usro_creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_usuario_rol_pkey" PRIMARY KEY ("usua_id","usro_rol")
);

-- La clave primaria es el par, asi que un rol no se puede asignar dos veces a la misma
-- persona: lo impide la estructura, no una comprobacion que alguien pueda olvidar.

CREATE INDEX "idx_usuario_rol_rol" ON "t_usuario_rol"("usro_rol");

ALTER TABLE "t_usuario_rol"
  ADD CONSTRAINT "fk_usuario_rol_usuario"
  FOREIGN KEY ("usua_id") REFERENCES "t_usuario"("usua_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════ 2. Trasladar lo que ya existe ═══════════════
--
-- ESTE PASO ES EL QUE NO SE PUEDE OMITIR. Va antes del DROP COLUMN, y sin el las cuentas
-- quedarian sin rol: la aplicacion arrancaria, el ingreso resolveria la cuenta, y esa
-- persona no veria ningun formulario ni podria hacer nada. El fallo no apareceria al
-- migrar sino al intentar trabajar.

INSERT INTO "t_usuario_rol" ("usua_id", "usro_rol")
SELECT "usua_id", "usua_rol" FROM "t_usuario"
ON CONFLICT DO NOTHING;

-- ═══════════════ 3. Retirar la columna ═══════════════

DROP INDEX IF EXISTS "idx_usuario_rol";
DROP INDEX IF EXISTS "t_usuario_usua_rol_usua_activo_idx";

CREATE INDEX "idx_usuario_activo" ON "t_usuario"("usua_activo");

ALTER TABLE "t_usuario" DROP COLUMN "usua_rol";
