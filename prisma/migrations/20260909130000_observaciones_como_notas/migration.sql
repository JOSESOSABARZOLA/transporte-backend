-- Las observaciones del operativo pasan de UN campo unico de texto a NOTAS INDEPENDIENTES
-- (bitacora append-only, 2026-09-09): cada nota es una fila, con quien la escribio y cuando.
-- La matriz las pinta como notas separadas.

-- 1) La tabla de notas. Molde de t_operativo_institucion + la traza de autor de t_operativo.
CREATE TABLE "t_operativo_observacion" (
    "oobs_id" SERIAL NOT NULL,
    "oper_id" INTEGER NOT NULL,
    "oobs_texto" TEXT NOT NULL,
    "oobs_creado_por_rol" "e_rol_departamental" NOT NULL,
    "oobs_creado_por" INTEGER NOT NULL,
    "oobs_creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "t_operativo_observacion_pkey" PRIMARY KEY ("oobs_id")
);

CREATE INDEX "idx_observacion_operativo" ON "t_operativo_observacion"("oper_id");

ALTER TABLE "t_operativo_observacion"
  ADD CONSTRAINT "fk_observacion_operativo"
  FOREIGN KEY ("oper_id") REFERENCES "t_operativo"("oper_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) Migrar lo ya escrito: cada `oper_observaciones` no vacio se vuelve una primera nota, con
--    el autor y la fecha del propio operativo (es lo unico que se sabe de su origen).
INSERT INTO "t_operativo_observacion"
  ("oper_id", "oobs_texto", "oobs_creado_por_rol", "oobs_creado_por", "oobs_creado_en")
SELECT o."oper_id", o."oper_observaciones", o."oper_creado_por_rol", o."oper_creado_por", o."oper_creado_en"
  FROM "t_operativo" o
 WHERE o."oper_observaciones" IS NOT NULL
   AND btrim(o."oper_observaciones") <> '';

-- 3) Retirar el campo unico: la unica fuente pasa a ser la tabla de notas.
ALTER TABLE "t_operativo" DROP COLUMN "oper_observaciones";
