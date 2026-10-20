/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Persistencia
 * Archivo: verificar-objetos.ts
 * Responsabilidad: Comprobar que las restricciones e índices que Prisma no expresa
 *                  siguen presentes en la base tras cada migración estructural.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * Motivo: Prisma no conoce las restricciones CHECK ni los predicados de índice. Al
 * regenerar una tabla puede perderlos sin avisar, y el defecto solo se notaría el día
 * en que la base admita un dato que jamás debió aceptar. Ver prisma/README.md.
 *
 * Uso: npm run prisma:verificar
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Restricciones de verificación esperadas. Fuente: migración 0002. */
const RESTRICCIONES_ESPERADAS = [
  'ck_operativo_hora_inicio',
  'ck_operativo_hora_fin',
  'ck_operativo_duracion',
  'ck_operativo_punto',
  'ck_operativo_tipo',
  'ck_operativo_transporte',
  'ck_operativo_secuencial',
  'ck_operativo_version',
  'ck_disponibilidad_sujeto',
  'ck_disponibilidad_rango',
  'ck_formulario_numero',
  'ck_formulario_color_fondo',
  'ck_formulario_color_acento',
  'ck_formulario_vigencia',
  // `ck_formulario_compartido` estuvo aquí hasta hoy y la base ya no lo tiene: la
  // migración `20260825160000_un_formulario_admite_varios_roles` lo eliminó junto con las
  // columnas `form_rol_compartido` y `form_cupo_compartido` que verificaba. Este guion no
  // se actualizó entonces, así que llevaba fallando desde el 25-AGO.
  'ck_cuadro_semana',
  'ck_cuadro_cierre',
  'ck_ventana_horas',
  'ck_ventana_dias',
  'ck_capacidad_positiva',
  'ck_historial_horas',
  'ck_solicitud_cantidad',
  'ck_parametro_valor',
  'ck_parametro_rango',
  // 2026-08-20: un operativo no puede ser adicional de sí mismo.
  'ck_operativo_origen',
  // 2026-08-31, del levantamiento con la DAF. Las tres protegen invariantes que Prisma no
  // puede expresar, y las tres son de las que fallan en silencio si una migración futura
  // regenerara la tabla: la base admitiría un taller en la vacación de un funcionario, o
  // un destino que no dice a dónde va el vehículo.
  'ck_disponibilidad_taller',
  'ck_disponibilidad_hora',
  'ck_destino_sujeto',
  'ck_ubicacion_nombre',
  // 2026-09-01. Un rol no se administra a si mismo: la fila seria redundante en el mejor
  // caso y enganiosa en el peor, porque haria creer que es ella la que concede el acceso.
  'ck_rol_direccion_distinta',
  // 2026-09-08. La ventana horaria propia de una persona en un operativo (override
  // opcional): horas en :00/:30 (RN-07), las dos juntas o ambas NULL, e inicio distinto
  // de fin. Protegen la ventana por persona igual que ck_operativo_hora_* protege la del
  // operativo.
  'ck_asignacion_hora_inicio',
  'ck_asignacion_hora_fin',
  'ck_asignacion_hora_par',
  'ck_asignacion_hora_distinta',
  // 2026-10-06. Transporte por tramos: un tramo es de un operativo salvo la TAREA; sus horas
  // HH:MM distintas; un traslado entre 0 y 600 minutos; el mes de turnos como AAAA-MM.
  'ck_tramo_operativo',
  'ck_tramo_horas',
  'ck_traslado_minutos',
  'ck_turno_conductor_mes_formato',
  // 2026-10-06, Fase 5. Operación diaria de la flota: kilometrajes no negativos y el vale de
  // combustible solo de 10 o 20 dólares.
  'ck_checklist_km',
  'ck_kilometraje_km',
  'ck_vale_monto',
  // 2026-10-07, versión consolidada DAF: el patrón de rotación del conductor (D/N/E/L/A, 2 a 14).
  'ck_conductor_patron_rotacion',
  // 2026-10-07. El trámite de Inspección copiado a una asignación siempre lleva su código.
  'ck_tramite_inspeccion_codigo',
  // 2026-10-19. Compartir unidad: un operativo no comparte consigo mismo, y compartir excluye el
  // vehículo exclusivo (macrooperativo).
  'ck_operativo_compartir_no_propio',
  'ck_operativo_compartir_o_exclusivo',
];

