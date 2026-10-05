-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: adicional_del_dia_sobre_un_operativo
-- Responsabilidad: Permitir que un operativo nazca como ADICIONAL de otro ya registrado.
-- Fuente: solicitud del negocio del 2026-08-20 sobre el formulario PMO.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-08-20
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- QUE ES UN ADICIONAL. Un operativo extraordinario que se dispone POR URGENCIA el mismo
-- dia en que se ejecuta, colgando de un operativo del formulario PMO que ya estaba
-- planificado. No es una correccion del original ni una segunda salida programada: es
-- una salida que no existia cuando se armo el cuadro.
--
-- POR QUE UNA AUTORREFERENCIA Y NO UNA TABLA APARTE. Un adicional es un operativo con
-- todo lo que un operativo tiene -horario, zonales, punto, personal, transporte, orden
-- de servicio-. Modelarlo aparte obligaria a duplicar las nueve relaciones y a que cada
-- consulta del cuadro leyera dos tablas. Lo unico que lo distingue es de donde nacio.
--
-- LA COLUMNA ES NULA EN CASI TODAS LAS FILAS, y eso gobierna las tres decisiones de
-- indice que siguen.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────── 1. La columna y su clave foranea ───────────────────
ALTER TABLE "t_operativo" ADD COLUMN "oper_origen_id" INTEGER;

COMMENT ON COLUMN "t_operativo"."oper_origen_id" IS
  'Operativo del que nace este adicional. Nulo en un operativo ordinario.';

-- RESTRICT y no CASCADE, deliberadamente. PV-10 admite el borrado FISICO de un operativo
-- sin ordenes emitidas; si el padre arrastrara a su adicional, desapareceria sin dejar
-- rastro la unica evidencia de que ese dia se dispuso una salida fuera del cuadro. El
-- servicio comprueba antes que no tenga adicionales y lo explica con palabras; esta
-- restriccion es la red por si algun dia se borra por otro camino.
ALTER TABLE "t_operativo"
  ADD CONSTRAINT "fk_operativo_origen"
  FOREIGN KEY ("oper_origen_id") REFERENCES "t_operativo"("oper_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Un operativo no puede ser adicional de si mismo. La regla hermana -un adicional no
-- puede tener adicionales- involucra DOS filas y no cabe en un CHECK: vive en el
-- servicio, junto al mensaje que el funcionario lee.
ALTER TABLE "t_operativo"
  ADD CONSTRAINT "ck_operativo_origen"
  CHECK ("oper_origen_id" IS NULL OR "oper_origen_id" <> "oper_id");

-- ─────────────────── 2. El secuencial, ahora en dos series ───────────────────
--
-- EL ADICIONAL ENUMERA APARTE. Decision del negocio del 2026-08-20: el primer adicional
-- del dia es el 001 aunque el formulario lleve seis operativos ordinarios. Los dos
-- codigos conviven sin ambiguedad porque el prefijo los separa -OCPMO-001 frente a
-- OCAPMO-001- y uq_operativo_cuad_ident sigue garantizando que ningun identificador se
-- repita dentro de la jornada.
--
-- POR ESO EL UNICO DE TRES COLUMNAS SE PARTE EN DOS PARCIALES. Mantenerlo entero
-- prohibiria que el adicional 001 coexistiera con el ordinario 001 del mismo formulario,
-- que es exactamente lo que el negocio pidio. Y suprimirlo sin mas dejaria RN-12 sin
-- garantia: es esta restriccion, y no el conteo del repositorio, la que impide que dos
-- registros simultaneos a las 14H50 emitan el mismo secuencial.
DROP INDEX IF EXISTS "uq_operativo_cuad_form_sec";

CREATE UNIQUE INDEX "uq_operativo_cuad_form_sec"
  ON "t_operativo" ("cuad_id", "form_id", "oper_secuencial")
  WHERE "oper_origen_id" IS NULL;

CREATE UNIQUE INDEX "uq_operativo_cuad_form_sec_adic"
  ON "t_operativo" ("cuad_id", "form_id", "oper_secuencial")
  WHERE "oper_origen_id" IS NOT NULL;

-- ─────────────────── 3. El indice de la clave foranea ───────────────────
--
-- PARCIAL, por el mismo motivo que idx_operativo_conductor: la inmensa mayoria de los
-- operativos no son adicionales, y un indice completo pagaria el mantenimiento de todas
-- esas filas nulas para responder consultas que solo preguntan por las otras.
--
-- Hace falta porque la clave foranea es RESTRICT: sin el, borrar un operativo obliga a
-- recorrer t_operativo entera para comprobar que ningun adicional lo referencia.
CREATE INDEX "idx_operativo_origen"
  ON "t_operativo" ("oper_origen_id")
  WHERE "oper_origen_id" IS NOT NULL;

-- El planificador acaba de recibir tres indices nuevos sobre la tabla que mas se
-- consulta. Sin estadisticas frescas seguiria eligiendo el plan anterior.
ANALYZE "t_operativo";
