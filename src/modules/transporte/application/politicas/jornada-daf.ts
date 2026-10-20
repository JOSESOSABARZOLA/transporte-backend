/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · planificar el día (flujo guiado en 4 pasos)
 * Archivo: jornada-daf.ts
 * Responsabilidad: Armar la lista de requisitos del paso 1 y derivar en qué paso abre la jornada.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-08
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * «PLANIFICAR EL DÍA» ES UN FLUJO: Preparar → Asignar → Fin del día → Emitir. El paso en que abre
 * NO SE GUARDA: se DERIVA del estado de la jornada, para que al recargar o volver otro día la
 * analista caiga donde le toca. El frontend espeja `derivarPaso` tal cual.
 *
 * REQUISITOS (paso 1). Cinco filas, cada una con su estado y SU acción:
 *   · CUADRO      — hay cuadro con operativos (en cualquier estado, como «Antes de asignar»: lo que
 *                   la DAF necesita es que haya qué cubrir). Cuenta los que PIDEN transporte.
 *   · TURNOS      — hay turnos ESA fecha y el mes está PUBLICADO (solo así cuentan para asignar).
 *   · CONDUCTORES — ninguno sin sector, contrato o acta de parqueadero vigente (si la tiene marcada).
 *   · VEHICULOS   — la DAF confirmó qué vehículos salen hoy (`t_vehiculo_jornada`).
 *   · VENTANA     — abierta, o en ESPERA. NO cuenta para «listo»: con la ventana cerrada se puede
 *                   revisar todo en modo lectura.
 *
 * DERIVACIÓN DEL PASO (`derivarPaso`). Se mira el AVANCE de la jornada y manda lo más avanzado
 * (ajuste del 2026-10-08: antes los requisitos se miraban primero, y una jornada ya asignada sin
 * «vehículos confirmados» abría siempre en el paso 1):
 *   4 si están emitidas todas las hojas de ruta, o si todos los vehículos en uso tienen su guarda;
 *   3 si hay asignaciones hechas: todo cubierto, o alguna guarda ya declarada;
 *   2 si los requisitos están listos, o si ya hay algo cubierto (la analista sigue asignando);
 *   1 en otro caso.
 * El requisito pendiente no se esconde: el paso 1 sigue sin ✓ y se puede volver a él. Por eso a
 * un paso se llega si es ≤ `pasoInicial` o si todos los anteriores están completos.
 *
 * ES PURA: sin base de datos ni reloj.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type { FaltanteConductor } from './preparacion-dia';

export type ClaveRequisito =
  | 'CUADRO'
  | 'TURNOS'
  | 'CONDUCTORES'
  | 'VEHICULOS'
  | 'VENTANA';

export type EstadoRequisito = 'OK' | 'PENDIENTE' | 'ESPERA';

export type AccionRequisito =
  | { tipo: 'VER_MATRIZ' }
  | { tipo: 'IR_TURNOS' }
  | { tipo: 'COMPLETAR_CONDUCTOR'; conductorId: number }
  | { tipo: 'CONFIRMAR_VEHICULOS' }
  | { tipo: 'CORREGIR_VEHICULOS' };

export interface Requisito {
  clave: ClaveRequisito;
  estado: EstadoRequisito;
  titulo: string;
  detalle: string;
  accion: AccionRequisito | null;
}

export interface EntradaRequisitos {
  cuadro: {
    existe: boolean;
    estado: string | null;
    /** Operativos activos que PIDEN transporte (no propios medios). */
    operativosConTransporte: number;
    /** Formularios distintos de esos operativos. */
    formulariosConTransporte: number;
  };
  turnos: {
    cargados: boolean;
    publicados: boolean;
    dia: number;
    noche: number;
    libre: number;
  };
  conductoresIncompletos: {
    id: number;
    nombre: string;
    faltan: FaltanteConductor[];
  }[];
  vehiculos: {
    flota: number;
    /** Placas de los vehículos en taller ese día. */
    enTaller: string[];
    /** Cuántos salen hoy según la confirmación, o `null` si no se ha confirmado. */
    confirmados: number | null;
  };
  ventana: {
    abierta: boolean;
    horaApertura: string | null;
    horaCierre: string | null;
  };
}

