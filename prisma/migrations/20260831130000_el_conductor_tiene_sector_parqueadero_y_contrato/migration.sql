-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: el_conductor_tiene_sector_parqueadero_y_contrato
-- Responsabilidad: Guardar los tres datos del conductor que hoy viven en la memoria de una persona.
-- Fuente: levantamiento con Planificacion de Transporte del 2026-08-28.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-08-31
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- SON TRES DATOS QUE HOY DECIDEN LA ASIGNACION Y NO ESTAN ESCRITOS EN NINGUNA PARTE.
--
-- El analisis los identifico como conocimiento tacito, que es el riesgo estructural del
-- proceso: la persona que consolidaba el cuadro renuncio durante el levantamiento, sin
-- traspaso, y la planificacion de transporte depende hoy de una sola cabeza.
--
--   1. SECTOR DONDE VIVE. Esta en la hoja maestra del Excel, columna DOMICILIO, con
--      cuatro valores: NORTE, SUR, CENTRO, VALLE. Gobierna que conductor conviene para
--      un operativo lejano.
--   2. PARQUEADERO AUTORIZADO. «El no tiene parqueadero seguro... el vive a 2 cuadritas
--      de Quitumbe.» Decide si el vehiculo se lo lleva a casa -y por tanto si al dia
--      siguiente le toca EL MISMO- o si debe dejarlo en una zonal.
--   3. TIPO DE CONTRATO. «Trabajo solo hasta las 4 y media segun su contrato.» Es una de
--      las DOS reglas de descanso del conductor que hoy NO SE PUEDEN APLICAR, y la
--      cabecera de descanso-conductor.policy.ts lo dice desde M-17.
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- LOS TRES NACEN NULABLES, y no es tibieza: la flota se carga a mano y exigir los tres
-- de golpe impediria dar de alta a un conductor del que solo se sabe la cedula y el
-- nombre. Una regla que dependa de uno de ellos comprueba primero si consta; si no
-- consta, no se aplica, que es lo honesto -y es exactamente lo que ya hace
-- `reglaSolapamiento` cuando le faltan las conducciones del dia-.
--
-- EL SECTOR ES UN ENUMERADO Y NO TEXTO. Es el mismo motivo por el que la ubicacion de la
-- flota es catalogo: el Excel escribe la misma zona de varias formas, y con texto libre
-- ninguna comparacion es fiable. Los cuatro valores salen de la hoja maestra, contados
-- sobre las 34 filas de conductores; no hay un quinto.
--
-- `e_tipo_contrato` YA EXISTE, del personal. Se reutiliza en lugar de crear un gemelo:
-- un conductor de nombramiento y un inspector de nombramiento lo son en el mismo sentido.

-- ─────────────────────────── 1 · El vocabulario del sector ───────────────────────────

CREATE TYPE public.e_sector_ciudad AS ENUM ('NORTE', 'SUR', 'CENTRO', 'VALLE');

COMMENT ON TYPE public.e_sector_ciudad IS
  'Zona de Quito donde vive el conductor. Los cuatro valores de la columna DOMICILIO de la hoja maestra de la DAF.';

-- ─────────────────────────── 2 · Las tres columnas ───────────────────────────

ALTER TABLE public.t_conductor
  ADD COLUMN "cond_sector"                public.e_sector_ciudad  NULL,
  ADD COLUMN "cond_parqueadero_autorizado" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cond_tipo_contrato"          public.e_tipo_contrato NULL;

COMMENT ON COLUMN public.t_conductor.cond_sector IS
  'Sector donde vive. Columna DOMICILIO de la hoja de la DAF. Nulable: se completa al depurar el catalogo.';

COMMENT ON COLUMN public.t_conductor.cond_parqueadero_autorizado IS
  'Si puede llevarse el vehiculo a casa. RN-DAF-04: al dia siguiente le corresponde el mismo.';

COMMENT ON COLUMN public.t_conductor.cond_tipo_contrato IS
  'RN-DAF-06. Nulable: mientras no conste, la regla de jornada contractual NO se aplica.';

-- `cond_parqueadero_autorizado` es NOT NULL con defecto en falso, al reves que los otros
-- dos. Aqui el desconocimiento y el «no lo tiene» llevan a la MISMA decision -el vehiculo
-- se queda en una zonal- y un tercer estado no aportaria nada. En el contrato no: no
-- saberlo tiene que impedir aplicar la regla, no inventar un contrato.

-- ─────────────────────────── 3 · Comprobacion ───────────────────────────

DO $$
DECLARE
  cuantas integer;
BEGIN
  SELECT count(*) INTO cuantas
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 't_conductor'
     AND column_name IN (
       'cond_sector', 'cond_parqueadero_autorizado', 'cond_tipo_contrato'
     );

  IF cuantas <> 3 THEN
    RAISE EXCEPTION 'Se agregaron % columnas al conductor y debian ser 3.', cuantas;
  END IF;
END $$;
