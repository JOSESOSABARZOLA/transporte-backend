-- CreateEnum
CREATE TYPE "e_rol_departamental" AS ENUM ('DMIP_OPERATIVOS', 'DMIP_INSPECCIONES', 'DMIT_INSTRUCTOR', 'DAF', 'DIRECTOR', 'ADMINISTRADOR');

-- CreateEnum
CREATE TYPE "e_estado_cuadro" AS ENUM ('BORRADOR', 'EN_TRANSPORTE', 'APROBADO', 'CERRADO');

-- CreateEnum
CREATE TYPE "e_estado_transporte" AS ENUM ('PENDIENTE', 'ASIGNADO', 'PROPIOS_MEDIOS');

-- CreateEnum
CREATE TYPE "e_politica_vehiculo" AS ENUM ('NO_APLICA', 'CONDICIONAL', 'REQUERIDO', 'OBLIGATORIO');

-- CreateEnum
CREATE TYPE "e_area_personal" AS ENUM ('GENERAL', 'TECNICO', 'INSTRUCCION', 'OPERATIVOS', 'CCF');

-- CreateEnum
CREATE TYPE "e_tipo_contrato" AS ENUM ('NOMBRAMIENTO', 'OCASIONAL');

-- CreateEnum
CREATE TYPE "e_estado_disponibilidad" AS ENUM ('DISPONIBLE', 'VACACIONES', 'REPOSO_MEDICO', 'CALAMIDAD', 'PERMISO', 'MANTENIMIENTO');

-- CreateEnum
CREATE TYPE "e_tipo_ventana" AS ENUM ('SEMANAL', 'DIARIO', 'INTERVALO');

-- CreateEnum
CREATE TYPE "e_accion_auditoria" AS ENUM ('CREAR', 'ACTUALIZAR', 'ELIMINAR', 'CERRAR', 'REABRIR', 'EMITIR');

-- CreateEnum
CREATE TYPE "e_estado_solicitud" AS ENUM ('SOLICITADA', 'ATENDIDA', 'RECHAZADA', 'VENCIDA');

-- CreateEnum
CREATE TYPE "e_tipo_parametro" AS ENUM ('ENTERO', 'DECIMAL', 'TEXTO', 'BOOLEANO');

-- CreateTable
CREATE TABLE "t_formulario" (
    "form_id" SERIAL NOT NULL,
    "form_numero" INTEGER NOT NULL,
    "form_codigo" VARCHAR(40) NOT NULL,
    "form_nombre" VARCHAR(160) NOT NULL,
    "form_color_fondo" CHAR(7) NOT NULL,
    "form_color_acento" CHAR(7) NOT NULL,
    "form_color_nombre" VARCHAR(40) NOT NULL,
    "form_rol_dueno" "e_rol_departamental" NOT NULL,
    "form_rol_compartido" "e_rol_departamental",
    "form_cupo_compartido" INTEGER,
    "form_politica_vehiculo" "e_politica_vehiculo" NOT NULL DEFAULT 'CONDICIONAL',
    "form_condicionante_noct" BOOLEAN NOT NULL DEFAULT false,
    "form_es_patrulla" BOOLEAN NOT NULL DEFAULT false,
    "form_orden" INTEGER NOT NULL,
    "form_vigencia_desde" DATE,
    "form_vigencia_hasta" DATE,
    "form_activo" BOOLEAN NOT NULL DEFAULT true,
    "form_creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_formulario_pkey" PRIMARY KEY ("form_id")
);

-- CreateTable
CREATE TABLE "t_formulario_prefijo" (
    "fpre_id" SERIAL NOT NULL,
    "form_id" INTEGER NOT NULL,
    "fpre_prefijo" VARCHAR(12) NOT NULL,
    "fpre_area_aplica" "e_area_personal",
    "fpre_es_predeterminado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "t_formulario_prefijo_pkey" PRIMARY KEY ("fpre_id")
);

-- CreateTable
CREATE TABLE "t_formulario_area" (
    "form_id" INTEGER NOT NULL,
    "farea_area" "e_area_personal" NOT NULL,
    "farea_es_compartida" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "t_formulario_area_pkey" PRIMARY KEY ("form_id","farea_area")
);

