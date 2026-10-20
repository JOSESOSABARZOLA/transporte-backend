/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · ocupación por tramos
 * Archivo: tramos-desde-asignacion-clasica.logica.ts
 * Responsabilidad: Pasar a tramos las asignaciones de transporte hechas con la ruta clásica.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-14
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * POR QUÉ HACE FALTA. Desde el 2026-10-14 la ocupación de un conductor o un vehículo sale SOLO de
 * `t_tramo_transporte`. Un operativo que la DAF asignó por la ruta clásica (`PATCH
 * /transporte/operativos/:id`, antes de esa fecha) tiene `cond_id`/`vehi_id` en `t_operativo` pero
 * ningún tramo asignado: para la agenda, ese conductor estaría LIBRE a esa hora y se le podría
 * asignar otra cosa. Este script le crea sus tramos con ese conductor y ese vehículo.
 *
 * PRIMERO SE MIRA, LUEGO SE TOCA (mismo patrón que `limpieza-catalogos.logica.ts`):
 *   1. `planificarTramosClasicos` solo LEE: operativos ACTIVOS, ASIGNADOS, con conductor y
 *      vehículo y SIN ningún tramo asignado, y los tramos que les tocarían por su tipo de transporte
 *      (`planificarTramos`, la misma política que «Planificar el día»).
 *   2. `formatearReporte` lo escribe para una persona.
 *   3. `aplicarTramosClasicos`, solo con `--aplicar --usuario=<id>`: en UNA transacción, por cada
 *      operativo borra sus tramos SIN conductor (si los tenía) y crea los del plan con ese conductor
 *      y vehículo, con su traza en `t_auditoria` (correlación `tramos-clasicos-AAAA-MM-DD`).
 *
 * Un operativo cuyo tipo no pide transporte (PROPIOS_MEDIOS) pero conserva conductor es un dato
 * inconsistente: se REPORTA como «requiere decisión» y no se toca.
 *
 * IDEMPOTENTE: lo aplicado ya tiene tramos asignados y deja de cumplir el criterio, así que una
 * segunda corrida planifica 0.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  AccionAuditoria,
  EstadoTransporte,
  RolDepartamental,
  TipoTramo,
  type PrismaClient,
} from '@prisma/client';

import {
  planificarTramos,
  type DuracionesTramo,
  type TramoPlanificado,
} from '../modules/transporte/application/politicas/plan-tramos';

/** Lo que el script necesita del cliente de Prisma. */
export type ClienteTramosClasicos = Pick<
  PrismaClient,
  '$transaction' | 'operativo' | 'parametroPolitica' | 'usuario'
>;

export interface OpcionesTramosClasicos {
  aplicar: boolean;
  usuarioId: number | null;
}

export interface OperativoClasico {
  id: number;
  identificador: string;
  fecha: Date;
  conductorId: number;
  vehiculoId: number;
  tramosLibres: number;
  tramos: TramoPlanificado[];
}

export interface PlanTramosClasicos {
  duraciones: DuracionesTramo;
  aConvertir: OperativoClasico[];
  /** Con conductor pero sin transporte que pedir (PROPIOS_MEDIOS): se reportan, no se tocan. */
  requierenDecision: { id: number; identificador: string; fecha: Date }[];
}

const fechaTexto = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/** Las duraciones vigentes, con la misma regla que `ParametrosTransporteService` (D7). */
async function leerDuraciones(
  db: ClienteTramosClasicos,
): Promise<DuracionesTramo> {
  const filas = await db.parametroPolitica.findMany({
    where: {
      clave: {
        in: [
          'DAF_DURACION_TRAMO_MIN',
          'DAF_DURACION_DEJAR_MIN',
          'DAF_DURACION_RETIRAR_MIN',
        ],
      },
    },
    select: { clave: true, valor: true },
  });
  const valor = (clave: string): number | null => {
    const numero = Number(filas.find((f) => f.clave === clave)?.valor);
    return Number.isInteger(numero) && numero > 0 ? numero : null;
  };
  const general = valor('DAF_DURACION_TRAMO_MIN');
  if (general === null) {
    throw new Error(
      'El parámetro DAF_DURACION_TRAMO_MIN no está configurado: no se pueden cortar los tramos.',
    );
  }
  return {
    dejar: valor('DAF_DURACION_DEJAR_MIN') ?? general,
    retirar: valor('DAF_DURACION_RETIRAR_MIN') ?? general,
  };
}

/** Paso 1: solo lee. */
export async function planificarTramosClasicos(
  db: ClienteTramosClasicos,
): Promise<PlanTramosClasicos> {
  const duraciones = await leerDuraciones(db);
  const operativos = await db.operativo.findMany({
    where: {
      activo: true,
      estadoTransporte: EstadoTransporte.ASIGNADO,
      conductorId: { not: null },
      vehiculoId: { not: null },
      tramos: { none: { conductorId: { not: null } } },
    },
    select: {
      id: true,
      identificador: true,
      horaInicio: true,
      horaFin: true,
      tipoTransporte: true,
      conductorId: true,
      vehiculoId: true,
      cuadro: { select: { fecha: true } },
      zonales: {
        select: { zonalId: true },
        orderBy: { orden: 'asc' },
        take: 1,
      },
      _count: { select: { tramos: true } },
    },
    orderBy: [{ cuadro: { fecha: 'asc' } }, { identificador: 'asc' }],
  });

  const plan: PlanTramosClasicos = {
    duraciones,
    aConvertir: [],
    requierenDecision: [],
  };
  for (const o of operativos) {
    const tramos = planificarTramos(
      {
        horaInicio: o.horaInicio,
        horaFin: o.horaFin,
        tipoTransporte: o.tipoTransporte,
        zonalId: o.zonales[0]?.zonalId ?? null,
      },
      duraciones,
    );
    if (tramos.length === 0) {
      plan.requierenDecision.push({
        id: o.id,
        identificador: o.identificador,
        fecha: o.cuadro.fecha,
      });
      continue;
    }
    plan.aConvertir.push({
      id: o.id,
      identificador: o.identificador,
      fecha: o.cuadro.fecha,
      conductorId: o.conductorId as number,
      vehiculoId: o.vehiculoId as number,
      tramosLibres: o._count.tramos,
      tramos,
    });
  }
  return plan;
}

