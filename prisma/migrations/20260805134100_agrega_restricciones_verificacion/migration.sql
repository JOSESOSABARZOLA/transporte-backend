-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: agrega_restricciones_verificacion
-- Responsabilidad: Expresar en el motor las invariantes estructurales que Prisma no soporta.
-- Fuente: docs/FASE4-diseno-base-datos.md seccion 7.1 (22 restricciones) mas la
--         verificacion de t_parametro_politica, que ese documento no contempla porque
--         la tabla se incorporo por decision posterior del PO (IMPLEMENTATION_GUIDE.md 5.1).
-- Desarrollador: Jose Sosa
-- Fecha: 2026-08-05
--
-- Estas verificaciones se limitan a invariantes estructurales. Las reglas de negocio
-- complejas -descanso, rotacion, solapamiento- viven en la capa de aplicacion, donde
-- pueden devolver un mensaje comprensible para el funcionario.

-- ─────────────────────────── t_operativo ───────────────────────────

-- RN-07: la hora se registra solo en horas completas y medias horas.
ALTER TABLE "t_operativo" ADD CONSTRAINT "ck_operativo_hora_inicio"
  CHECK ("oper_hora_inicio" ~ '^([01][0-9]|2[0-3]):(00|30)$');

ALTER TABLE "t_operativo" ADD CONSTRAINT "ck_operativo_hora_fin"
  CHECK ("oper_hora_fin" ~ '^([01][0-9]|2[0-3]):(00|30)$');

ALTER TABLE "t_operativo" ADD CONSTRAINT "ck_operativo_duracion"
  CHECK ("oper_duracion_horas" > 0 AND "oper_duracion_horas" <= 24);

-- RN-20: esta informado el punto del catalogo O el punto libre, nunca ambos ni ninguno.
ALTER TABLE "t_operativo" ADD CONSTRAINT "ck_operativo_punto"
  CHECK (("pcto_id" IS NOT NULL AND "oper_punto_libre" IS NULL)
      OR ("pcto_id" IS NULL AND "oper_punto_libre" IS NOT NULL));

ALTER TABLE "t_operativo" ADD CONSTRAINT "ck_operativo_tipo"
  CHECK (("tico_id" IS NOT NULL AND "oper_tipo_libre" IS NULL)
      OR ("tico_id" IS NULL AND "oper_tipo_libre" IS NOT NULL));

-- HAL-01. LA RESTRICCION MAS VALIOSA DEL CONJUNTO: hace imposible almacenar un
-- operativo ASIGNADO sin conductor. NUNCA se elimina para simplificar una migracion.
ALTER TABLE "t_operativo" ADD CONSTRAINT "ck_operativo_transporte"
  CHECK (
    ("oper_estado_transporte" = 'ASIGNADO'
      AND "cond_id" IS NOT NULL AND "vehi_id" IS NOT NULL)
    OR
    ("oper_estado_transporte" IN ('PENDIENTE', 'PROPIOS_MEDIOS')
      AND "cond_id" IS NULL AND "vehi_id" IS NULL)
  );

ALTER TABLE "t_operativo" ADD CONSTRAINT "ck_operativo_secuencial"
  CHECK ("oper_secuencial" > 0);

ALTER TABLE "t_operativo" ADD CONSTRAINT "ck_operativo_version"
  CHECK ("oper_version" > 0);

-- ────────────────────────── t_disponibilidad ──────────────────────────