-- CreateTable
CREATE TABLE "t_zonal" (
    "zona_id" SERIAL NOT NULL,
    "zona_codigo" VARCHAR(30) NOT NULL,
    "zona_nombre" VARCHAR(90) NOT NULL,
    "zona_es_dmq" BOOLEAN NOT NULL DEFAULT false,
    "zona_orden" INTEGER NOT NULL,
    "zona_activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "t_zonal_pkey" PRIMARY KEY ("zona_id")
);

-- CreateTable
CREATE TABLE "t_punto_encuentro" (
    "pcto_id" SERIAL NOT NULL,
    "pcto_nombre" VARCHAR(200) NOT NULL,
    "zona_id" INTEGER NOT NULL,
    "pcto_activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "t_punto_encuentro_pkey" PRIMARY KEY ("pcto_id")
);

-- CreateTable
CREATE TABLE "t_tipo_control" (
    "tico_id" SERIAL NOT NULL,
    "tico_nombre" VARCHAR(200) NOT NULL,
    "tico_activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "t_tipo_control_pkey" PRIMARY KEY ("tico_id")
);

-- CreateTable
CREATE TABLE "t_institucion" (
    "inst_id" SERIAL NOT NULL,
    "inst_sigla" VARCHAR(40) NOT NULL,
    "inst_nombre" VARCHAR(200) NOT NULL,
    "inst_activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "t_institucion_pkey" PRIMARY KEY ("inst_id")
);

-- CreateTable
CREATE TABLE "t_formulario_punto" (
    "form_id" INTEGER NOT NULL,
    "pcto_id" INTEGER NOT NULL,

    CONSTRAINT "t_formulario_punto_pkey" PRIMARY KEY ("form_id","pcto_id")
);

-- CreateTable
CREATE TABLE "t_formulario_tipo_control" (
    "form_id" INTEGER NOT NULL,
    "tico_id" INTEGER NOT NULL,

    CONSTRAINT "t_formulario_tipo_control_pkey" PRIMARY KEY ("form_id","tico_id")
);

-- CreateTable
CREATE TABLE "t_formulario_institucion" (
    "form_id" INTEGER NOT NULL,
    "inst_id" INTEGER NOT NULL,

    CONSTRAINT "t_formulario_institucion_pkey" PRIMARY KEY ("form_id","inst_id")
);

-- CreateTable
CREATE TABLE "t_ventana_carga" (
    "vcar_id" SERIAL NOT NULL,
    "vcar_rol" "e_rol_departamental" NOT NULL,
    "vcar_tipo" "e_tipo_ventana" NOT NULL,
    "vcar_dia_apertura" SMALLINT,
    "vcar_hora_apertura" VARCHAR(5),
    "vcar_dia_cierre" SMALLINT,
    "vcar_hora_cierre" VARCHAR(5),
    "vcar_zona_horaria" VARCHAR(60) NOT NULL DEFAULT 'America/Guayaquil',
    "vcar_mensaje_cierre" VARCHAR(400) NOT NULL,
    "vcar_activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "t_ventana_carga_pkey" PRIMARY KEY ("vcar_id")
);

-- CreateTable
CREATE TABLE "t_parametro_politica" (
    "para_id" SERIAL NOT NULL,
    "para_clave" VARCHAR(60) NOT NULL,
    "para_valor" VARCHAR(120) NOT NULL,
    "para_tipo" "e_tipo_parametro" NOT NULL,
    "para_descripcion" VARCHAR(300) NOT NULL,
    "para_unidad" VARCHAR(30),
    "para_minimo" VARCHAR(120),
    "para_maximo" VARCHAR(120),
    "para_modificado_por" INTEGER,
    "para_modificado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_parametro_politica_pkey" PRIMARY KEY ("para_id")
);

-- CreateTable
CREATE TABLE "t_funcionario" (
    "func_id" SERIAL NOT NULL,
    "func_cedula" VARCHAR(13) NOT NULL,
    "func_apellidos" VARCHAR(90) NOT NULL,
    "func_nombres" VARCHAR(90) NOT NULL,
    "func_telefono" VARCHAR(20),
    "func_cargo" VARCHAR(90),
    "func_area" "e_area_personal" NOT NULL,
    "func_tipo_contrato" "e_tipo_contrato" NOT NULL,
    "func_direccion" "e_rol_departamental" NOT NULL,
    "func_activo" BOOLEAN NOT NULL DEFAULT true,
    "func_creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "func_actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "t_funcionario_pkey" PRIMARY KEY ("func_id")
);

