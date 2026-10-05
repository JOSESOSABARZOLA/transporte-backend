-- ═══════════════════════════════════════════════════════════════════════════════
-- EN LOS CATALOGOS NO QUEDA NADA QUE NO ESTE EN EL INSUMO DEL 2026-09-02
--
-- La migracion anterior cargo la matriz completa pero dejo en pie filas anteriores. El
-- negocio decidio que en los catalogos no debe quedar nada que no figure en la
-- organizacion entregada, y esta migracion lo hace cumplir.
--
-- ESTA ESCRITA PARA UNA BASE QUE NO ES LA DE DESARROLLO, y esa es la diferencia con su
-- primera version. Aquella nombraba filas concretas y comprobaba cantidades concretas
-- —«tres operativos usan AMC Matriz»—, que son datos de UNA base. En produccion, donde
-- el historico es otro, esas comprobaciones habrian abortado el despliegue a mitad.
--
-- Aqui se retira por REGLA, no por nombre, y se comprueban invariantes que se cumplen
-- con cualquier dato de partida:
--
--   · Un formulario distrital (4, 5, 6 y 9) solo alcanza la zonal DMQ; los otros cinco
--     nunca la alcanzan. Todo vinculo que incumpla eso se retira, sea cual sea.
--   · Un punto que se queda sin ningun formulario deja de ofrecerse. Si ningun operativo
--     lo usa se borra; si alguno lo usa se desactiva y la fila se conserva.
--
-- LO SEGUNDO NO ES UNA CONCESION: es la llave foranea. `fk_operativo_punto` es
-- ON DELETE RESTRICT, de modo que la base misma impide borrar un punto en uso, y RF-058
-- dice lo mismo con palabras: un valor registrado en cuadros historicos se desactiva, no
-- se elimina. Borrarlo seria falsificar operativos ya ejecutados.
--
-- LA UNICA FILA QUE SE NOMBRA es «Eloy Alfaro» de la Zonal Eloy Alfaro, que no incumple
-- la regla de ambito —su zonal es correcta para el formulario 1— pero tampoco figura en
-- el insumo. Si en la base de destino no existe, el DELETE no afecta a ninguna fila y no
-- pasa nada: ninguna comprobacion depende de ella.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────────
-- 1 · «Eloy Alfaro» de la Zonal Eloy Alfaro. No esta en el insumo.
--     El NOT EXISTS no es adorno: si tuviera operativos, esta migracion debe negarse a
--     borrarla en vez de romper la llave foranea.
-- ───────────────────────────────────────────────────────────────────────────────

DELETE FROM t_formulario_punto b
USING t_punto_encuentro e, t_zonal z
WHERE b.pcto_id      = e.pcto_id
  AND z.zona_id      = e.zona_id
  AND e.pcto_nombre  = 'Eloy Alfaro'
  AND z.zona_codigo  = 'ELOY_ALFARO'
  AND NOT EXISTS (SELECT 1 FROM t_operativo o WHERE o.pcto_id = e.pcto_id);

DELETE FROM t_punto_encuentro e
USING t_zonal z
WHERE z.zona_id     = e.zona_id
  AND e.pcto_nombre = 'Eloy Alfaro'
  AND z.zona_codigo = 'ELOY_ALFARO'
  AND NOT EXISTS (SELECT 1 FROM t_operativo o WHERE o.pcto_id = e.pcto_id);

-- ───────────────────────────────────────────────────────────────────────────────
-- 2 · Todo vinculo cuya zonal esta fuera del ambito de su formulario. Por regla, no
--     por nombre: asi alcanza tambien a lo que tenga la base de destino y no la mia.
-- ───────────────────────────────────────────────────────────────────────────────

DELETE FROM t_formulario_punto b
USING t_formulario f, t_punto_encuentro e, t_zonal z
WHERE f.form_id = b.form_id
  AND e.pcto_id = b.pcto_id
  AND z.zona_id = e.zona_id
  AND z.zona_es_dmq <> (f.form_numero IN (4, 5, 6, 9));

-- ───────────────────────────────────────────────────────────────────────────────
-- 3 · Los puntos que se quedaron sin ningun formulario. Sin vinculos no aparecen en
--     ninguna cascada, de modo que ya no se ofrecen; lo que falta es que no figuren
--     tampoco como vigentes.
-- ───────────────────────────────────────────────────────────────────────────────

UPDATE t_punto_encuentro e
SET pcto_activo = FALSE
WHERE e.pcto_activo
  AND NOT EXISTS (SELECT 1 FROM t_formulario_punto b WHERE b.pcto_id = e.pcto_id);

DELETE FROM t_punto_encuentro e
WHERE NOT EXISTS (SELECT 1 FROM t_formulario_punto b WHERE b.pcto_id = e.pcto_id)
  AND NOT EXISTS (SELECT 1 FROM t_operativo o WHERE o.pcto_id = e.pcto_id);

-- ───────────────────────────────────────────────────────────────────────────────
-- 4 · Comprobacion. Cuatro invariantes, ninguna atada a un dato de una base concreta.
-- ───────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  fuera_de_ambito INT;
  sin_formulario  INT;
  huerfanos       INT;
  sin_puntos      INT;
BEGIN
  -- 4.1 Ningun formulario alcanza una zonal que no le corresponde.
  SELECT count(*) INTO fuera_de_ambito
  FROM t_formulario_punto b
  JOIN t_formulario      f ON f.form_id = b.form_id
  JOIN t_punto_encuentro e ON e.pcto_id = b.pcto_id
  JOIN t_zonal           z ON z.zona_id = e.zona_id
  WHERE z.zona_es_dmq <> (f.form_numero IN (4, 5, 6, 9));

  IF fuera_de_ambito > 0 THEN
    RAISE EXCEPTION 'Quedan % vinculos con la zonal fuera del ambito del formulario.', fuera_de_ambito;
  END IF;

  -- 4.2 Ningun punto vigente se ofrece sin pertenecer a algun formulario.
  SELECT count(*) INTO sin_formulario
  FROM t_punto_encuentro e
  WHERE e.pcto_activo
    AND NOT EXISTS (SELECT 1 FROM t_formulario_punto b WHERE b.pcto_id = e.pcto_id);

  IF sin_formulario > 0 THEN
    RAISE EXCEPTION 'Quedan % puntos vigentes sin ningun formulario que los despliegue.', sin_formulario;
  END IF;

  -- 4.3 EL HISTORICO NO SE TOCA. Ningun operativo perdio su punto de encuentro.
  SELECT count(*) INTO huerfanos
  FROM t_operativo o
  WHERE o.pcto_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM t_punto_encuentro e WHERE e.pcto_id = o.pcto_id);

  IF huerfanos > 0 THEN
    RAISE EXCEPTION 'Hay % operativos cuyo punto de encuentro dejo de existir.', huerfanos;
  END IF;

  -- 4.4 Y ninguno de los nueve formularios se queda sin cascada, que era el estado que
  --     la migracion anterior vino a corregir.
  SELECT count(*) INTO sin_puntos
  FROM t_formulario f
  WHERE NOT EXISTS (
    SELECT 1
    FROM t_formulario_punto b
    JOIN t_punto_encuentro e ON e.pcto_id = b.pcto_id AND e.pcto_activo
    WHERE b.form_id = f.form_id
  );

  IF sin_puntos > 0 THEN
    RAISE EXCEPTION 'Quedan % formularios sin ningun punto vigente: la cascada de P-01 estaria vacia.', sin_puntos;
  END IF;
END $$;
