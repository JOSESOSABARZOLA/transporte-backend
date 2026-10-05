-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: un_formulario_admite_varios_roles
-- Responsabilidad: Declarar QUE PUEDE HACER CADA ROL en cada formulario.
-- Fuente: decision del negocio del 2026-08-25.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-08-25
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- DOS COLUMNAS NO DABAN PARA MAS DE DOS DEPARTAMENTOS.
--
-- Hasta hoy la participacion de un rol en un formulario se guardaba asi:
--
--   form_rol_dueno        NOT NULL   -> registra
--   form_rol_compartido   NULL       -> aporta personal, con cupo
--
-- Un dueño y un invitado. No caben tres departamentos, ni dos que registren, y el
-- negocio pidio exactamente eso para la patrulla ECU: que DMIP Operativos y DMIT
-- Instruccion tengan los dos acceso al formulario 4.
--
-- Ampliar a `form_rol_compartido_2` habria sido repetir el error una talla mas grande.
-- Lo que varia es el NUMERO de participantes, y eso se modela con filas.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- SE VAN LAS DOS COLUMNAS, Y ESO ES DELIBERADO.
--
-- Podrian quedarse «por compatibilidad», y entonces el mismo hecho estaria escrito dos
-- veces: en la fila y en la columna. Es exactamente lo que se retiro esta misma mañana
-- con HORA_CIERRE_DEPARTAMENTAL, y por el mismo motivo: cuando un dato vive en dos
-- sitios, alguien mueve uno y olvida el otro, y el sistema empieza a decir dos cosas.
--
-- `form_rol_dueno` SI SE QUEDA, y cambia de significado: pasa de «el unico que escribe»
-- a «el departamento RESPONSABLE del formulario». Lo necesitan dos cosas que exigen UNO
-- y no un conjunto:
--
--   1. La Matriz Consolidada, para saber que ventana mirar en la fila de evidencia
--      «este departamento no cargo nada» (matriz-consolidada.service.ts).
--   2. La cabecera del documento, que nombra al responsable.
--
-- La AUTORIZACION deja de leerlo: a partir de aqui la decide `t_formulario_rol`.
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- EL TRASPASO NO CAMBIA EL COMPORTAMIENTO DE NADIE. Cada dueño actual recibe su fila
-- ESCRITURA y cada compartido la suya APORTA con su cupo. Los ocho formularios que no
-- se tocan siguen comportandose igual, y las pruebas de equivalencia guarda-pantalla
-- -que comparan los seis roles- son las que lo verifican.
--
-- LO UNICO QUE CAMBIA DE VERDAD es la fila que se agrega al final: DMIT_INSTRUCTOR
-- pasa a ESCRITURA en el formulario 4. Con ella se retira su cupo de 1 a 2 en ECU, que
-- era del modelo anterior: un rol que REGISTRA no tiene tope de personal. La maquinaria
-- del cupo sigue viva y probada en el formulario 6, y devolverla a ECU es UNA FILA.

-- ─────────────────────────── 1 · El vocabulario ───────────────────────────

CREATE TYPE public.e_acceso_formulario AS ENUM ('ESCRITURA', 'APORTA');

COMMENT ON TYPE public.e_acceso_formulario IS
  'ESCRITURA: registra, edita y retira sus propios operativos. APORTA: solo asigna personal, con cupo.';

-- ─────────────────────────── 2 · La tabla ───────────────────────────

CREATE TABLE public.t_formulario_rol (
  form_id     INTEGER                       NOT NULL,
  frol_rol    public.e_rol_departamental    NOT NULL,
  frol_acceso public.e_acceso_formulario    NOT NULL,
  frol_cupo   SMALLINT                          NULL,
  CONSTRAINT t_formulario_rol_pkey PRIMARY KEY (form_id, frol_rol),
  CONSTRAINT fk_formulario_rol_formulario FOREIGN KEY (form_id)
    REFERENCES public.t_formulario (form_id) ON UPDATE CASCADE ON DELETE CASCADE,
  -- El cupo pertenece a APORTA y solo a APORTA. Un rol que registra no tiene tope de
  -- personal, y un rol que aporta sin cupo no puede asignar a nadie: sin esta
  -- restriccion las dos incoherencias entrarian en la base sin que nadie las viera.
  CONSTRAINT ck_formulario_rol_cupo CHECK (
    (frol_acceso = 'APORTA'    AND frol_cupo IS NOT NULL AND frol_cupo > 0) OR
    (frol_acceso = 'ESCRITURA' AND frol_cupo IS NULL)
  )
);

COMMENT ON TABLE public.t_formulario_rol IS
  'Que puede hacer cada rol en cada formulario. Sustituye a form_rol_compartido y form_cupo_compartido.';

CREATE INDEX idx_formulario_rol_rol ON public.t_formulario_rol (frol_rol);

-- ─────────────────────────── 3 · El traspaso ───────────────────────────

INSERT INTO public.t_formulario_rol (form_id, frol_rol, frol_acceso, frol_cupo)
SELECT form_id, form_rol_dueno, 'ESCRITURA', NULL
  FROM public.t_formulario;

INSERT INTO public.t_formulario_rol (form_id, frol_rol, frol_acceso, frol_cupo)
SELECT form_id, form_rol_compartido, 'APORTA', form_cupo_compartido::SMALLINT
  FROM public.t_formulario
 WHERE form_rol_compartido IS NOT NULL;

-- ─────────────────────────── 4 · Lo que pidio el negocio ───────────────────────────

-- El formulario 4 pasa a tener DOS departamentos que registran. La fila APORTA que el
-- traspaso acaba de crear para el DMIT se sustituye por una de ESCRITURA: son
-- excluyentes -la clave primaria es (formulario, rol)- y no tendria sentido tener las
-- dos, porque quien registra ya asigna personal sin tope.
DELETE FROM public.t_formulario_rol
 WHERE form_id = (SELECT form_id FROM public.t_formulario WHERE form_codigo = 'ECU')
   AND frol_rol = 'DMIT_INSTRUCTOR';

INSERT INTO public.t_formulario_rol (form_id, frol_rol, frol_acceso, frol_cupo)
SELECT form_id, 'DMIT_INSTRUCTOR', 'ESCRITURA', NULL
  FROM public.t_formulario
 WHERE form_codigo = 'ECU';

-- El area de Instruccion deja de estar marcada como «la que aporta el rol compartido»:
-- en ECU ya no hay rol que aporte. Sigue siendo un area admitida del formulario, que es
-- lo que era antes del 2026-08-25.
UPDATE public.t_formulario_area
   SET farea_es_compartida = false
 WHERE farea_area = 'INSTRUCCION'
   AND form_id = (SELECT form_id FROM public.t_formulario WHERE form_codigo = 'ECU');

-- ─────────────────────────── 5 · Se van las columnas duplicadas ───────────────────────────

ALTER TABLE public.t_formulario DROP CONSTRAINT ck_formulario_compartido;
ALTER TABLE public.t_formulario DROP COLUMN form_rol_compartido;
ALTER TABLE public.t_formulario DROP COLUMN form_cupo_compartido;

COMMENT ON COLUMN public.t_formulario.form_rol_dueno IS
  'Departamento RESPONSABLE del formulario. Desde el 2026-08-25 no decide la autorizacion: eso lo hace t_formulario_rol.';
