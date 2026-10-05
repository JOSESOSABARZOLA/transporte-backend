-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: el_vehiculo_tiene_destino_al_terminar_la_jornada
-- Responsabilidad: Declarar DONDE debe quedar cada vehiculo al terminar el dia.
-- Fuente: levantamiento con Planificacion de Transporte del 2026-08-28, RN-DAF-03.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-08-31
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- «SI NO SE LES PONE DONDE DEJAR EL VEHICULO SE VUELVE UN DESPELOTE.»
--
-- Es la frase de la analista, y describe la columna COORDINACION de su hoja: 393 filas
-- del mes de agosto la llevan informada. Dice en que zonal debe quedar el vehiculo al
-- acabar el turno, o si se lo lleva el conductor a su casa.
--
-- El dato NO EXISTE en ninguna capa del sistema. Sin el, al dia siguiente nadie sabe
-- donde esta cada placa, y la planificacion empieza a ciegas.
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- EL DESTINO ES DEL VEHICULO Y DEL DIA, NO DEL OPERATIVO. Es la decision de modelado que
-- gobierna esta migracion, y conviene dejarla escrita porque la intuicion dice lo
-- contrario.
--
-- En la hoja de la DAF cada fila es un CONDUCTOR con su VEHICULO en un turno, y un mismo
-- conductor encadena varios operativos dentro de ese turno: 106 celdas del mes llevan dos
-- rangos horarios y 53 llevan tres o mas. La coordinacion se escribe UNA vez por fila, no
-- una por operativo, porque el vehiculo termina en un solo sitio.
--
-- Colgarlo del operativo habria producido tantos destinos como operativos, y la pregunta
-- «donde duerme hoy la 7056» dejaria de tener una respuesta.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- NO SE SIEMBRA NINGUNA UBICACION, Y ES DELIBERADO.
--
-- La evidencia disponible se contradice: la hoja de agosto usa CINCO zonales de reposo
-- -MATRIZ, ELOY ALFARO, CALDERON, QUITUMBE, LOS CHILLOS- y la transcripcion menciona
-- CUATRO. Es la pregunta Q-01 del analisis funcional, todavia sin responder.
--
-- Sembrar cinco filas «porque estan en el Excel» convertiria una suposicion en un dato
-- maestro, y nadie volveria a preguntarse de donde salio. La tabla nace VACIA y el
-- catalogo lo carga el ADMINISTRADOR, igual que el resto de catalogos institucionales.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── 1 · El catalogo ───────────────────────────

CREATE TABLE public.t_ubicacion_flota (
  ubic_id     SERIAL       NOT NULL,
  ubic_nombre VARCHAR(120) NOT NULL,
  ubic_activo BOOLEAN      NOT NULL DEFAULT true,
  CONSTRAINT t_ubicacion_flota_pkey PRIMARY KEY (ubic_id),
  -- El Excel escribe la misma zonal de cuatro formas: CALDERON, CALDERON con tilde, LA
  -- CALDERON... Por eso esto es catalogo y no texto libre, y por eso el nombre es unico.
  CONSTRAINT uq_ubicacion_nombre UNIQUE (ubic_nombre),
  CONSTRAINT ck_ubicacion_nombre CHECK (length(btrim(ubic_nombre)) > 0)
);

COMMENT ON TABLE public.t_ubicacion_flota IS
  'Zonales donde puede quedar un vehiculo al terminar la jornada. RN-DAF-03. Se carga desde la administracion: no se siembra (Q-01 sin responder).';

-- ─────────────────────────── 2 · El destino del dia ───────────────────────────

CREATE TABLE public.t_destino_vehiculo (
  dest_id            SERIAL  NOT NULL,
  vehi_id            INTEGER NOT NULL,
  dest_fecha         DATE    NOT NULL,
  ubic_id            INTEGER     NULL,
  -- El conductor con parqueadero autorizado se lo lleva a casa. No es una ubicacion del
  -- catalogo: es la casa de quien lo condujo, y cambia con el conductor.
  dest_domicilio     BOOLEAN NOT NULL DEFAULT false,
  dest_observacion   VARCHAR(220) NULL,
  dest_registrado_por INTEGER NOT NULL,
  dest_creado_en     TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT t_destino_vehiculo_pkey PRIMARY KEY (dest_id),
  CONSTRAINT fk_destino_vehiculo FOREIGN KEY (vehi_id)
    REFERENCES public.t_vehiculo (vehi_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_destino_ubicacion FOREIGN KEY (ubic_id)
    REFERENCES public.t_ubicacion_flota (ubic_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  -- UN destino por vehiculo y dia. Es lo que hace que «donde duerme hoy la 7056» tenga
  -- una respuesta y no varias.
  CONSTRAINT uq_destino_vehi_fecha UNIQUE (vehi_id, dest_fecha),
  -- O va a una zonal, O va al domicilio del conductor. Nunca las dos, nunca ninguna: un
  -- destino sin destino no es un destino.
  CONSTRAINT ck_destino_sujeto CHECK (
    (ubic_id IS NOT NULL AND dest_domicilio = false)
    OR
    (ubic_id IS NULL     AND dest_domicilio = true)
  )
);

COMMENT ON TABLE public.t_destino_vehiculo IS
  'Donde debe quedar un vehiculo al terminar la jornada. Es la columna COORDINACION de la hoja de la DAF. RN-DAF-03.';

COMMENT ON COLUMN public.t_destino_vehiculo.dest_domicilio IS
  'true: se lo lleva el conductor a su casa. Solo con parqueadero autorizado. Excluyente con ubic_id.';

CREATE INDEX idx_destino_fecha ON public.t_destino_vehiculo (dest_fecha);

-- ─────────────────────────── 3 · Comprobacion ───────────────────────────

-- Las dos tablas y sus tres restricciones tienen que existir. Si alguna falta, la
-- migracion falla en lugar de dejar el modelo a medias sin que nadie se entere.
DO $$
DECLARE
  cuantas integer;
BEGIN
  SELECT count(*) INTO cuantas
    FROM pg_constraint
   WHERE conname IN (
     'uq_ubicacion_nombre', 'uq_destino_vehi_fecha', 'ck_destino_sujeto'
   );

  IF cuantas <> 3 THEN
    RAISE EXCEPTION 'Se crearon % restricciones del destino y debian ser 3.', cuantas;
  END IF;
END $$;
