-- Config del memorando POR CUADRO (una fila por fecha de jornada, 2026-10-02).
-- El numero de memorando, el NUT y quien elabora son del DIA, no de cada orden: todas las
-- ordenes de esa jornada los comparten. Los tres admiten NULL = sin configurar.
CREATE TABLE "t_orden_config_cuadro" (
    "ocuc_fecha" DATE NOT NULL,
    "ocuc_numero_memorando" VARCHAR(120),
    "ocuc_nut" VARCHAR(120),
    "ocuc_elaborado_por" VARCHAR(200),
    "ocuc_creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ocuc_actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "t_orden_config_cuadro_pkey" PRIMARY KEY ("ocuc_fecha")
);
