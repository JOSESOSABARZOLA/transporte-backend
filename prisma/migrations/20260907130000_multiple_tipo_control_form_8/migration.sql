-- Varios tipos de control por operativo, SOLO en el formulario que lo admite (form 8).
--
-- Nuevo join `t_operativo_tipo_control` (molde de `t_operativo_institucion`). Los demas
-- formularios siguen con un unico tipo en `t_operativo.tico_id`; el join queda vacio para
-- ellos. Un flag por formulario decide quien admite varios. Se relaja `ck_operativo_tipo`.

-- 1) El join operativo <-> tipo de control.
CREATE TABLE "t_operativo_tipo_control" (
  "oper_id" INTEGER NOT NULL,
  "tico_id" INTEGER NOT NULL,
  CONSTRAINT "t_operativo_tipo_control_pkey" PRIMARY KEY ("oper_id", "tico_id")
);

CREATE INDEX "idx_oper_tico_tipo" ON "t_operativo_tipo_control"("tico_id");

ALTER TABLE "t_operativo_tipo_control"
  ADD CONSTRAINT "fk_oper_tico_operativo"
  FOREIGN KEY ("oper_id") REFERENCES "t_operativo"("oper_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "t_operativo_tipo_control"
  ADD CONSTRAINT "fk_oper_tico_tipo"
  FOREIGN KEY ("tico_id") REFERENCES "t_tipo_control"("tico_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2) Flag por formulario. Verdadero solo en el 8 · INSPECCIONES.
ALTER TABLE "t_formulario"
  ADD COLUMN "form_tipo_control_multiple" BOOLEAN NOT NULL DEFAULT false;

UPDATE "t_formulario" SET "form_tipo_control_multiple" = true WHERE "form_numero" = 8;

-- 3) Relajar el CHECK: de "EXACTAMENTE uno de {tico_id, tipo_libre}" a "A LO SUMO uno".
--    Un operativo del 8 lleva sus tipos en el join (tico_id NULL) y puede ademas tener un
--    tipo libre; ambos nulos es valido para el (los tipos estan en el join). El "al menos un
--    tipo" ya no lo puede ver el CHECK y pasa al dominio (ClasificacionControl), con pruebas.
ALTER TABLE "t_operativo" DROP CONSTRAINT "ck_operativo_tipo";
ALTER TABLE "t_operativo"
  ADD CONSTRAINT "ck_operativo_tipo"
  CHECK (NOT ("tico_id" IS NOT NULL AND "oper_tipo_libre" IS NOT NULL));