/**
 * Índices con predicado esperados. Fuente: migración 0003 y la del 2026-08-20.
 *
 * `uq_operativo_cuad_form_sec` y su gemelo `_adic` SE RETIRARON el 2026-09-17: las patrullas
 * (Form 5/6) numeran POR PREFIJO —cada área desde 001, así que `IGNECU-001`/`ITNECU-001`/
 * `INECU-001` comparten `(cuadro, formulario, secuencial)` y colisionarían en ese índice—. La
 * unicidad del secuencial la garantiza `uq_operativo_cuad_ident` (cuadro, identificador): como la
 * fecha es constante por cuadro, equivale a unicidad por cuadro+prefijo+secuencial. Ver la
 * migración 20260917140000.
 */
const INDICES_PARCIALES_ESPERADOS = [
  'idx_operativo_conductor',
  'idx_operativo_vehiculo',
  'idx_operativo_alerta',
  'idx_historial_pesadas',
  'idx_disponibilidad_func',
  'idx_disponibilidad_cond',
  'idx_funcionario_area',
  'uq_orden_vigente',
  'idx_operativo_origen',
  // Solo el reparto vigente: se consulta al resolver el alcance de quien administra.
  'idx_rol_direccion_rol',
  // Plantilla por Director (2026-10-05): una por Director, una sola base, y el número AMC-OS único
  // solo entre las órdenes VIGENTES (la reemisión conserva el número).
  'uq_plantilla_director',
  'uq_plantilla_base',
  'uq_orden_numero_vigente',
  // 2026-10-19. Quiénes piden viajar con un operativo (compartir unidad).
  'idx_operativo_compartir_con',
];

// 33 desde el 2026-09-01, cuando entro t_rol_direccion -que direcciones administra cada
// rol-. Antes 32, desde el 2026-08-31, y las tres de entonces no se contaron cuando toco:
//
//   · t_formulario_rol      (25-AGO) que puede hacer cada rol en cada formulario.
//   · t_ubicacion_flota     (31-AGO) zonales donde puede quedar un vehiculo. RN-DAF-03.
//   · t_destino_vehiculo    (31-AGO) donde queda cada vehiculo al terminar el dia.
//
// Antes fueron 29, desde el 19-AGO: t_rol_auth -homologacion con Auth central- y
// t_usuario_rol -una persona puede tener varios roles-.
//
// 32 desde el 2026-09-07: se retiro t_formulario_tipo_control al pasar los tipos de control
// a pertenecer a UN formulario (el vinculo dejo de ser N:M y paso a FK directa).
//
// 33 el mismo dia: entro t_operativo_tipo_control -varios tipos por operativo, solo donde el
// formulario lo admite (form 8)-.
//
// 34 desde el 2026-09-09: t_operativo_observacion -las observaciones pasaron de un campo unico
// a NOTAS independientes (bitacora append-only), y el campo oper_observaciones se retiro-.
// 35 desde el 2026-09-15: t_plantilla_orden -la plantilla editable de la orden de servicio-.
// 36 desde el 2026-09-16: t_cobertura_turno -la cobertura mensual por turnos de Instruccion-.
//
// 37 desde el 2026-09-29: se retiraron t_formulario_punto y t_formulario_institucion (dos
// tablas puente) al pasar puntos de encuentro e instituciones a pertenecer a UN formulario
// -columna form_id propia-, como ya se hizo con los tipos de control (misma receta). 39 - 2 = 37.
//
// 38 desde el 2026-10-02: t_secuencia_orden -el contador anual del numero AMC-OS de la orden-.
// 39 desde el 2026-10-02: t_orden_config_cuadro -el numero de memorando, el NUT y quien elabora
// son del DIA, no de cada orden: una fila por fecha de jornada (D13)-.
// 40 desde el 2026-10-05: t_plantilla_orden_version -historial inmutable de la plantilla de cada
// Director; una orden se resuelve con la versión con la que se generó-.
// 41 desde el 2026-10-05: t_cobertura_mes -estado informativo (borrador/publicado) del mes de la
// cobertura por turnos de Instruccion-.
// 46 desde el 2026-10-06: transporte por tramos y turnos de conductores -t_tramo_transporte,
// t_traslado_zonal, t_turno_conductor, t_turno_conductor_mes y t_activacion_conductor-.
// 49 desde el 2026-10-06 (Fase 5): t_checklist_vehiculo, t_kilometraje_vehiculo y
// t_vale_combustible.
// 50 desde el 2026-10-07: t_operativo_tramite_inspeccion -copia del trámite de Inspección elegido
// para un inspector asignado-.
// 52 desde el 2026-10-08: t_vehiculo_jornada -qué vehículos salen el día- y t_hoja_ruta_emision
// -cuándo y con qué huella de tramos se emitió la hoja de ruta de cada conductor-.
// 53 desde el 2026-10-13: t_zonal_formulario -cada formulario con sus propias zonales; t_zonal
// queda como la zona de la ciudad-.
const TABLAS_ESPERADAS = 53;

