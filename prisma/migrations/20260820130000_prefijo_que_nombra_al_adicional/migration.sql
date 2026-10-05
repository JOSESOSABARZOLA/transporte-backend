-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: prefijo_que_nombra_al_adicional
-- Responsabilidad: Declarar QUE prefijo de cada formulario nombra a sus adicionales.
-- Fuente: solicitud del negocio del 2026-08-20 sobre el formulario PMO.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-08-20
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- POR QUE UNA COLUMNA Y NO UNA CONVENCION SOBRE EL TEXTO.
--
-- El formulario PMO tiene dos prefijos, OCPMO y OCAPMO, y la unica diferencia entre
-- ellos es una A que significa «adicional». Deducirlo comparando cadenas -«el prefijo
-- que resulta de insertar una A en el otro»- funcionaria hoy y solo hoy: el formulario 8
-- tambien tiene dos prefijos, IG e IT, y ahi las letras distinguen el AREA del personal,
-- no la naturaleza del operativo. Una regla que acierta por casualidad en un caso y
-- falla en el otro no es una regla.
--
-- Con la columna, cada fila DICE lo que es, y habilitar adicionales en otro formulario
-- pasa a ser un dato -una fila con esta marca- y no un cambio de codigo.
--
-- POR QUE NINGUN INDICE NUEVO. Que un formulario tenga dos prefijos de adicional es un
-- error de configuracion que `GeneradorIdentificadorService` detecta y explica nombrando
-- el formulario, igual que ya hace con los prefijos ordinarios desde PV-27. Anadir aqui
-- un unico parcial daria la misma garantia con un mensaje que el administrador no puede
-- interpretar.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE "t_formulario_prefijo"
  ADD COLUMN "fpre_es_adicional" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "t_formulario_prefijo"."fpre_es_adicional" IS
  'El prefijo nombra a los operativos ADICIONALES del formulario, no a los ordinarios.';

-- ─────────────────── Los dos prefijos del PMO quedan declarados ───────────────────
--
-- NO SE FILTRA POR fpre_id. Los identificadores 71 y 72 son los del volcado del
-- 2026-08-19 y solo existen donde ese volcado entro; en `transportedb_pruebas` los
-- formularios no se sembraron a proposito, y alli estos UPDATE afectan a cero filas sin
-- error, que es lo correcto.
--
-- OCPMO PASA A PREDETERMINADO, y esto desbloquea un defecto que no tenia que ver con los
-- adicionales: hasta hoy el PMO no podia registrar NINGUN operativo. Tenia dos prefijos y
-- ninguno marcado, de modo que `elegirPrefijo` se detenia -PV-27- antes de componer el
-- identificador. Ahora que la segunda fila declara que nombra adicionales, la primera es
-- inequivocamente la ordinaria.
UPDATE "t_formulario_prefijo"
  SET "fpre_es_predeterminado" = true
  WHERE "fpre_prefijo" = 'OCPMO';

UPDATE "t_formulario_prefijo"
  SET "fpre_es_adicional" = true, "fpre_es_predeterminado" = false
  WHERE "fpre_prefijo" = 'OCAPMO';
