-- Microservicio: transporte
-- Modulo: Cuadro de Colores
-- Archivo: migration.sql
-- Responsabilidad: Trasladar los catalogos institucionales a la base y retirar su
--                  dependencia de los archivos de insumo.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-08-19
--
-- POR QUE. Hasta hoy estos datos vivian en prisma/insumos/*.json y solo entraban si
-- alguien ejecutaba `npx prisma db seed`. La verdad estaba en dos sitios -el archivo y la
-- tabla- y un despliegue quedaba a medias si ese paso se olvidaba. Ahora viven AQUI: en el
-- historial de migraciones, que es la definicion de la base, y `migrate deploy` los aplica
-- sin ningun paso extra.
--
-- DE DONDE SALEN. Del volcado de la base en marcha el 2026-08-19, que era la fuente de
-- verdad vigente. No se transcribieron a mano.
--
-- QUE NO ESTA AQUI, Y ES DELIBERADO:
--
--   · t_usuario          son personas y cambian por ambiente. Una migracion crearia las
--                        mismas cuentas en produccion que en desarrollo.
--   · t_punto_encuentro  lo carga el administrador desde P-08. Es dato operativo, no
--                        catalogo: incluirlo replicaria las filas de prueba de alguien.
--
-- ES IDEMPOTENTE. Cada INSERT lleva ON CONFLICT DO NOTHING: aplicarla sobre una base ya
-- poblada -como la de desarrollo hoy- no altera ni duplica nada.
--
-- EL ORDEN NO ES ALFABETICO SINO POR DEPENDENCIA. Las tablas de union referencian a
-- t_formulario, t_institucion y t_tipo_control, y `pg_dump --data-only` NO garantiza un
-- orden que respete las claves foraneas. Se ordeno a mano contra pg_constraint.

-- ═══════════════ 1. Catalogos que van en TODAS las bases ═══════════════

-- t_zonal · 11 filas
INSERT INTO public.t_zonal (zona_id, zona_codigo, zona_nombre, zona_es_dmq, zona_orden, zona_activo) VALUES (1, 'EUGENIO_ESPEJO', 'Zonal Eugenio Espejo', false, 1, true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_zonal (zona_id, zona_codigo, zona_nombre, zona_es_dmq, zona_orden, zona_activo) VALUES (2, 'LA_DELICIA', 'Zonal La Delicia', false, 2, true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_zonal (zona_id, zona_codigo, zona_nombre, zona_es_dmq, zona_orden, zona_activo) VALUES (3, 'CALDERON', 'Zonal Calderón', false, 3, true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_zonal (zona_id, zona_codigo, zona_nombre, zona_es_dmq, zona_orden, zona_activo) VALUES (4, 'ELOY_ALFARO', 'Zonal Eloy Alfaro', false, 4, true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_zonal (zona_id, zona_codigo, zona_nombre, zona_es_dmq, zona_orden, zona_activo) VALUES (5, 'QUITUMBE', 'Zonal Quitumbe', false, 5, true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_zonal (zona_id, zona_codigo, zona_nombre, zona_es_dmq, zona_orden, zona_activo) VALUES (6, 'LA_MARISCAL', 'Zonal La Mariscal', false, 6, true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_zonal (zona_id, zona_codigo, zona_nombre, zona_es_dmq, zona_orden, zona_activo) VALUES (7, 'MANUELA_SAENZ', 'Zonal Manuela Sáenz', false, 7, true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_zonal (zona_id, zona_codigo, zona_nombre, zona_es_dmq, zona_orden, zona_activo) VALUES (8, 'VALLE_DE_LOS_CHILLOS', 'Zonal Valle de los Chillos', false, 8, true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_zonal (zona_id, zona_codigo, zona_nombre, zona_es_dmq, zona_orden, zona_activo) VALUES (9, 'TUMBACO', 'Zonal Tumbaco', false, 9, true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_zonal (zona_id, zona_codigo, zona_nombre, zona_es_dmq, zona_orden, zona_activo) VALUES (10, 'CHOCO_ANDINO', 'Zonal Chocó Andino', false, 10, true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_zonal (zona_id, zona_codigo, zona_nombre, zona_es_dmq, zona_orden, zona_activo) VALUES (11, 'DMQ', 'DMQ', true, 11, true) ON CONFLICT DO NOTHING;

-- t_tipo_control · 44 filas
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (1, 'CONTROL ESPACIO PÚBLICO', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (2, 'CONTROL LICENCIAMIENTO', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (3, 'CONTROL LIBADORES', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (4, 'CONTROL ESPACIO PÚBLICO - LICENCIAMIENTO', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (5, 'CONTROL LICENCIAMIENTO - LIBADORES', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (6, 'CONTROL ESPACIO PÚBLICO - LICENCIAMIENTO - LIBADORES', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (7, 'CONTROL ESPACIO PÚBLICO - LIBADORES', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (8, 'CONTROL ESPACIO PÚBLICO (TODAS LAS FACULTADES)', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (9, 'Alertas ECU 911', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (10, 'INTERVENCIONES DE CONTROL', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (11, 'OPERATIVOS DE CONTROL', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (12, 'INTERVENCIONES DE CONTROL - ADICIONAL', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (13, 'OPERATIVOS DE CONTROL - ADICIONAL', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (14, 'Quito en Control', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (15, 'Incivilidades Control de Licenciamiento y Libadores', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (16, 'Control de todas las competencias de AMC', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (17, 'CONTROL DE FAUNA URBANA', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (18, 'ACCIONES OPERATIVAS Y DE CONTROL EN EL DMQ', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (19, 'ATENCIÓN A DENUNCIAS', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (20, 'CONTROL DE LICENCIAMIENTO, ATENCIÓN DE DENUNCIAS Y REINSPECCIONES', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (21, 'CONTROL DE ESPACIO PÚBLICO EN EVENTO', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (22, 'ENTREGA DE ACTAS DE ADVERTENCIA', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (23, 'PROGRAMACION DE CONTROL DE OFICIO', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (24, 'DENUNCIAS CIUDADANAS', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (25, 'DERIVACIÓN INTERINSTITUCIONAL', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (26, 'RE-INSPECCIÓN POR CADUCIDAD', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (27, 'RE-INSPECCIÓN POR NULIDAD TOTAL', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (28, 'RE-INSPECCIÓN INEXISTENCIA', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (29, 'RE-INSPECCIÓN POR INSTRUCCIÓN', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (30, 'RE-INSPECCIÓN POR APELACIÓN', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (31, 'RE-INSPECCIÓN EN ACTUACIÓN PREVIA', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (32, 'RE-INSPECCIÓN POR INADMISIÓN', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (33, 'RE-INSPECCIÓN POR ADVERTENCIA', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (34, 'RE-INSPECCIÓN CON DRON - SUSTANCIACIÓN  ACTUACIÓN PREVIA', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (35, 'RE-INSPECCIÓN CON DRON - POR FALTA DE ELEMENTOS', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (36, 'RE-INSPECCIÓN CON DRON', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (37, 'reinspección por falta de elementos', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (38, 'EMERGENCIAS', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (39, 'REDES SOCIALES', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (40, 'MEDIOS DE COMUNICACIÓN', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (41, 'CCF / ITCC', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (42, 'IVA', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (43, 'RE-INSPECCIÓN DENTRO DE LA SUSTANCIACIÓN ACTUACIÓN PREVIA', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_tipo_control (tico_id, tico_nombre, tico_activo) VALUES (44, 'RE-INSPECCIÓN POR EJECUCIÓN', true) ON CONFLICT DO NOTHING;

-- t_institucion · 16 filas
INSERT INTO public.t_institucion (inst_id, inst_sigla, inst_nombre, inst_activo) VALUES (1, 'AMC', 'AMC', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_institucion (inst_id, inst_sigla, inst_nombre, inst_activo) VALUES (2, 'Secretaría de Seguridad', 'Secretaría de Seguridad', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_institucion (inst_id, inst_sigla, inst_nombre, inst_activo) VALUES (3, 'CACMQ', 'CACMQ', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_institucion (inst_id, inst_sigla, inst_nombre, inst_activo) VALUES (4, 'PPNN', 'PPNN', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_institucion (inst_id, inst_sigla, inst_nombre, inst_activo) VALUES (5, 'EMGIRS', 'EMGIRS', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_institucion (inst_id, inst_sigla, inst_nombre, inst_activo) VALUES (6, 'Comisaría', 'Comisaría', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_institucion (inst_id, inst_sigla, inst_nombre, inst_activo) VALUES (7, 'Fuerzas Armadas', 'Fuerzas Armadas', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_institucion (inst_id, inst_sigla, inst_nombre, inst_activo) VALUES (8, 'Administración Zonal', 'Administración Zonal', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_institucion (inst_id, inst_sigla, inst_nombre, inst_activo) VALUES (9, 'AMT', 'AMT', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_institucion (inst_id, inst_sigla, inst_nombre, inst_activo) VALUES (10, 'Cuerpo de Bomberos de Quito', 'Cuerpo de Bomberos de Quito', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_institucion (inst_id, inst_sigla, inst_nombre, inst_activo) VALUES (11, 'Migración', 'Migración', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_institucion (inst_id, inst_sigla, inst_nombre, inst_activo) VALUES (12, 'COE', 'COE', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_institucion (inst_id, inst_sigla, inst_nombre, inst_activo) VALUES (13, 'Jefatura Zonal', 'Jefatura Zonal', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_institucion (inst_id, inst_sigla, inst_nombre, inst_activo) VALUES (14, 'EPMMOP', 'EPMMOP', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_institucion (inst_id, inst_sigla, inst_nombre, inst_activo) VALUES (15, 'Administración Seguridad', 'Administración Seguridad', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_institucion (inst_id, inst_sigla, inst_nombre, inst_activo) VALUES (16, 'CBQ', 'CBQ', true) ON CONFLICT DO NOTHING;

-- t_ventana_carga · 6 filas
INSERT INTO public.t_ventana_carga (vcar_id, vcar_rol, vcar_tipo, vcar_dia_apertura, vcar_hora_apertura, vcar_dia_cierre, vcar_hora_cierre, vcar_zona_horaria, vcar_mensaje_cierre, vcar_activo) VALUES (1, 'DMIP_OPERATIVOS', 'DIARIO', NULL, NULL, NULL, '15:00', 'America/Guayaquil', 'La ventana de carga de su departamento cerró a las 15H00. Vuelve a abrirse mañana.', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_ventana_carga (vcar_id, vcar_rol, vcar_tipo, vcar_dia_apertura, vcar_hora_apertura, vcar_dia_cierre, vcar_hora_cierre, vcar_zona_horaria, vcar_mensaje_cierre, vcar_activo) VALUES (3, 'DMIT_INSTRUCTOR', 'DIARIO', NULL, NULL, NULL, '15:00', 'America/Guayaquil', 'La ventana de carga de su departamento cerró a las 15H00. Vuelve a abrirse mañana.', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_ventana_carga (vcar_id, vcar_rol, vcar_tipo, vcar_dia_apertura, vcar_hora_apertura, vcar_dia_cierre, vcar_hora_cierre, vcar_zona_horaria, vcar_mensaje_cierre, vcar_activo) VALUES (4, 'DAF', 'DIARIO', NULL, '15:00', NULL, '16:30', 'America/Guayaquil', 'La ventana de asignación de transporte va de 15H00 a 16H30. Fuera de ese intervalo no se puede asignar conductor ni vehículo.', true) ON CONFLICT DO NOTHING;
INSERT INTO public.t_ventana_carga (vcar_id, vcar_rol, vcar_tipo, vcar_dia_apertura, vcar_hora_apertura, vcar_dia_cierre, vcar_hora_cierre, vcar_zona_horaria, vcar_mensaje_cierre, vcar_activo) VALUES (5, 'DIRECTOR', 'DIARIO', NULL, NULL, NULL, NULL, 'America/Guayaquil', 'Sin restricción horaria. Ninguna fuente define una ventana para la Dirección.', false) ON CONFLICT DO NOTHING;
INSERT INTO public.t_ventana_carga (vcar_id, vcar_rol, vcar_tipo, vcar_dia_apertura, vcar_hora_apertura, vcar_dia_cierre, vcar_hora_cierre, vcar_zona_horaria, vcar_mensaje_cierre, vcar_activo) VALUES (6, 'ADMINISTRADOR', 'DIARIO', NULL, NULL, NULL, NULL, 'America/Guayaquil', 'Sin restricción horaria. Ninguna fuente define una ventana para la administración.', false) ON CONFLICT DO NOTHING;
INSERT INTO public.t_ventana_carga (vcar_id, vcar_rol, vcar_tipo, vcar_dia_apertura, vcar_hora_apertura, vcar_dia_cierre, vcar_hora_cierre, vcar_zona_horaria, vcar_mensaje_cierre, vcar_activo) VALUES (2, 'DMIP_INSPECCIONES', 'DIARIO', NULL, NULL, NULL, '15:00', 'America/Guayaquil', 'La ventana de carga de su departamento cerró a las 15H00. Vuelve a abrirse mañana.', true) ON CONFLICT DO NOTHING;

-- t_parametro_politica · 8 filas
INSERT INTO public.t_parametro_politica (para_id, para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en) VALUES (5, 'HORA_LIMITE_CUADRO', '16:30', 'TEXTO', 'RN-57. Hora a la que el cuadro debe estar cerrado y disponible.', NULL, NULL, NULL, NULL, '2026-08-18 12:09:26.394-05') ON CONFLICT DO NOTHING;
INSERT INTO public.t_parametro_politica (para_id, para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en) VALUES (6, 'FRANJA_NOCTURNA_INICIO', '20:00', 'TEXTO', 'RN-43. Inicio de la franja nocturna que activa el condicionante de conductor.', NULL, NULL, NULL, NULL, '2026-08-18 12:09:26.396-05') ON CONFLICT DO NOTHING;
INSERT INTO public.t_parametro_politica (para_id, para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en) VALUES (7, 'FRANJA_NOCTURNA_FIN', '05:00', 'TEXTO', 'RN-43. Fin de la franja nocturna.', NULL, NULL, NULL, NULL, '2026-08-18 12:09:26.397-05') ON CONFLICT DO NOTHING;
INSERT INTO public.t_parametro_politica (para_id, para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en) VALUES (8, 'DIAS_DESCANSO_PATRULLA', '1', 'ENTERO', 'RN-24. Días sin patrulla tras haber salido en patrulla. Protege el descanso del personal.', 'días', '1', '3', 6, '2026-08-18 12:09:26.399-05') ON CONFLICT DO NOTHING;
INSERT INTO public.t_parametro_politica (para_id, para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en) VALUES (1, 'JORNADA_MAXIMA_HORAS', '12', 'DECIMAL', 'RN-36. Horas máximas que una persona puede acumular en una jornada. Las fuentes describen dieciséis horas como la situación a evitar.', 'horas', '8', '16', 6, '2026-08-18 12:09:26.382-05') ON CONFLICT DO NOTHING;
INSERT INTO public.t_parametro_politica (para_id, para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en) VALUES (2, 'TOPE_SALIDAS_PESADAS', '3', 'ENTERO', 'RN-25. Máximo de salidas nocturnas o de fin de semana por persona en el período de cómputo.', 'salidas', '1', '6', NULL, '2026-08-18 12:09:26.388-05') ON CONFLICT DO NOTHING;
INSERT INTO public.t_parametro_politica (para_id, para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en) VALUES (3, 'PERIODO_COMPUTO_SALIDAS', 'MENSUAL', 'TEXTO', 'RN-37. Período sobre el que se cuenta el tope de salidas pesadas. Valores: SEMANAL, QUINCENAL, MENSUAL.', NULL, NULL, NULL, NULL, '2026-08-18 12:09:26.39-05') ON CONFLICT DO NOTHING;
INSERT INTO public.t_parametro_politica (para_id, para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en) VALUES (4, 'HORA_CIERRE_DEPARTAMENTAL', '15:00', 'TEXTO', 'RN-59. Hora de cierre de la carga departamental. PV-06: las fuentes indican 14H00 en una sesión y 15H00 en otra, ambas del mismo interlocutor.', NULL, NULL, NULL, NULL, '2026-08-18 12:09:26.392-05') ON CONFLICT DO NOTHING;

-- ═══════════════ 2. Los nueve formularios · NO en la base de pruebas ═══════════════
--
-- `ck_formulario_numero` acota el numero ENTRE 1 Y 9: hay exactamente nueve casilleros y
-- son los del negocio. Las suites de integracion crean los suyos dentro de ese rango -usan
-- el 2,3,5,6,7,8,9-, asi que si el catalogo institucional los ocupa, no queda ninguno y
-- las 283 pruebas fallan. No es aislamiento por prefijo: el recurso es finito por diseno.
--
-- Es el mismo criterio que ya aplicaba prisma/seed.ts antes de esta migracion.

DO $catalogo$
BEGIN
  IF current_database() = 'transportedb_pruebas' THEN
    RAISE NOTICE 'Base de pruebas: se omiten los nueve formularios institucionales.';
    RETURN;
  END IF;

  -- t_formulario · 9 filas
  INSERT INTO public.t_formulario (form_id, form_numero, form_codigo, form_nombre, form_color_fondo, form_color_acento, form_color_nombre, form_rol_dueno, form_rol_compartido, form_cupo_compartido, form_politica_vehiculo, form_condicionante_noct, form_es_patrulla, form_orden, form_vigencia_desde, form_vigencia_hasta, form_activo, form_creado_en, form_captura_libre_punto, form_captura_libre_tipo) VALUES (239, 1, 'FIJOS', 'OPERATIVOS DE CONTROL FIJOS', '#A2C4C9', '#000000', 'Verde azulado', 'DMIP_OPERATIVOS', NULL, NULL, 'NO_APLICA', false, false, 1, NULL, NULL, true, '2026-08-07 08:47:09.412-05', false, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario (form_id, form_numero, form_codigo, form_nombre, form_color_fondo, form_color_acento, form_color_nombre, form_rol_dueno, form_rol_compartido, form_cupo_compartido, form_politica_vehiculo, form_condicionante_noct, form_es_patrulla, form_orden, form_vigencia_desde, form_vigencia_hasta, form_activo, form_creado_en, form_captura_libre_punto, form_captura_libre_tipo) VALUES (240, 2, 'PMO', 'CONTROL DE PUNTO DE MANDO OPERATIVO (PMO)', '#FCE5CD', '#000000', 'Naranja claro', 'DMIP_OPERATIVOS', NULL, NULL, 'CONDICIONAL', true, false, 2, NULL, NULL, true, '2026-08-07 08:47:09.48-05', false, true) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario (form_id, form_numero, form_codigo, form_nombre, form_color_fondo, form_color_acento, form_color_nombre, form_rol_dueno, form_rol_compartido, form_cupo_compartido, form_politica_vehiculo, form_condicionante_noct, form_es_patrulla, form_orden, form_vigencia_desde, form_vigencia_hasta, form_activo, form_creado_en, form_captura_libre_punto, form_captura_libre_tipo) VALUES (241, 3, 'LIMPIA', 'OPERATIVOS DE CONTROL LIMPIAPARABRISAS', '#B4C6E7', '#000000', 'Azul', 'DMIP_OPERATIVOS', NULL, NULL, 'NO_APLICA', false, false, 3, NULL, NULL, true, '2026-08-07 08:47:09.53-05', false, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario (form_id, form_numero, form_codigo, form_nombre, form_color_fondo, form_color_acento, form_color_nombre, form_rol_dueno, form_rol_compartido, form_cupo_compartido, form_politica_vehiculo, form_condicionante_noct, form_es_patrulla, form_orden, form_vigencia_desde, form_vigencia_hasta, form_activo, form_creado_en, form_captura_libre_punto, form_captura_libre_tipo) VALUES (242, 4, 'ECU', 'PATRULLA ECU DIURNA', '#D9D9D9', '#000000', 'Gris', 'DMIP_OPERATIVOS', NULL, NULL, 'REQUERIDO', false, true, 4, NULL, NULL, true, '2026-08-07 08:47:09.551-05', false, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario (form_id, form_numero, form_codigo, form_nombre, form_color_fondo, form_color_acento, form_color_nombre, form_rol_dueno, form_rol_compartido, form_cupo_compartido, form_politica_vehiculo, form_condicionante_noct, form_es_patrulla, form_orden, form_vigencia_desde, form_vigencia_hasta, form_activo, form_creado_en, form_captura_libre_punto, form_captura_libre_tipo) VALUES (243, 5, 'REACD', 'PATRULLA REACCIÓN DIURNA (UIG - UIT)', '#FFCCCC', '#000000', 'Rosado', 'DMIP_INSPECCIONES', NULL, NULL, 'REQUERIDO', true, true, 5, NULL, NULL, true, '2026-08-07 08:47:09.587-05', false, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario (form_id, form_numero, form_codigo, form_nombre, form_color_fondo, form_color_acento, form_color_nombre, form_rol_dueno, form_rol_compartido, form_cupo_compartido, form_politica_vehiculo, form_condicionante_noct, form_es_patrulla, form_orden, form_vigencia_desde, form_vigencia_hasta, form_activo, form_creado_en, form_captura_libre_punto, form_captura_libre_tipo) VALUES (244, 6, 'REACN', 'PATRULLA REACCIÓN NOCTURNA', '#F4CCCC', '#000000', 'Rojo claro', 'DMIP_INSPECCIONES', 'DMIT_INSTRUCTOR', 1, 'REQUERIDO', true, true, 6, NULL, NULL, true, '2026-08-07 08:47:09.618-05', false, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario (form_id, form_numero, form_codigo, form_nombre, form_color_fondo, form_color_acento, form_color_nombre, form_rol_dueno, form_rol_compartido, form_cupo_compartido, form_politica_vehiculo, form_condicionante_noct, form_es_patrulla, form_orden, form_vigencia_desde, form_vigencia_hasta, form_activo, form_creado_en, form_captura_libre_punto, form_captura_libre_tipo) VALUES (245, 7, 'DMIT', 'OPERATIVO DMIT', '#FCE4D6', '#000000', 'Naranja fuerte', 'DMIT_INSTRUCTOR', NULL, NULL, 'REQUERIDO', true, false, 7, NULL, NULL, true, '2026-08-07 08:47:09.66-05', false, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario (form_id, form_numero, form_codigo, form_nombre, form_color_fondo, form_color_acento, form_color_nombre, form_rol_dueno, form_rol_compartido, form_cupo_compartido, form_politica_vehiculo, form_condicionante_noct, form_es_patrulla, form_orden, form_vigencia_desde, form_vigencia_hasta, form_activo, form_creado_en, form_captura_libre_punto, form_captura_libre_tipo) VALUES (246, 8, 'INSP', 'INSPECCIONES TÉCNICAS Y GENERALES', '#CCCCFF', '#000000', 'Morado', 'DMIP_INSPECCIONES', NULL, NULL, 'OBLIGATORIO', false, false, 8, NULL, NULL, true, '2026-08-07 08:47:09.8-05', false, true) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario (form_id, form_numero, form_codigo, form_nombre, form_color_fondo, form_color_acento, form_color_nombre, form_rol_dueno, form_rol_compartido, form_cupo_compartido, form_politica_vehiculo, form_condicionante_noct, form_es_patrulla, form_orden, form_vigencia_desde, form_vigencia_hasta, form_activo, form_creado_en, form_captura_libre_punto, form_captura_libre_tipo) VALUES (247, 9, 'CBQ', 'OPERATIVO DE CONTROL AMC-CBQ', '#D9EAD3', '#000000', 'Verde pastel', 'DMIT_INSTRUCTOR', NULL, NULL, 'NO_APLICA', true, true, 9, NULL, NULL, true, '2026-08-07 08:47:09.905-05', false, false) ON CONFLICT DO NOTHING;

  -- t_formulario_prefijo · 19 filas
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (70, 239, 'OCF', NULL, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (71, 240, 'OCPMO', NULL, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (72, 240, 'OCAPMO', NULL, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (73, 241, 'OCL', NULL, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (74, 242, 'OCECU', NULL, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (75, 243, 'IGECU', NULL, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (76, 243, 'ITECU', NULL, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (77, 244, 'ICNECU', NULL, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (78, 244, 'IGNECU', NULL, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (79, 244, 'ITNECU', NULL, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (80, 245, 'OC', NULL, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (81, 245, 'IC', NULL, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (82, 245, 'OCA', NULL, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (83, 245, 'ICA', NULL, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (84, 246, 'IG', NULL, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (85, 246, 'IT', NULL, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (86, 246, 'IGA', NULL, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (87, 246, 'ITA', NULL, false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_prefijo (fpre_id, form_id, fpre_prefijo, fpre_area_aplica, fpre_es_predeterminado) VALUES (88, 247, 'OCB', NULL, false) ON CONFLICT DO NOTHING;

  -- t_formulario_area · 15 filas
  INSERT INTO public.t_formulario_area (form_id, farea_area, farea_es_compartida) VALUES (239, 'OPERATIVOS', false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_area (form_id, farea_area, farea_es_compartida) VALUES (240, 'OPERATIVOS', false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_area (form_id, farea_area, farea_es_compartida) VALUES (241, 'OPERATIVOS', false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_area (form_id, farea_area, farea_es_compartida) VALUES (242, 'INSTRUCCION', false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_area (form_id, farea_area, farea_es_compartida) VALUES (242, 'OPERATIVOS', false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_area (form_id, farea_area, farea_es_compartida) VALUES (243, 'GENERAL', false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_area (form_id, farea_area, farea_es_compartida) VALUES (243, 'TECNICO', false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_area (form_id, farea_area, farea_es_compartida) VALUES (244, 'INSTRUCCION', true) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_area (form_id, farea_area, farea_es_compartida) VALUES (244, 'GENERAL', false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_area (form_id, farea_area, farea_es_compartida) VALUES (244, 'TECNICO', false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_area (form_id, farea_area, farea_es_compartida) VALUES (245, 'INSTRUCCION', false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_area (form_id, farea_area, farea_es_compartida) VALUES (245, 'OPERATIVOS', false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_area (form_id, farea_area, farea_es_compartida) VALUES (246, 'GENERAL', false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_area (form_id, farea_area, farea_es_compartida) VALUES (246, 'TECNICO', false) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_area (form_id, farea_area, farea_es_compartida) VALUES (247, 'INSTRUCCION', false) ON CONFLICT DO NOTHING;

  -- t_formulario_tipo_control · 64 filas
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (239, 1) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (239, 2) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (239, 3) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (239, 4) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (239, 5) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (239, 6) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (239, 7) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (239, 8) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (240, 1) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (240, 2) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (240, 3) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (240, 4) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (240, 5) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (240, 6) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (240, 7) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (240, 8) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (241, 8) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (242, 9) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (243, 9) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (244, 9) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 10) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 11) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 12) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 13) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 1) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 2) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 3) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 4) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 5) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 6) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 7) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 8) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 14) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 15) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 16) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 17) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 18) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 19) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 20) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 21) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (245, 22) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 23) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 24) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 25) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 26) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 27) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 28) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 29) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 30) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 31) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 32) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 33) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 34) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 35) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 36) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 37) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 38) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 39) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 40) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 41) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 42) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 43) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (246, 44) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_tipo_control (form_id, tico_id) VALUES (247, 16) ON CONFLICT DO NOTHING;

  -- t_formulario_institucion · 47 filas
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (239, 1) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (239, 2) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (239, 3) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (240, 1) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (240, 2) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (240, 3) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (241, 1) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (241, 2) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (241, 3) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (242, 1) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (242, 2) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (242, 3) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (242, 4) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (242, 5) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (243, 1) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (243, 2) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (243, 3) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (243, 4) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (243, 5) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (244, 1) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (244, 2) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (244, 3) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (244, 4) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (244, 5) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (245, 1) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (245, 2) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (245, 3) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (245, 4) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (245, 6) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (245, 7) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (245, 8) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (245, 9) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (245, 10) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (245, 11) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (245, 5) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (245, 12) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (245, 13) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (245, 14) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (245, 15) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (246, 1) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (246, 2) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (246, 3) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (246, 4) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (246, 5) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (247, 1) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (247, 16) ON CONFLICT DO NOTHING;
  INSERT INTO public.t_formulario_institucion (form_id, inst_id) VALUES (247, 3) ON CONFLICT DO NOTHING;
END
$catalogo$;

-- ═══════════════ 3. Secuencias ═══════════════
--
-- IMPRESCINDIBLE Y FACIL DE OLVIDAR. Los INSERT llevan el identificador explicito, asi que
-- la secuencia NO avanza sola: sin esto, el primer alta que hiciera un administrador
-- reutilizaria un identificador existente y chocaria con la clave primaria.

SELECT pg_catalog.setval('public.t_formulario_form_id_seq', 304, true);
SELECT pg_catalog.setval('public.t_formulario_prefijo_fpre_id_seq', 88, true);
SELECT pg_catalog.setval('public.t_institucion_inst_id_seq', 350, true);
SELECT pg_catalog.setval('public.t_parametro_politica_para_id_seq', 152, true);
SELECT pg_catalog.setval('public.t_tipo_control_tico_id_seq', 120, true);
SELECT pg_catalog.setval('public.t_ventana_carga_vcar_id_seq', 129, true);
SELECT pg_catalog.setval('public.t_zonal_zona_id_seq', 211, true);

-- ═══════════════ 4. Estadisticas del planificador ═══════════════
--
-- Lo hacia la semilla y se conserva aqui. El motivo es concreto: sin ANALYZE, el
-- planificador cree que estas tablas siguen vacias y elige recorridos secuenciales
-- durante el primer uso, hasta que autovacuum pase por su cuenta. ANALYZE si puede
-- correr dentro de una transaccion; VACUUM no.
ANALYZE;
