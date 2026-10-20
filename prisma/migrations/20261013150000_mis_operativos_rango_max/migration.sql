-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Archivo: migration.sql (20261013150000_mis_operativos_rango_max)
-- Responsabilidad: Sembrar el rango maximo de dias que «Mis operativos» consulta de una vez.
--
-- Solo datos, aditiva e idempotente: ON CONFLICT DO NOTHING conserva el valor si ya existe
-- (un administrador pudo haberlo cambiado). Regla 2 de CLAUDE.md: el umbral es un parametro,
-- no una constante. Lo lee `OperativosService.parametrosDeRango`; si la fila faltara, rige 31.

BEGIN;

INSERT INTO public.t_parametro_politica
  (para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en)
VALUES
  ('MIS_OPERATIVOS_RANGO_MAX_DIAS', '31', 'ENTERO', 'Mis operativos. Máximo de días que se pueden consultar de una vez con el filtro Desde–Hasta (ambos inclusive).', 'días', '1', '366', NULL, now())
ON CONFLICT DO NOTHING;

COMMIT;