-- CreateTable
CREATE TABLE "t_conductor" (
    "cond_id" SERIAL NOT NULL,
    "cond_cedula" VARCHAR(13) NOT NULL,
    "cond_nombre_completo" VARCHAR(160) NOT NULL,
    "cond_telefono" VARCHAR(20),
    "cond_licencia_tipo" VARCHAR(10),
    "vehi_id" INTEGER,
    "cond_activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "t_conductor_pkey" PRIMARY KEY ("cond_id")
);

-- CreateTable
CREATE TABLE "t_vehiculo" (
    "vehi_id" SERIAL NOT NULL,
    "vehi_placa" VARCHAR(10) NOT NULL,
    "vehi_descripcion" VARCHAR(160),
    "vehi_activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "t_vehiculo_pkey" PRIMARY KEY ("vehi_id")
);

-- CreateTable
CREATE TABLE "t_disponibilidad" (
    "disp_id" SERIAL NOT NULL,
    "func_id" INTEGER,
    "cond_id" INTEGER,
    "vehi_id" INTEGER,
    "disp_estado" "e_estado_disponibilidad" NOT NULL,
    "disp_desde" DATE NOT NULL,
    "disp_hasta" DATE NOT NULL,
    "disp_motivo" VARCHAR(220),
    "disp_registrado_por" INTEGER NOT NULL,
    "disp_creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_disponibilidad_pkey" PRIMARY KEY ("disp_id")
);

-- CreateTable
CREATE TABLE "t_historial_jornada" (
    "hist_id" SERIAL NOT NULL,
    "func_id" INTEGER NOT NULL,
    "hist_fecha" DATE NOT NULL,
    "hist_fue_patrulla" BOOLEAN NOT NULL DEFAULT false,
    "hist_fue_nocturna" BOOLEAN NOT NULL DEFAULT false,
    "hist_fue_fin_semana" BOOLEAN NOT NULL DEFAULT false,
    "hist_horas_jornada" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "hist_operativos" SMALLINT NOT NULL DEFAULT 0,
    "hist_consolidado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_historial_jornada_pkey" PRIMARY KEY ("hist_id")
);

-- CreateTable
CREATE TABLE "t_cuadro_diario" (
    "cuad_id" SERIAL NOT NULL,
    "cuad_fecha" DATE NOT NULL,
    "cuad_orden_trabajo" VARCHAR(40) NOT NULL,
    "cuad_nro_semana" SMALLINT NOT NULL,
    "cuad_anio_semana" SMALLINT NOT NULL,
    "cuad_estado" "e_estado_cuadro" NOT NULL DEFAULT 'BORRADOR',
    "cuad_cerrado_por" INTEGER,
    "cuad_cerrado_en" TIMESTAMPTZ(3),
    "cuad_reaperturas" SMALLINT NOT NULL DEFAULT 0,
    "cuad_creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_cuadro_diario_pkey" PRIMARY KEY ("cuad_id")
);

-- CreateTable
CREATE TABLE "t_operativo" (
    "oper_id" SERIAL NOT NULL,
    "cuad_id" INTEGER NOT NULL,
    "form_id" INTEGER NOT NULL,
    "oper_identificador" VARCHAR(50) NOT NULL,
    "oper_secuencial" INTEGER NOT NULL,
    "oper_hora_inicio" VARCHAR(5) NOT NULL,
    "oper_hora_fin" VARCHAR(5) NOT NULL,
    "oper_es_nocturno" BOOLEAN NOT NULL DEFAULT false,
    "oper_cruza_medianoche" BOOLEAN NOT NULL DEFAULT false,
    "oper_duracion_horas" DECIMAL(4,1) NOT NULL,
    "pcto_id" INTEGER,
    "oper_punto_libre" VARCHAR(220),
    "tico_id" INTEGER,
    "oper_tipo_libre" VARCHAR(220),
    "oper_estado_transporte" "e_estado_transporte" NOT NULL DEFAULT 'PENDIENTE',
    "cond_id" INTEGER,
    "vehi_id" INTEGER,
    "oper_asignado_en" TIMESTAMPTZ(3),
    "oper_observaciones" TEXT,
    "oper_alerta_activa" BOOLEAN NOT NULL DEFAULT true,
    "oper_alertas" JSONB,
    "oper_creado_por_rol" "e_rol_departamental" NOT NULL,
    "oper_creado_por" INTEGER NOT NULL,
    "oper_modificado_por_rol" "e_rol_departamental" NOT NULL,
    "oper_modificado_por" INTEGER NOT NULL,
    "oper_version" INTEGER NOT NULL DEFAULT 1,
    "oper_creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oper_actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "t_operativo_pkey" PRIMARY KEY ("oper_id")
);

