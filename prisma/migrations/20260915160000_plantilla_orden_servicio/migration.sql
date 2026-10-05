-- Plantilla editable de la orden de servicio: una sola, global, compartida por todas las
-- ordenes. `plor_apartados` (JSONB) guarda la lista ordenada de apartados que la Direccion
-- edita libremente (anadir, quitar, reordenar) sin cambiar el esquema.

-- CreateTable
CREATE TABLE "t_plantilla_orden" (
    "plor_id" SERIAL NOT NULL,
    "plor_clave" VARCHAR(40) NOT NULL,
    "plor_apartados" JSONB NOT NULL,
    "plor_actualizado_en" TIMESTAMPTZ(3) NOT NULL,
    "plor_actualizado_por" INTEGER,

    CONSTRAINT "t_plantilla_orden_pkey" PRIMARY KEY ("plor_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_plantilla_clave" ON "t_plantilla_orden"("plor_clave");
