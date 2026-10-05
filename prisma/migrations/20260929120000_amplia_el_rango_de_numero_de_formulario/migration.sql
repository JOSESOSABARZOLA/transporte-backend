-- AMPLÍA EL RANGO DE form_numero DE 1..9 A 1..99 (2026-09-29).
--
-- El Cuadro nació acotado a NUEVE formularios institucionales, y `ck_formulario_numero` lo fijaba en
-- BETWEEN 1 AND 9 (migración 20260805134100). Se amplía a 1..99 para poder agregar un décimo formulario
-- —y los siguientes— como PURO DATO (un INSERT en `t_formulario` y sus satélites), sin necesidad de otra
-- migración de esquema. Se conserva una cota superior por sanidad, para no admitir números absurdos.
--
-- Es ADITIVA y no destructiva: los formularios 1..9 existentes siguen cumpliendo la nueva restricción,
-- así que ninguna fila deja de ser válida. Aplica igual en `transportedb` y en `transportedb_pruebas`
-- (es una restricción de esquema, no una siembra de datos): no lleva la guarda de `current_database()`.
ALTER TABLE public.t_formulario DROP CONSTRAINT IF EXISTS ck_formulario_numero;

ALTER TABLE public.t_formulario
  ADD CONSTRAINT ck_formulario_numero CHECK (form_numero BETWEEN 1 AND 99);
