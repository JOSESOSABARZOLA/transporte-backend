-- ═══════════════════════════════════════════════════════════════════════════════
-- LA MATRIZ ZONAL <-> PUNTO DE ENCUENTRO, QUE PV-01 ESPERABA DESDE EL 6 DE AGOSTO
--
-- Hasta hoy solo el formulario 1 tenia su cascada completa. El 2 y el 3 tenian puntos
-- en UNA zonal, y los formularios 5, 6, 7, 8 y 9 no tenian NINGUNO: como
-- `form_captura_libre_punto` es FALSE en los nueve y el punto es obligatorio al
-- registrar, en esos cinco formularios no se podia registrar un operativo. Esta
-- migracion entrega el insumo aprobado por el negocio el 2026-09-02.
--
-- EL AMBITO DE ZONALES NO ES EL MISMO EN LOS NUEVE. Cinco formularios trabajan sobre
-- las diez administraciones zonales; cuatro -ECU, REACCION DIURNA, REACCION NOCTURNA
-- y AMC-CBQ- son distritales y operan sobre la zonal DMQ, que ya existia marcada con
-- `zona_es_dmq`. El ambito se declara en `tmp_ambito` y el resto se deduce.
--
-- POR AHORA CADA ZONAL RECIBE TODOS LOS PUNTOS DE SU FORMULARIO. Es una decision
-- explicita del negocio, no un descuido: la correspondencia fina -que punto pertenece
-- de verdad a que zonal- todavia no esta definida, y hasta que lo este es preferible
-- ofrecer de mas a bloquear el registro. El formulario 1 ya venia cargado asi desde
-- agosto, de modo que esto extiende un criterio existente, no inventa uno.
-- Cuando llegue la correspondencia real se retiran filas de `t_formulario_punto`; los
-- puntos no se borran, y ningun operativo historico se ve afectado.
--
-- ES IDEMPOTENTE. Todo va con NOT EXISTS contra `uq_punto_nombre_zonal` y contra la
-- clave compuesta de la puente, asi que volver a aplicarla no duplica nada y respeta
-- lo ya cargado: los 82 puntos que ya existian se reutilizan, no se recrean.
--
-- LO QUE ESTA MIGRACION NO TOCA, A PROPOSITO:
--   · «AMC Matriz» de la Zonal Eugenio Espejo (pcto_id 90). No figura en el insumo
--     -AMC Matriz es distrital-, pero TRES OPERATIVOS lo usan. RF-058 manda desactivar
--     y no eliminar, y desactivarlo tampoco corresponde decidirlo aqui.
--   · «Eloy Alfaro» de la Zonal Eloy Alfaro (pcto_id 124), ya inactivo y sin usos.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TEMP TABLE tmp_ambito (
  form_numero INT PRIMARY KEY,
  es_dmq      BOOLEAN NOT NULL
);

INSERT INTO tmp_ambito (form_numero, es_dmq) VALUES
  (1, FALSE),  -- OPERATIVOS DE CONTROL FIJOS
  (2, FALSE),  -- CONTROL DE PUNTO DE MANDO OPERATIVO (PMO)
  (3, FALSE),  -- OPERATIVOS DE CONTROL LIMPIA PARABRISAS
  (4, TRUE),   -- PATRULLA ECU DIURNA
  (5, TRUE),   -- PATRULLA REACCION DIURNA (UIG - UIT)
  (6, TRUE),   -- PATRULLA REACCION NOCTURNA
  (7, FALSE),  -- OPERATIVO DMIT
  (8, FALSE),  -- INSPECCIONES TECNICAS Y GENERALES (DMIP)
  (9, TRUE);   -- OPERATIVO DE CONTROL AMC-CBQ

CREATE TEMP TABLE tmp_punto (
  form_numero INT          NOT NULL,
  pcto_nombre VARCHAR(200) NOT NULL
);