-- CreateTable
CREATE TABLE "t_asignacion_personal" (
    "aper_id" SERIAL NOT NULL,
    "oper_id" INTEGER NOT NULL,
    "func_id" INTEGER NOT NULL,
    "aper_asignado_por_rol" "e_rol_departamental" NOT NULL,
    "aper_es_responsable" BOOLEAN NOT NULL DEFAULT false,
    "aper_creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_asignacion_personal_pkey" PRIMARY KEY ("aper_id")
);

-- CreateTable
CREATE TABLE "t_operativo_zonal" (
    "oper_id" INTEGER NOT NULL,
    "zona_id" INTEGER NOT NULL,
    "ozon_orden" SMALLINT NOT NULL DEFAULT 1,

    CONSTRAINT "t_operativo_zonal_pkey" PRIMARY KEY ("oper_id","zona_id")
);

-- CreateTable
CREATE TABLE "t_operativo_institucion" (
    "oper_id" INTEGER NOT NULL,
    "inst_id" INTEGER NOT NULL,

    CONSTRAINT "t_operativo_institucion_pkey" PRIMARY KEY ("oper_id","inst_id")
);

-- CreateTable
CREATE TABLE "t_solicitud_apoyo" (
    "sapo_id" SERIAL NOT NULL,
    "oper_id" INTEGER NOT NULL,
    "sapo_rol_solicitante" "e_rol_departamental" NOT NULL,
    "sapo_rol_requerido" "e_rol_departamental" NOT NULL,
    "sapo_area_requerida" "e_area_personal",
    "sapo_cantidad" SMALLINT NOT NULL DEFAULT 1,
    "sapo_estado" "e_estado_solicitud" NOT NULL DEFAULT 'SOLICITADA',
    "sapo_observacion" VARCHAR(400),
    "sapo_creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_solicitud_apoyo_pkey" PRIMARY KEY ("sapo_id")
);

-- CreateTable
CREATE TABLE "t_capacidad_flota" (
    "capa_id" SERIAL NOT NULL,
    "cuad_id" INTEGER NOT NULL,
    "capa_fecha" DATE NOT NULL,
    "capa_vehiculos_habiles" SMALLINT NOT NULL,
    "capa_conductores_habiles" SMALLINT NOT NULL,
    "capa_observacion" VARCHAR(300),
    "capa_declarado_por" INTEGER NOT NULL,
    "capa_declarado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_capacidad_flota_pkey" PRIMARY KEY ("capa_id")
);

-- CreateTable
CREATE TABLE "t_orden_servicio" (
    "oser_id" SERIAL NOT NULL,
    "oper_id" INTEGER NOT NULL,
    "func_id" INTEGER NOT NULL,
    "oser_codigo" VARCHAR(50) NOT NULL,
    "oser_dato_aislado" JSONB NOT NULL,
    "oser_emitida_por" INTEGER NOT NULL,
    "oser_emitida_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oser_vigente" BOOLEAN NOT NULL DEFAULT true,
    "oser_ruta_pdf" VARCHAR(300),

    CONSTRAINT "t_orden_servicio_pkey" PRIMARY KEY ("oser_id")
);

