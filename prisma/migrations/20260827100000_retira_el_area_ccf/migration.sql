-- ═══════════════════════════════════════════════════════════════════════════════
-- SE RETIRA EL ÁREA `CCF`. 2026-08-27, por decisión del negocio.
--
-- Las áreas del personal pasan a ser cuatro: GENERAL, TECNICO, INSTRUCCION y OPERATIVOS.
-- `CCF` venía del esquema inicial, **ningún formulario la admitía y ninguna persona estaba
-- en ella**; era un valor que solo existía en el enumerado.
--
-- NO ROMPE LA HOMOLOGACIÓN CON AUTH, y conviene dejarlo escrito porque se dijo lo
-- contrario al decidirlo. Auth entrega un `tipo` de inspector —`IG`, `IT`, `IS`, `IC`— pero
-- **el sistema nunca lo convirtió en un área**: no hay una sola línea que haga esa
-- conversión. El área se captura a mano en la ficha de P-07, junto con el tipo de
-- contrato, precisamente porque Auth no la sabe.
--
-- POSTGRESQL NO SABE BORRAR UN VALOR DE UN ENUMERADO. Hay que crear el tipo nuevo,
-- reapuntar las cuatro columnas que lo usan y sustituirlo. Es una operación irreversible
-- en caliente, y por eso empieza comprobando que no haya nada que perder.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1 · Nada que perder. Si alguna fila usara CCF, la migración se detiene aquí.
DO $$
DECLARE
  usos integer;
BEGIN
  SELECT
      (SELECT count(*) FROM public.t_funcionario       WHERE func_area           = 'CCF')
    + (SELECT count(*) FROM public.t_formulario_area   WHERE farea_area          = 'CCF')
    + (SELECT count(*) FROM public.t_formulario_prefijo WHERE fpre_area_aplica   = 'CCF')
    + (SELECT count(*) FROM public.t_solicitud_apoyo   WHERE sapo_area_requerida = 'CCF')
    INTO usos;

  IF usos <> 0 THEN
    RAISE EXCEPTION
      'No se retira CCF: hay % fila(s) que la usan. Reasígnelas antes.', usos;
  END IF;
END $$;

-- ── 2 · El tipo nuevo, sin CCF.
CREATE TYPE "e_area_personal_nuevo" AS ENUM ('GENERAL', 'TECNICO', 'INSTRUCCION', 'OPERATIVOS');

-- ── 3 · Las cuatro columnas que lo usan. El `USING` convierte por el texto del valor,
--       que es idéntico en los cuatro que sobreviven.
ALTER TABLE public.t_funcionario
  ALTER COLUMN func_area TYPE "e_area_personal_nuevo"
  USING func_area::text::"e_area_personal_nuevo";

ALTER TABLE public.t_formulario_area
  ALTER COLUMN farea_area TYPE "e_area_personal_nuevo"
  USING farea_area::text::"e_area_personal_nuevo";

ALTER TABLE public.t_formulario_prefijo
  ALTER COLUMN fpre_area_aplica TYPE "e_area_personal_nuevo"
  USING fpre_area_aplica::text::"e_area_personal_nuevo";

ALTER TABLE public.t_solicitud_apoyo
  ALTER COLUMN sapo_area_requerida TYPE "e_area_personal_nuevo"
  USING sapo_area_requerida::text::"e_area_personal_nuevo";

-- ── 4 · Se sustituye el tipo conservando el nombre, para que el esquema siga leyéndose
--       igual que antes y Prisma no vea un tipo con nombre postizo.
DROP TYPE "e_area_personal";
ALTER TYPE "e_area_personal_nuevo" RENAME TO "e_area_personal";

-- ── 5 · Comprobación de cierre: cuatro valores, y ninguno es CCF.
DO $$
DECLARE
  cuantos integer;
BEGIN
  SELECT count(*) INTO cuantos
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'e_area_personal';

  IF cuantos <> 4 THEN
    RAISE EXCEPTION 'e_area_personal quedó con % valores y debía quedar con 4.', cuantos;
  END IF;
END $$;
