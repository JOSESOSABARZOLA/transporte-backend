-- Cobertura mensual por turnos del personal de Instruccion.
-- El Funcionario gana zona (FK a t_zonal) y denominacion; se crea t_cobertura_turno con un
-- registro por (funcionario, fecha). Las ausencias NO se guardan aqui: se derivan de
-- t_disponibilidad, su fuente unica de verdad.

-- CreateEnum
CREATE TYPE "e_denominacion_instruccion" AS ENUM ('LIDER_ZONAL', 'INSTRUCTOR_METROPOLITANO', 'AUXILIAR_FLAGRANCIA');

-- CreateEnum
CREATE TYPE "e_estado_turno" AS ENUM ('DIURNO', 'NOCTURNO', 'DESCANSO');

-- AlterTable
ALTER TABLE "t_funcionario" ADD COLUMN     "func_denominacion" "e_denominacion_instruccion",
ADD COLUMN     "func_zonal_id" INTEGER;

-- CreateTable
CREATE TABLE "t_cobertura_turno" (
    "cotu_id" SERIAL NOT NULL,
    "cotu_funcionario_id" INTEGER NOT NULL,
    "cotu_fecha" DATE NOT NULL,
    "cotu_estado" "e_estado_turno" NOT NULL,
    "cotu_registrado_por" INTEGER,
    "cotu_creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cotu_actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_cobertura_turno_pkey" PRIMARY KEY ("cotu_id")
);

-- CreateIndex
CREATE INDEX "idx_cobertura_fecha" ON "t_cobertura_turno"("cotu_fecha");

-- CreateIndex
CREATE UNIQUE INDEX "uq_cobertura_funcionario_fecha" ON "t_cobertura_turno"("cotu_funcionario_id", "cotu_fecha");

-- AddForeignKey
ALTER TABLE "t_funcionario" ADD CONSTRAINT "fk_funcionario_zonal" FOREIGN KEY ("func_zonal_id") REFERENCES "t_zonal"("zona_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_cobertura_turno" ADD CONSTRAINT "fk_cobertura_funcionario" FOREIGN KEY ("cotu_funcionario_id") REFERENCES "t_funcionario"("func_id") ON DELETE CASCADE ON UPDATE CASCADE;
