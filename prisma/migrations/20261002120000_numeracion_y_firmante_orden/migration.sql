-- Numeración AMC-OS-<8>-<año>, firmante persistido y contador anual (2026-10-02).
--
-- La orden pasa a tener un NÚMERO oficial (AMC-OS-00005572-2026) secuencial por año, asignado
-- cuando queda VIGENTE (sin datos faltantes); los borradores no consumen número. El `oser_codigo`
-- interno (OS-...) NO cambia: sigue siendo la llave de BD/rutas. Todo es ADITIVO.
--
-- El FIRMANTE (Director en sesión) se congela como copia en la orden al emitir/reemitir.

ALTER TABLE "t_orden_servicio" ADD COLUMN IF NOT EXISTS "oser_numero_secuencial" INTEGER;
ALTER TABLE "t_orden_servicio" ADD COLUMN IF NOT EXISTS "oser_numero_anio" INTEGER;
ALTER TABLE "t_orden_servicio" ADD COLUMN IF NOT EXISTS "oser_firmante" JSONB;

-- Una sola orden por (año, secuencial): red de seguridad ante concurrencia.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_orden_numero"
  ON "t_orden_servicio" ("oser_numero_anio", "oser_numero_secuencial");

-- CONTADOR ANUAL. `seor_ultimo_secuencial` es el último número usado en el año.
CREATE TABLE IF NOT EXISTS "t_secuencia_orden" (
  "seor_anio"              INTEGER PRIMARY KEY,
  "seor_ultimo_secuencial" INTEGER NOT NULL
);

-- VALOR INICIAL CONFIGURABLE: para continuar la numeración actual se siembra el año con el último
-- número ya emitido fuera del sistema. Aquí 5571 → el primer número que asigna 2026 es 5572. Para
-- otro arranque, cambiar este 5571 (o insertar la fila del año con el valor correspondiente). Cada
-- año nuevo que no tenga fila arranca en 00000001.
INSERT INTO "t_secuencia_orden" ("seor_anio", "seor_ultimo_secuencial")
VALUES (2026, 5571)
ON CONFLICT ("seor_anio") DO NOTHING;

-- FIRMANTE: el nombre sale de la sesión del Director; el cargo y la dependencia son parámetros
-- administrables en «Ventanas y parámetros» (ORDEN_FIRMANTE_CARGO / ORDEN_FIRMANTE_DEPENDENCIA).
-- NO se siembran aquí: `ck_parametro_valor` prohíbe un valor vacío, así que «sin configurar» se
-- modela por AUSENCIA de la fila —el servicio lo lee como `''` (F22) y la orden queda en Borrador
-- hasta que la Dirección fije un valor real—. La fila se crea al guardar ese valor desde la pantalla.