INSERT INTO tmp_punto (form_numero, pcto_nombre) VALUES
  -- 1 · OPERATIVOS DE CONTROL FIJOS
  (1, 'HCAM'),
  (1, 'KFC - Caja del Seguro'),
  (1, 'Parque Tumbaco'),
  (1, 'Parque Central de Pifo'),
  (1, 'Estación Río Coca'),
  (1, 'Rocafuerte y García Moreno'),
  (1, 'Tejar'),

  -- 2 · CONTROL DE PUNTO DE MANDO OPERATIVO (PMO)
  (2, 'PMO La Basílica'),
  (2, 'PMO Plaza Gabriela Mistral'),
  (2, 'PMO NNUU y Shyris'),
  (2, 'PMO CUMBAYÁ'),
  (2, 'PMO CHAQUIÑÁN'),
  (2, 'PMO Plaza Argentina (Túnel Guayasamín)'),
  (2, 'PMO Panecillo'),
  (2, 'PMO La Carolina'),
  (2, 'PMO Centro Histórico'),

  -- 3 · OPERATIVOS DE CONTROL LIMPIA PARABRISAS
  (3, 'Ingreso de la Estación El Recreo'),
  (3, 'Quicentro Sur'),
  (3, 'Plaza Argentina (Túnel Guayasamín)'),

  -- 4 · PATRULLA ECU DIURNA · ambito DMQ
  (4, 'AMC Matriz'),
  (4, 'AMC Eloy Alfaro'),
  (4, 'AMC Valles - Los Chillos'),
  (4, 'AMC Valles - Tumbaco'),

  -- 5 · PATRULLA REACCION DIURNA (UIG - UIT) · ambito DMQ
  (5, 'AMC Matriz'),

  -- 6 · PATRULLA REACCION NOCTURNA · ambito DMQ
  (6, 'AMC Matriz'),

  -- 7 · OPERATIVO DMIT
  (7, 'AZ Eugenio Espejo'),
  (7, 'AZ La Delicia'),
  (7, 'AZ Calderón'),
  (7, 'AZ Eloy Alfaro'),
  (7, 'AZ Quitumbe'),
  (7, 'AZ La Mariscal'),
  (7, 'AZ Manuela Sáenz'),
  (7, 'AZ Valle de los Chillos'),
  (7, 'AZ Tumbaco'),
  (7, 'AZ Chocó Andino'),
  (7, 'Distrito de PPNN Eugenio Espejo'),
  (7, 'Distrito de PPNN La Delicia'),
  (7, 'Distrito de PPNN Calderón'),
  (7, 'Distrito de PPNN Eloy Alfaro'),
  (7, 'Distrito de PPNN Quitumbe'),
  (7, 'Distrito de PPNN La Mariscal'),
  (7, 'Distrito de PPNN Manuela Sáenz'),
  (7, 'Distrito de PPNN Valle de los Chillos'),
  (7, 'Distrito de PPNN Tumbaco'),
  (7, 'Distrito de PPNN Chocó Andino'),
  (7, 'UVC Calderón'),
  (7, 'Comando CACMQ Eugenio Espejo'),
  (7, 'Comando CACMQ La Delicia'),
  (7, 'Comando CACMQ Calderón'),
  (7, 'Comando CACMQ Eloy Alfaro'),
  (7, 'Comando CACMQ Quitumbe'),
  (7, 'Comando CACMQ La Mariscal'),
  (7, 'Comando CACMQ Manuela Sáenz'),
  (7, 'Comando CACMQ Valle de los Chillos'),
  (7, 'Comando CACMQ Tumbaco'),
  (7, 'Comando CACMQ Chocó Andino'),
  (7, 'UPC Buenos Aires'),
  (7, 'UPC La Gasca'),
  (7, 'PPC Eugenio Espejo'),

  -- 8 · INSPECCIONES TECNICAS Y GENERALES (DMIP)
  (8, 'AMC Eugenio Espejo'),
  (8, 'AMC La Delicia'),
  (8, 'AMC Calderón'),
  (8, 'AMC Eloy Alfaro'),
  (8, 'AMC Quitumbe'),
  (8, 'AMC La Mariscal'),
  (8, 'AMC Manuela Sáenz'),
  (8, 'AMC Valle de los Chillos'),
  (8, 'AMC Tumbaco'),
  (8, 'AMC Chocó Andino'),

  -- 9 · OPERATIVO DE CONTROL AMC-CBQ · ambito DMQ
  (9, 'Estación de bomberos Veintimilla Reina Victoria');

-- ───────────────────────────────────────────────────────────────────────────────
-- 1 · Los puntos. Uno por denominacion Y ZONAL: `uq_punto_nombre_zonal` no incluye el
--     formulario, de modo que si dos formularios nombran el mismo lugar en la misma
--     zonal comparten fila. Es el caso de «AMC Matriz» en DMQ, que sirve al 4, al 5 y
--     al 6 con una sola fila y tres vinculos.
-- ───────────────────────────────────────────────────────────────────────────────