-- Exactamente una de las tres referencias esta informada.
ALTER TABLE "t_disponibilidad" ADD CONSTRAINT "ck_disponibilidad_sujeto"
  CHECK (
    (CASE WHEN "func_id" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "cond_id" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "vehi_id" IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

ALTER TABLE "t_disponibilidad" ADD CONSTRAINT "ck_disponibilidad_rango"
  CHECK ("disp_hasta" >= "disp_desde");

-- ─────────────────────────── t_formulario ───────────────────────────

ALTER TABLE "t_formulario" ADD CONSTRAINT "ck_formulario_numero"
  CHECK ("form_numero" BETWEEN 1 AND 9);

ALTER TABLE "t_formulario" ADD CONSTRAINT "ck_formulario_color_fondo"
  CHECK ("form_color_fondo" ~ '^#[0-9A-Fa-f]{6}$');

ALTER TABLE "t_formulario" ADD CONSTRAINT "ck_formulario_color_acento"
  CHECK ("form_color_acento" ~ '^#[0-9A-Fa-f]{6}$');

ALTER TABLE "t_formulario" ADD CONSTRAINT "ck_formulario_vigencia"
  CHECK ("form_vigencia_desde" IS NULL
      OR "form_vigencia_hasta" IS NULL
      OR "form_vigencia_hasta" > "form_vigencia_desde");

-- INV-20: si hay rol compartido hay cupo, y si hay cupo hay rol compartido.
ALTER TABLE "t_formulario" ADD CONSTRAINT "ck_formulario_compartido"
  CHECK (("form_rol_compartido" IS NULL AND "form_cupo_compartido" IS NULL)
      OR ("form_rol_compartido" IS NOT NULL AND "form_cupo_compartido" IS NOT NULL
          AND "form_cupo_compartido" > 0));

-- ────────────────────────── t_cuadro_diario ──────────────────────────

ALTER TABLE "t_cuadro_diario" ADD CONSTRAINT "ck_cuadro_semana"
  CHECK ("cuad_nro_semana" BETWEEN 1 AND 53);

-- Si el cuadro esta CERRADO, constan el usuario y el momento del cierre.
ALTER TABLE "t_cuadro_diario" ADD CONSTRAINT "ck_cuadro_cierre"
  CHECK ("cuad_estado" <> 'CERRADO'
      OR ("cuad_cerrado_por" IS NOT NULL AND "cuad_cerrado_en" IS NOT NULL));

-- ────────────────────────── t_ventana_carga ──────────────────────────

ALTER TABLE "t_ventana_carga" ADD CONSTRAINT "ck_ventana_horas"
  CHECK (("vcar_hora_apertura" IS NULL OR "vcar_hora_apertura" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
     AND ("vcar_hora_cierre"   IS NULL OR "vcar_hora_cierre"   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'));

ALTER TABLE "t_ventana_carga" ADD CONSTRAINT "ck_ventana_dias"
  CHECK (("vcar_dia_apertura" IS NULL OR "vcar_dia_apertura" BETWEEN 1 AND 7)
     AND ("vcar_dia_cierre"   IS NULL OR "vcar_dia_cierre"   BETWEEN 1 AND 7));

-- ───────────────────────── t_capacidad_flota ─────────────────────────

ALTER TABLE "t_capacidad_flota" ADD CONSTRAINT "ck_capacidad_positiva"
  CHECK ("capa_vehiculos_habiles" >= 0 AND "capa_conductores_habiles" >= 0);

-- ──────────────────────── t_historial_jornada ────────────────────────

ALTER TABLE "t_historial_jornada" ADD CONSTRAINT "ck_historial_horas"
  CHECK ("hist_horas_jornada" >= 0 AND "hist_horas_jornada" <= 24);

-- ───────────────────────── t_solicitud_apoyo ─────────────────────────

ALTER TABLE "t_solicitud_apoyo" ADD CONSTRAINT "ck_solicitud_cantidad"
  CHECK ("sapo_cantidad" > 0);

-- ──────────────────────── t_parametro_politica ────────────────────────
-- No consta en FASE4-diseno-base-datos.md seccion 7.1 porque la tabla se incorporo
-- despues. Se agrega aqui: un umbral fuera de su rango admisible no debe poder
-- almacenarse. La validacion tipada por e_tipo_parametro vive en el servicio, que
-- devuelve un mensaje comprensible; esto es la ultima linea de defensa.

ALTER TABLE "t_parametro_politica" ADD CONSTRAINT "ck_parametro_valor"
  CHECK (length(btrim("para_valor")) > 0);

-- Para los tipos numericos, el valor debe caer dentro del rango declarado.
ALTER TABLE "t_parametro_politica" ADD CONSTRAINT "ck_parametro_rango"
  CHECK (
    "para_tipo" NOT IN ('ENTERO', 'DECIMAL')
    OR (
      ("para_minimo" IS NULL OR "para_valor"::numeric >= "para_minimo"::numeric)
      AND
      ("para_maximo" IS NULL OR "para_valor"::numeric <= "para_maximo"::numeric)
    )
  );
