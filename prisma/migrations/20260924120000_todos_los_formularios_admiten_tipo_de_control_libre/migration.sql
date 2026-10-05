-- ═══════════════════════════════════════════════════════════════════════════════
-- TODOS LOS FORMULARIOS ADMITEN «OTRO TIPO (ADICIONAL)». 2026-09-24.
--
-- Hasta hoy la captura libre de tipo de control —el campo «Otro tipo (adicional)» del
-- registro (RN-20)— estaba habilitada solo en el 2 (PMO) y el 8 (INSP), por su bandera
-- `form_captura_libre_tipo`. El negocio pidió ofrecerla en los NUEVE: quien registra puede
-- escribir un tipo de control que el catálogo no prevé, en cualquier formulario.
--
-- ES DATO, NO ESQUEMA. La bandera ya existe; solo cambia su valor. El backend valida la
-- captura libre contra esta misma bandera (`permiteCapturaLibre` en `operativos.service`),
-- así que activarla la habilita a la vez en la pantalla y en el servidor.
--
-- Solo se toca la captura de TIPO; la de PUNTO (`form_captura_libre_punto`) NO cambia: sigue
-- gobernada por sus propios catálogos (PV-01), que es una decisión distinta.
--
-- Sobre `transportedb_pruebas` no hay formularios institucionales, así que no toca ninguna
-- fila; las suites siembran los suyos con la bandera que necesiten.
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE public.t_formulario
   SET form_captura_libre_tipo = true
 WHERE form_captura_libre_tipo = false;
