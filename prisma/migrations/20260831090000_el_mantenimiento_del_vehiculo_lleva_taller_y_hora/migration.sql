-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: el_mantenimiento_del_vehiculo_lleva_taller_y_hora
-- Responsabilidad: Permitir registrar DONDE y A QUE HORA entra un vehiculo al taller.
-- Fuente: levantamiento con Planificacion de Transporte del 2026-08-28, RN-DAF-05.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-08-31
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- EL MANTENIMIENTO YA EXISTIA COMO PALABRA Y NO COMO FUNCIONALIDAD.
--
-- `MANTENIMIENTO` esta en `e_estado_disponibilidad` desde el esquema inicial, y
-- `flota.repository.ausenciaDeVehiculo` lo LEE para excluir la placa del desplegable de
-- la DAF. Pero NADIE LO ESCRIBE: no hay endpoint, no hay pantalla, y la unica forma de
-- parar un vehiculo era un INSERT a mano en la base.
--
-- El levantamiento mostro ademas que faltan dos datos que la analista si maneja. En su
-- hoja aparecen celdas como `CITA AMBACAR 08H00`: el TALLER y la HORA. Sin ellos, «este
-- carro esta parado» no dice si vuelve por la tarde o si esta una semana fuera.
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- SE EXTIENDE `t_disponibilidad` EN LUGAR DE CREAR UNA TABLA, y es una decision.
--
-- La alternativa era `t_mantenimiento_vehiculo` aparte. Se descarto porque habria DOS
-- sitios de los que excluir un vehiculo: `ausenciaDeVehiculo` ya consulta esta tabla en
-- el camino caliente de la asignacion, y anadir un segundo origen obliga a recordar
-- siempre los dos. Cuando un dato vive en dos sitios, alguien consulta uno y olvida el
-- otro. La tabla ya distingue el sujeto con `ck_disponibilidad_sujeto`.
--
-- LAS DOS COLUMNAS SON NULABLES Y ESO NO LAS DEJA SUELTAS: la restriccion de abajo las
-- ata a las filas de mantenimiento de un vehiculo. Una ausencia de una persona no puede
-- llevar taller, que seria un contrasentido y ademas un dato de salud mal colocado.

-- ─────────────────────────── 1 · Las dos columnas ───────────────────────────

ALTER TABLE public.t_disponibilidad
  ADD COLUMN "disp_taller" VARCHAR(120) NULL,
  ADD COLUMN "disp_hora"   VARCHAR(5)   NULL;

COMMENT ON COLUMN public.t_disponibilidad.disp_taller IS
  'Taller donde entra el vehiculo. Solo en filas de MANTENIMIENTO de un vehiculo. RN-DAF-05.';

COMMENT ON COLUMN public.t_disponibilidad.disp_hora IS
  'Hora de la cita, HH:MM. Solo en filas de MANTENIMIENTO de un vehiculo. Es el `08H00` de CITA AMBACAR 08H00.';

-- ─────────────────────────── 2 · Que no se usen fuera de su sitio ───────────────────────────

-- El taller y la hora pertenecen al mantenimiento de un VEHICULO y a nada mas. Sin esta
-- restriccion, una vacacion de un funcionario podria llevar taller sin que nadie lo viera.
ALTER TABLE public.t_disponibilidad ADD CONSTRAINT "ck_disponibilidad_taller"
  CHECK (
    ("disp_taller" IS NULL AND "disp_hora" IS NULL)
    OR
    ("disp_estado" = 'MANTENIMIENTO' AND "vehi_id" IS NOT NULL)
  );

-- La hora se guarda como texto HH:MM, igual que `oper_hora_inicio`: es una hora de reloj
-- sin fecha ni huso, y convertirla a timestamp la desplazaria cinco horas en Quito.
ALTER TABLE public.t_disponibilidad ADD CONSTRAINT "ck_disponibilidad_hora"
  CHECK (
    "disp_hora" IS NULL
    OR "disp_hora" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  );

-- ─────────────────────────── 3 · Comprobacion ───────────────────────────

-- Si las restricciones no quedaron creadas, la migracion falla en lugar de dejar la tabla
-- admitiendo filas incoherentes sin que nadie se entere.
DO $$
DECLARE
  cuantas integer;
BEGIN
  SELECT count(*) INTO cuantas
    FROM pg_constraint
   WHERE conrelid = 'public.t_disponibilidad'::regclass
     AND conname IN ('ck_disponibilidad_taller', 'ck_disponibilidad_hora');

  IF cuantas <> 2 THEN
    RAISE EXCEPTION 'Se crearon % restricciones de mantenimiento y debian ser 2.', cuantas;
  END IF;
END $$;
