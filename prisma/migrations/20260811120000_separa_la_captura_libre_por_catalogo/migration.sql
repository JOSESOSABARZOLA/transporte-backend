-- Microservicio: transporte
-- Modulo: Cuadro de Colores
-- Archivo: migration.sql
-- Responsabilidad: Separar la captura libre en una bandera por catalogo.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-08-11
--
-- RN-20 dice «los CATALOGOS que lo preven»: la captura libre es propiedad de cada
-- catalogo, no del formulario. La columna unica form_permite_captura_libre no podia
-- expresarlo, y la interfaz la aplicaba a los dos desplegables: ofrecia ADICIONALES en
-- el punto de encuentro, donde el insumo aprobado no lo contempla en ninguno de los
-- nueve formularios.
--
-- EL VALOR EXISTENTE SE TRASLADA AL TIPO DE CONTROL, que es lo que significaba: los
-- formularios 2 (PMO) y 8 (INSP) lo tienen porque su lista de tiposControl incluye
-- ADICIONALES. El punto arranca en falso en los nueve, como el insumo indica.

ALTER TABLE "t_formulario"
  ADD COLUMN "form_captura_libre_punto" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "form_captura_libre_tipo"  BOOLEAN NOT NULL DEFAULT false;

UPDATE "t_formulario"
  SET "form_captura_libre_tipo" = "form_permite_captura_libre";

ALTER TABLE "t_formulario"
  DROP COLUMN "form_permite_captura_libre";