INSERT INTO t_punto_encuentro (pcto_nombre, zona_id, pcto_activo)
SELECT DISTINCT tp.pcto_nombre, z.zona_id, TRUE
FROM tmp_punto tp
JOIN tmp_ambito ta ON ta.form_numero = tp.form_numero
JOIN t_zonal    z  ON z.zona_es_dmq  = ta.es_dmq AND z.zona_activo
WHERE NOT EXISTS (
  SELECT 1 FROM t_punto_encuentro e
  WHERE e.pcto_nombre = tp.pcto_nombre AND e.zona_id = z.zona_id
);

-- ───────────────────────────────────────────────────────────────────────────────
-- 2 · La delimitacion por formulario (RN-16). Sin esta fila puente el punto existe
--     pero no aparece en ninguna cascada.
-- ───────────────────────────────────────────────────────────────────────────────

INSERT INTO t_formulario_punto (form_id, pcto_id)
SELECT DISTINCT f.form_id, e.pcto_id
FROM tmp_punto tp
JOIN tmp_ambito       ta ON ta.form_numero = tp.form_numero
JOIN t_formulario     f  ON f.form_numero  = tp.form_numero
JOIN t_zonal          z  ON z.zona_es_dmq  = ta.es_dmq AND z.zona_activo
JOIN t_punto_encuentro e ON e.pcto_nombre  = tp.pcto_nombre AND e.zona_id = z.zona_id
WHERE NOT EXISTS (
  SELECT 1 FROM t_formulario_punto b
  WHERE b.form_id = f.form_id AND b.pcto_id = e.pcto_id
);

-- ───────────────────────────────────────────────────────────────────────────────
-- 3 · Comprobacion. Si algo de esto falla la migracion no se da por aplicada.
-- ───────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  sin_vincular INT;
  matriz_dmq   INT;
  huerfanos    INT;
BEGIN
  -- 3.1 Toda combinacion formulario x zonal-de-su-ambito x punto quedo vinculada.
  SELECT count(*) INTO sin_vincular
  FROM tmp_punto tp
  JOIN tmp_ambito        ta ON ta.form_numero = tp.form_numero
  JOIN t_formulario      f  ON f.form_numero  = tp.form_numero
  JOIN t_zonal           z  ON z.zona_es_dmq  = ta.es_dmq AND z.zona_activo
  LEFT JOIN t_punto_encuentro e
         ON e.pcto_nombre = tp.pcto_nombre AND e.zona_id = z.zona_id
  LEFT JOIN t_formulario_punto b
         ON b.form_id = f.form_id AND b.pcto_id = e.pcto_id
  WHERE b.form_id IS NULL;

  IF sin_vincular > 0 THEN
    RAISE EXCEPTION 'La matriz quedo incompleta: % combinaciones formulario-zonal-punto sin vincular.', sin_vincular;
  END IF;

  -- 3.2 «AMC Matriz» del ambito DMQ es una sola fila compartida por el 4, el 5 y el 6.
  --     Es la prueba de que la relacion de muchos a muchos se esta usando de verdad.
  SELECT count(*) INTO matriz_dmq
  FROM t_formulario_punto b
  JOIN t_punto_encuentro  e ON e.pcto_id = b.pcto_id
  JOIN t_zonal            z ON z.zona_id = e.zona_id AND z.zona_es_dmq
  WHERE e.pcto_nombre = 'AMC Matriz';

  IF matriz_dmq <> 3 THEN
    RAISE EXCEPTION 'AMC Matriz del ambito DMQ debe servir a los formularios 4, 5 y 6: se encontraron % vinculos.', matriz_dmq;
  END IF;

  -- 3.3 Ningun formulario se queda sin cascada. Era el estado de cinco de los nueve.
  SELECT count(*) INTO huerfanos
  FROM t_formulario f
  WHERE NOT EXISTS (SELECT 1 FROM t_formulario_punto b WHERE b.form_id = f.form_id);

  IF huerfanos > 0 THEN
    RAISE EXCEPTION 'Quedan % formularios sin ningun punto de encuentro: la cascada de P-01 seguiria vacia.', huerfanos;
  END IF;
END $$;

DROP TABLE tmp_punto;
DROP TABLE tmp_ambito;
