-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: agrega_captura_libre_al_formulario
-- Responsabilidad: Registrar en que formularios se ofrece la opcion ADICIONALES.
-- Fuente: RN-20 de docs/FASE2-documentacion-funcional.md seccion 8.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-08-05
--
-- POR QUE SE AGREGA UNA COLUMNA AL MODELO APROBADO.
--
-- RN-20 exige que los catalogos "que lo prevean" incluyan la opcion ADICIONALES con
-- captura de texto libre. El modelo aprobado resuelve DONDE se guarda ese texto
-- (t_operativo.oper_tipo_libre) pero no EN QUE FORMULARIOS se ofrece la opcion, y ese
-- dato no es derivable de ninguna otra columna:
--
--   · ADICIONALES no es una fila de t_tipo_control. INV-08 lo dice explicitamente:
--     "el tipo de control pertenece al catalogo del formulario, SALVO captura como
--     adicional". Por eso la semilla de M-03 lo excluye del catalogo.
--   · t_formulario_tipo_control solo enlaza tipos reales, de modo que la delimitacion
--     tampoco puede expresarlo.
--
-- El valor NO se infiere: el insumo aprobado (Hoja2) trae ADICIONALES unicamente en
-- los formularios 2 (PMO) y 8 (INSP). Es un dato de la fuente, no una suposicion.
--
-- La columna nace con DEFAULT false y t_formulario esta vacia (PV-25 y PV-26), asi que
-- esta migracion no altera ningun dato existente.

ALTER TABLE "t_formulario"
  ADD COLUMN "form_permite_captura_libre" BOOLEAN NOT NULL DEFAULT false;