// 13: los 11 originales mas e_acceso_formulario (25-AGO) y e_sector_ciudad (31-AGO).
// El primero tampoco se conto en su momento: este guion llevaba fallando desde entonces.
// 15 desde el 2026-09-16: e_denominacion_instruccion y e_estado_turno (cobertura por turnos).
// 16 desde el 2026-10-05: e_estado_cobertura_mes.
// 20 desde el 2026-10-06: e_tipo_transporte, e_tipo_tramo, e_turno_conductor y
// e_tipo_ubicacion_vehiculo.
// 21 desde el 2026-10-06 (Fase 5): e_estado_mantenimiento.
const ENUMERADOS_ESPERADOS = 21;

async function verificar(): Promise<void> {
  const fallos: string[] = [];

  const tablas = await prisma.$queryRaw<{ total: bigint }[]>`
    SELECT count(*)::bigint AS total FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 't\\_%'`;
  const totalTablas = Number(tablas[0].total);
  if (totalTablas !== TABLAS_ESPERADAS) {
    fallos.push(
      `Tablas: se esperaban ${TABLAS_ESPERADAS} y hay ${totalTablas}.`,
    );
  }

  const enumerados = await prisma.$queryRaw<{ total: bigint }[]>`
    SELECT count(*)::bigint AS total FROM pg_type WHERE typtype = 'e'`;
  const totalEnumerados = Number(enumerados[0].total);
  if (totalEnumerados !== ENUMERADOS_ESPERADOS) {
    fallos.push(
      `Enumerados: se esperaban ${ENUMERADOS_ESPERADOS} y hay ${totalEnumerados}.`,
    );
  }

  const restricciones = await prisma.$queryRaw<{ conname: string }[]>`
    SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname LIKE 'ck\\_%'`;
  const presentes = new Set(restricciones.map((fila) => fila.conname));
  for (const esperada of RESTRICCIONES_ESPERADAS) {
    if (!presentes.has(esperada)) {
      fallos.push(`Falta la restricción de verificación ${esperada}.`);
    }
  }

  const indices = await prisma.$queryRaw<{ relname: string }[]>`
    SELECT c.relname FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indpred IS NOT NULL`;
  const indicesPresentes = new Set(indices.map((fila) => fila.relname));
  for (const esperado of INDICES_PARCIALES_ESPERADOS) {
    if (!indicesPresentes.has(esperado)) {
      fallos.push(
        `El índice ${esperado} no existe o perdió su predicado: dejó de ser parcial.`,
      );
    }
  }

  if (fallos.length > 0) {
    /* eslint-disable no-console */
    console.error('\nVERIFICACIÓN FALLIDA\n');
    fallos.forEach((fallo) => console.error(`  · ${fallo}`));
    console.error(
      '\nRevise la última migración: pudo regenerar una tabla y perder estos objetos.',
    );
    console.error('Ver prisma/README.md.\n');
    /* eslint-enable no-console */
    process.exitCode = 1;
    return;
  }

  /* eslint-disable-next-line no-console */
  console.log(
    `Verificación correcta: ${totalTablas} tablas, ${totalEnumerados} enumerados, ` +
      `${RESTRICCIONES_ESPERADAS.length} restricciones y ${INDICES_PARCIALES_ESPERADOS.length} índices parciales.`,
  );
}

verificar()
  .catch((error: unknown) => {
    /* eslint-disable-next-line no-console */
    console.error('No se pudo verificar la base:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