/** Paso 2: el reporte para una persona. */
export function formatearReporte(
  plan: PlanTramosClasicos,
  opciones: OpcionesTramosClasicos,
): string {
  const lineas = [
    'Tramos desde la asignación clásica — ' +
      (opciones.aplicar
        ? 'APLICAR'
        : 'solo reporte (sin --aplicar no se escribe nada)'),
    `Duraciones: dejar ${plan.duraciones.dejar} min, retirar ${plan.duraciones.retirar} min.`,
    '',
    `Operativos asignados sin tramos: ${plan.aConvertir.length}`,
    ...plan.aConvertir.map(
      (o) =>
        `  · ${fechaTexto(o.fecha)} ${o.identificador}: conductor ${o.conductorId}, vehículo ${o.vehiculoId} → ` +
        o.tramos
          .map((t) => `${t.tipo} ${t.horaInicio}-${t.horaFin}`)
          .join(', ') +
        (o.tramosLibres > 0
          ? ` (se reemplazan ${o.tramosLibres} tramo(s) sin conductor)`
          : ''),
    ),
    '',
    `Requieren decisión (con conductor pero sin transporte que pedir): ${plan.requierenDecision.length}`,
    ...plan.requierenDecision.map(
      (o) => `  · ${fechaTexto(o.fecha)} ${o.identificador}`,
    ),
  ];
  return lineas.join('\n');
}

/** Paso 3: escribe, en UNA transacción y con su traza. */
export async function aplicarTramosClasicos(
  db: ClienteTramosClasicos,
  plan: PlanTramosClasicos,
  opciones: OpcionesTramosClasicos,
  hoy: Date = new Date(),
): Promise<number> {
  const usuarioId = opciones.usuarioId;
  if (usuarioId === null) {
    throw new Error(
      'Para aplicar indique --usuario=<id>: es quien firma la traza.',
    );
  }
  const usuario = await db.usuario.findUnique({
    where: { id: usuarioId },
    select: { id: true },
  });
  if (!usuario) throw new Error(`No existe el usuario ${usuarioId}.`);
  const correlacion = `tramos-clasicos-${fechaTexto(hoy)}`;

  return db.$transaction(async (tx) => {
    for (const o of plan.aConvertir) {
      await tx.tramoTransporte.deleteMany({
        where: { operativoId: o.id, conductorId: null },
      });
      await tx.tramoTransporte.createMany({
        data: o.tramos.map((t) => ({
          operativoId: o.id,
          fecha: o.fecha,
          tipo: t.tipo as TipoTramo,
          horaInicio: t.horaInicio,
          horaFin: t.horaFin,
          cruzaMedianoche: t.cruzaMedianoche,
          zonalOrigenId: t.zonalOrigenId,
          zonalDestinoId: t.zonalDestinoId,
          conductorId: o.conductorId,
          vehiculoId: o.vehiculoId,
          creadoPor: usuarioId,
        })),
      });
      await tx.auditoria.createMany({
        data: [
          {
            campo: 'tramos_desde_asignacion_clasica',
            valorNuevo: o.tramos
              .map((t) => `${t.tipo} ${t.horaInicio}-${t.horaFin}`)
              .join(', '),
          },
          { campo: 'cond_id', valorNuevo: String(o.conductorId) },
          { campo: 'vehi_id', valorNuevo: String(o.vehiculoId) },
        ].map((cambio) => ({
          entidad: 't_tramo_transporte',
          entidadId: o.id,
          operativoId: o.id,
          accion: AccionAuditoria.CREAR,
          usuario: usuarioId,
          rol: RolDepartamental.ADMINISTRADOR,
          correlacion,
          ...cambio,
        })),
      });
    }
    return plan.aConvertir.length;
  });
}

export function leerOpciones(
  argumentos: readonly string[],
): OpcionesTramosClasicos {
  const usuario = argumentos
    .find((a) => a.startsWith('--usuario='))
    ?.slice('--usuario='.length);
  const usuarioId = usuario ? Number(usuario) : null;
  return {
    aplicar: argumentos.includes('--aplicar'),
    usuarioId:
      usuarioId !== null && Number.isInteger(usuarioId) ? usuarioId : null,
  };
}

export async function ejecutarTramosClasicos(
  db: ClienteTramosClasicos,
  opciones: OpcionesTramosClasicos,
  escribir: (texto: string) => void,
): Promise<number | null> {
  const plan = await planificarTramosClasicos(db);
  escribir(formatearReporte(plan, opciones));

  if (!opciones.aplicar) return null;
  if (plan.aConvertir.length === 0) {
    escribir('Nada que aplicar.');
    return null;
  }
  const aplicados = await aplicarTramosClasicos(db, plan, opciones);
  escribir(`Aplicado: ${aplicados} operativo(s) con sus tramos asignados.`);
  return aplicados;
}