-- CreateTable
CREATE TABLE "t_auditoria" (
    "audi_id" BIGSERIAL NOT NULL,
    "oper_id" INTEGER,
    "audi_entidad" VARCHAR(60) NOT NULL,
    "audi_entidad_id" INTEGER NOT NULL,
    "audi_accion" "e_accion_auditoria" NOT NULL,
    "audi_campo" VARCHAR(60),
    "audi_valor_anterior" TEXT,
    "audi_valor_nuevo" TEXT,
    "audi_usuario" INTEGER NOT NULL,
    "audi_rol" "e_rol_departamental" NOT NULL,
    "audi_correlacion" VARCHAR(60),
    "audi_momento" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_auditoria_pkey" PRIMARY KEY ("audi_id")
);

-- CreateTable
CREATE TABLE "t_usuario" (
    "usua_id" SERIAL NOT NULL,
    "usua_correo" VARCHAR(160) NOT NULL,
    "usua_nombre" VARCHAR(160) NOT NULL,
    "usua_rol" "e_rol_departamental" NOT NULL,
    "usua_identificador_ad" VARCHAR(120),
    "usua_activo" BOOLEAN NOT NULL DEFAULT true,
    "usua_creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_usuario_pkey" PRIMARY KEY ("usua_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_formulario_numero" ON "t_formulario"("form_numero");

-- CreateIndex
CREATE UNIQUE INDEX "uq_formulario_codigo" ON "t_formulario"("form_codigo");

-- CreateIndex
CREATE INDEX "idx_formulario_orden" ON "t_formulario"("form_orden");

-- CreateIndex
CREATE INDEX "idx_formulario_rol_dueno" ON "t_formulario"("form_rol_dueno");

-- CreateIndex
CREATE INDEX "idx_formulario_prefijo_form" ON "t_formulario_prefijo"("form_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_formulario_prefijo_area" ON "t_formulario_prefijo"("form_id", "fpre_area_aplica");

-- CreateIndex
CREATE UNIQUE INDEX "uq_zonal_codigo" ON "t_zonal"("zona_codigo");

-- CreateIndex
CREATE INDEX "idx_punto_zonal" ON "t_punto_encuentro"("zona_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_punto_nombre_zonal" ON "t_punto_encuentro"("pcto_nombre", "zona_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tipo_control_nombre" ON "t_tipo_control"("tico_nombre");

-- CreateIndex
CREATE UNIQUE INDEX "uq_institucion_sigla" ON "t_institucion"("inst_sigla");

-- CreateIndex
CREATE INDEX "idx_formulario_punto_form" ON "t_formulario_punto"("form_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ventana_rol" ON "t_ventana_carga"("vcar_rol");

-- CreateIndex
CREATE UNIQUE INDEX "uq_parametro_clave" ON "t_parametro_politica"("para_clave");

-- CreateIndex
CREATE UNIQUE INDEX "uq_funcionario_cedula" ON "t_funcionario"("func_cedula");

-- CreateIndex
CREATE INDEX "idx_funcionario_area" ON "t_funcionario"("func_area");

-- CreateIndex
CREATE INDEX "idx_funcionario_contrato" ON "t_funcionario"("func_tipo_contrato");

-- CreateIndex
CREATE UNIQUE INDEX "uq_conductor_cedula" ON "t_conductor"("cond_cedula");

-- CreateIndex
CREATE INDEX "idx_conductor_vehiculo" ON "t_conductor"("vehi_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_vehiculo_placa" ON "t_vehiculo"("vehi_placa");

-- CreateIndex
CREATE INDEX "idx_disponibilidad_func" ON "t_disponibilidad"("func_id", "disp_desde", "disp_hasta");

-- CreateIndex
CREATE INDEX "idx_disponibilidad_cond" ON "t_disponibilidad"("cond_id", "disp_desde", "disp_hasta");

-- CreateIndex
CREATE INDEX "idx_disponibilidad_vehi" ON "t_disponibilidad"("vehi_id", "disp_desde", "disp_hasta");

-- CreateIndex
CREATE INDEX "idx_historial_func_fecha" ON "t_historial_jornada"("func_id", "hist_fecha" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_historial_func_fecha" ON "t_historial_jornada"("func_id", "hist_fecha");

-- CreateIndex
CREATE UNIQUE INDEX "uq_cuadro_fecha" ON "t_cuadro_diario"("cuad_fecha");

-- CreateIndex
CREATE UNIQUE INDEX "uq_cuadro_orden" ON "t_cuadro_diario"("cuad_orden_trabajo");

-- CreateIndex
CREATE INDEX "idx_cuadro_fecha_estado" ON "t_cuadro_diario"("cuad_fecha" DESC, "cuad_estado");

-- CreateIndex
CREATE INDEX "idx_operativo_cuad_form" ON "t_operativo"("cuad_id", "form_id", "oper_secuencial");

-- CreateIndex
CREATE INDEX "idx_operativo_transporte" ON "t_operativo"("cuad_id", "oper_estado_transporte");

-- CreateIndex
CREATE INDEX "idx_operativo_conductor" ON "t_operativo"("cond_id", "oper_hora_inicio", "oper_hora_fin");

-- CreateIndex
CREATE INDEX "idx_operativo_creador" ON "t_operativo"("oper_creado_por_rol", "cuad_id");

-- CreateIndex
CREATE INDEX "idx_operativo_punto" ON "t_operativo"("pcto_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_operativo_cuad_ident" ON "t_operativo"("cuad_id", "oper_identificador");

-- CreateIndex
CREATE UNIQUE INDEX "uq_operativo_cuad_form_sec" ON "t_operativo"("cuad_id", "form_id", "oper_secuencial");

-- CreateIndex
CREATE INDEX "idx_asignacion_funcionario" ON "t_asignacion_personal"("func_id");

-- CreateIndex
CREATE INDEX "idx_asignacion_operativo" ON "t_asignacion_personal"("oper_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_asignacion_oper_func" ON "t_asignacion_personal"("oper_id", "func_id");

-- CreateIndex
CREATE INDEX "idx_operativo_zonal_zona" ON "t_operativo_zonal"("zona_id");

-- CreateIndex
CREATE INDEX "idx_solicitud_requerido" ON "t_solicitud_apoyo"("sapo_rol_requerido", "sapo_estado");

-- CreateIndex
CREATE UNIQUE INDEX "uq_capacidad_cuadro" ON "t_capacidad_flota"("cuad_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_capacidad_fecha" ON "t_capacidad_flota"("capa_fecha");

-- CreateIndex
CREATE UNIQUE INDEX "uq_orden_codigo" ON "t_orden_servicio"("oser_codigo");

-- CreateIndex
CREATE INDEX "idx_orden_funcionario" ON "t_orden_servicio"("func_id", "oser_emitida_en" DESC);

-- CreateIndex
CREATE INDEX "idx_orden_operativo" ON "t_orden_servicio"("oper_id");

-- CreateIndex
CREATE INDEX "idx_auditoria_operativo" ON "t_auditoria"("oper_id", "audi_momento" DESC);

-- CreateIndex
CREATE INDEX "idx_auditoria_entidad" ON "t_auditoria"("audi_entidad", "audi_entidad_id");

-- CreateIndex
CREATE INDEX "idx_auditoria_momento" ON "t_auditoria"("audi_momento" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_usuario_correo" ON "t_usuario"("usua_correo");

-- CreateIndex
CREATE INDEX "idx_usuario_rol" ON "t_usuario"("usua_rol", "usua_activo");

-- AddForeignKey
ALTER TABLE "t_formulario_prefijo" ADD CONSTRAINT "fk_formulario_prefijo_formulario" FOREIGN KEY ("form_id") REFERENCES "t_formulario"("form_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_formulario_area" ADD CONSTRAINT "fk_formulario_area_formulario" FOREIGN KEY ("form_id") REFERENCES "t_formulario"("form_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_punto_encuentro" ADD CONSTRAINT "fk_punto_zonal" FOREIGN KEY ("zona_id") REFERENCES "t_zonal"("zona_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_formulario_punto" ADD CONSTRAINT "fk_form_punto_form" FOREIGN KEY ("form_id") REFERENCES "t_formulario"("form_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_formulario_punto" ADD CONSTRAINT "fk_form_punto_punto" FOREIGN KEY ("pcto_id") REFERENCES "t_punto_encuentro"("pcto_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_formulario_tipo_control" ADD CONSTRAINT "fk_form_tico_form" FOREIGN KEY ("form_id") REFERENCES "t_formulario"("form_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_formulario_tipo_control" ADD CONSTRAINT "fk_form_tico_tico" FOREIGN KEY ("tico_id") REFERENCES "t_tipo_control"("tico_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_formulario_institucion" ADD CONSTRAINT "fk_form_inst_form" FOREIGN KEY ("form_id") REFERENCES "t_formulario"("form_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_formulario_institucion" ADD CONSTRAINT "fk_form_inst_inst" FOREIGN KEY ("inst_id") REFERENCES "t_institucion"("inst_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_conductor" ADD CONSTRAINT "fk_conductor_vehiculo" FOREIGN KEY ("vehi_id") REFERENCES "t_vehiculo"("vehi_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_disponibilidad" ADD CONSTRAINT "fk_disponibilidad_funcionario" FOREIGN KEY ("func_id") REFERENCES "t_funcionario"("func_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_disponibilidad" ADD CONSTRAINT "fk_disponibilidad_conductor" FOREIGN KEY ("cond_id") REFERENCES "t_conductor"("cond_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_disponibilidad" ADD CONSTRAINT "fk_disponibilidad_vehiculo" FOREIGN KEY ("vehi_id") REFERENCES "t_vehiculo"("vehi_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_historial_jornada" ADD CONSTRAINT "fk_historial_funcionario" FOREIGN KEY ("func_id") REFERENCES "t_funcionario"("func_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_operativo" ADD CONSTRAINT "fk_operativo_cuadro" FOREIGN KEY ("cuad_id") REFERENCES "t_cuadro_diario"("cuad_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_operativo" ADD CONSTRAINT "fk_operativo_formulario" FOREIGN KEY ("form_id") REFERENCES "t_formulario"("form_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_operativo" ADD CONSTRAINT "fk_operativo_punto" FOREIGN KEY ("pcto_id") REFERENCES "t_punto_encuentro"("pcto_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_operativo" ADD CONSTRAINT "fk_operativo_tipo" FOREIGN KEY ("tico_id") REFERENCES "t_tipo_control"("tico_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_operativo" ADD CONSTRAINT "fk_operativo_conductor" FOREIGN KEY ("cond_id") REFERENCES "t_conductor"("cond_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_operativo" ADD CONSTRAINT "fk_operativo_vehiculo" FOREIGN KEY ("vehi_id") REFERENCES "t_vehiculo"("vehi_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_asignacion_personal" ADD CONSTRAINT "fk_asignacion_operativo" FOREIGN KEY ("oper_id") REFERENCES "t_operativo"("oper_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_asignacion_personal" ADD CONSTRAINT "fk_asignacion_funcionario" FOREIGN KEY ("func_id") REFERENCES "t_funcionario"("func_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_operativo_zonal" ADD CONSTRAINT "fk_oper_zonal_operativo" FOREIGN KEY ("oper_id") REFERENCES "t_operativo"("oper_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_operativo_zonal" ADD CONSTRAINT "fk_oper_zonal_zonal" FOREIGN KEY ("zona_id") REFERENCES "t_zonal"("zona_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_operativo_institucion" ADD CONSTRAINT "fk_oper_inst_operativo" FOREIGN KEY ("oper_id") REFERENCES "t_operativo"("oper_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_operativo_institucion" ADD CONSTRAINT "fk_oper_inst_institucion" FOREIGN KEY ("inst_id") REFERENCES "t_institucion"("inst_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_solicitud_apoyo" ADD CONSTRAINT "fk_solicitud_operativo" FOREIGN KEY ("oper_id") REFERENCES "t_operativo"("oper_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_capacidad_flota" ADD CONSTRAINT "fk_capacidad_cuadro" FOREIGN KEY ("cuad_id") REFERENCES "t_cuadro_diario"("cuad_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_orden_servicio" ADD CONSTRAINT "fk_orden_operativo" FOREIGN KEY ("oper_id") REFERENCES "t_operativo"("oper_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_orden_servicio" ADD CONSTRAINT "fk_orden_funcionario" FOREIGN KEY ("func_id") REFERENCES "t_funcionario"("func_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "t_auditoria" ADD CONSTRAINT "fk_auditoria_operativo" FOREIGN KEY ("oper_id") REFERENCES "t_operativo"("oper_id") ON DELETE SET NULL ON UPDATE CASCADE;