export interface ResultadoRequisitos {
  requisitos: Requisito[];
  /** Todos los requisitos listos (la ventana no cuenta). */
  listos: boolean;
  /** Cuántos faltan (la ventana no cuenta). */
  pendientes: number;
}

/** «08:00» → «08H00». */
export function horaInstitucional(hora: string | null): string {
  return (hora ?? '').replace(':', 'H');
}

const plural = (n: number, uno: string, varios: string): string =>
  `${n} ${n === 1 ? uno : varios}`;

const NOMBRE_FALTANTE: Record<FaltanteConductor, string> = {
  sector: 'el sector',
  contrato: 'el contrato',
  parqueadero: 'el acta de parqueadero vigente',
};

/** «el sector y el contrato», «el sector, el contrato y el acta…». */
function enumerar(partes: string[]): string {
  if (partes.length <= 1) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

export function armarRequisitos(
  entrada: EntradaRequisitos,
): ResultadoRequisitos {
  const { cuadro, turnos, conductoresIncompletos, vehiculos, ventana } =
    entrada;
  const requisitos: Requisito[] = [];

  // a) Cuadro del día.
  const aprobado = cuadro.estado === 'APROBADO' || cuadro.estado === 'CERRADO';
  const cuadroListo = cuadro.existe && cuadro.operativosConTransporte > 0;
  requisitos.push({
    clave: 'CUADRO',
    estado: cuadroListo ? 'OK' : 'PENDIENTE',
    titulo: !cuadro.existe
      ? 'No hay cuadro para esta fecha'
      : aprobado
        ? 'Cuadro del día aprobado'
        : 'Cuadro del día en preparación',
    detalle: cuadroListo
      ? `${plural(cuadro.operativosConTransporte, 'operativo', 'operativos')} de ${plural(cuadro.formulariosConTransporte, 'formulario', 'formularios')} ${cuadro.operativosConTransporte === 1 ? 'necesita' : 'necesitan'} transporte.`
      : cuadro.existe
        ? 'Ningún operativo de la jornada pide transporte todavía.'
        : 'Los departamentos aún no registran operativos para esta fecha.',
    accion: aprobado ? null : { tipo: 'VER_MATRIZ' },
  });

  // b) Turnos del mes.
  const turnosListos = turnos.cargados && turnos.publicados;
  requisitos.push({
    clave: 'TURNOS',
    estado: turnosListos ? 'OK' : 'PENDIENTE',
    titulo: turnosListos
      ? 'Turnos del mes cargados'
      : turnos.cargados
        ? 'Turnos del mes sin publicar'
        : 'Faltan los turnos del mes',
    detalle: turnosListos
      ? `${plural(turnos.dia, 'conductor de día', 'conductores de día')}, ${turnos.noche} de noche y ${turnos.libre} de libre.`
      : turnos.cargados
        ? 'Publique el mes: en borrador los turnos no cuentan para asignar.'
        : 'No hay turnos de conductores registrados para esta fecha.',
    accion: turnosListos ? null : { tipo: 'IR_TURNOS' },
  });

  // c) Datos de los conductores.
  const primero = conductoresIncompletos[0];
  requisitos.push({
    clave: 'CONDUCTORES',
    estado: primero ? 'PENDIENTE' : 'OK',
    titulo: primero
      ? 'Datos de conductores incompletos'
      : 'Datos de conductores completos',
    detalle: primero
      ? `Falta ${enumerar(primero.faltan.map((f) => NOMBRE_FALTANTE[f]))} de ${primero.nombre}${conductoresIncompletos.length > 1 ? ` (y ${plural(conductoresIncompletos.length - 1, 'conductor más', 'conductores más')})` : ''}.`
      : 'Todos tienen sector, contrato y parqueadero.',
    accion: primero
      ? { tipo: 'COMPLETAR_CONDUCTOR', conductorId: primero.id }
      : null,
  });

  // d) Vehículos que salen hoy.
  const disponibles = Math.max(0, vehiculos.flota - vehiculos.enTaller.length);
  const taller =
    vehiculos.enTaller.length === 0
      ? 'ninguno en taller'
      : `${vehiculos.enTaller.length} en taller (${vehiculos.enTaller.join(', ')})`;
  requisitos.push(
    vehiculos.confirmados !== null
      ? {
          clave: 'VEHICULOS',
          estado: 'OK',
          titulo: `Vehículos confirmados: ${plural(vehiculos.confirmados, 'sale hoy', 'salen hoy')}`,
          detalle:
            vehiculos.enTaller.length === 0
              ? 'Ninguno queda en taller.'
              : `${vehiculos.enTaller.join(', ')} ${vehiculos.enTaller.length === 1 ? 'queda' : 'quedan'} en taller.`,
          accion: { tipo: 'CORREGIR_VEHICULOS' },
        }
      : {
          clave: 'VEHICULOS',
          estado: 'PENDIENTE',
          titulo:
            disponibles === 1
              ? '¿Sale hoy este vehículo?'
              : `¿Salen hoy estos ${disponibles} vehículos?`,
          detalle: `Flota ${vehiculos.flota} · ${taller}.`,
          accion: { tipo: 'CONFIRMAR_VEHICULOS' },
        },
  );

  // e) Ventana de la DAF (no cuenta para «listo»).
  requisitos.push(
    ventana.abierta
      ? {
          clave: 'VENTANA',
          estado: 'OK',
          titulo: 'Ventana de asignación abierta',
          detalle: ventana.horaCierre
            ? `Abierta hasta las ${horaInstitucional(ventana.horaCierre)}.`
            : 'Abierta.',
          accion: null,
        }
      : {
          clave: 'VENTANA',
          estado: 'ESPERA',
          titulo: ventana.horaApertura
            ? `La asignación abre a las ${horaInstitucional(ventana.horaApertura)}`
            : 'La ventana de asignación está cerrada',
          detalle: 'Mientras tanto puede revisar todo en modo lectura.',
          accion: null,
        },
  );

  const bloqueantes = requisitos.filter(
    (r) => r.clave !== 'VENTANA' && r.estado !== 'OK',
  );
  return {
    requisitos,
    listos: bloqueantes.length === 0,
    pendientes: bloqueantes.length,
  };
}

export type Paso = 1 | 2 | 3 | 4;

export interface EntradaPaso {
  requisitosListos: boolean;
  /** Operativos que piden transporte. */
  operativos: number;
  /** De ellos, con todos sus tramos con conductor. */
  cubiertos: number;
  /** Vehículos con algún tramo asignado hoy. */
  vehiculosEnUso: number;
  /** De ellos, con la guarda final declarada. */
  vehiculosConGuarda: number;
  /** ¿Están emitidas todas las hojas de ruta? */
  hojasEmitidas: boolean;
}

export interface EstadoPasos {
  /** El paso en que abre la jornada. */
  pasoInicial: Paso;
  /** Qué pasos están completos (para pintar ✓ en el stepper). */
  completos: Record<Paso, boolean>;
}

/** En qué paso abre la jornada y qué pasos están completos. Ver la cabecera. */
export function derivarPaso(entrada: EntradaPaso): EstadoPasos {
  const guardaCompleta =
    entrada.vehiculosEnUso > 0 &&
    entrada.vehiculosConGuarda >= entrada.vehiculosEnUso;
  const completos: Record<Paso, boolean> = {
    1: entrada.requisitosListos,
    2: entrada.cubiertos > 0,
    3: guardaCompleta,
    4: entrada.hojasEmitidas,
  };
  const asignacionesHechas =
    entrada.cubiertos > 0 &&
    (entrada.cubiertos >= entrada.operativos || entrada.vehiculosConGuarda > 0);

  let pasoInicial: Paso;
  if (entrada.hojasEmitidas || guardaCompleta) pasoInicial = 4;
  else if (asignacionesHechas) pasoInicial = 3;
  else if (entrada.requisitosListos || entrada.cubiertos > 0) pasoInicial = 2;
  else pasoInicial = 1;

  return { pasoInicial, completos };
}
