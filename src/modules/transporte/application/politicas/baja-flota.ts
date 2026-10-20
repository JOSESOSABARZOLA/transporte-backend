/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Flota y garajes
 * Archivo: baja-flota.ts
 * Responsabilidad: Decidir qué impide dar de baja un vehículo, un conductor o un garaje, y redactar
 *   el motivo para el administrador.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-20
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SOLO BLOQUEA LO QUE TODAVÍA VA A PASAR (plan «flota-mantenimiento-baja», D2):
 *   · un traslado de un operativo activo (o una TAREA de taller, para el conductor) que aún no
 *     termina: de un día futuro, o de hoy con la hora de fin por delante (o que cruza la medianoche);
 *   · un mantenimiento abierto del vehículo (PROGRAMADO o EN_TALLER) que termina hoy o después;
 *   · un vehículo activo que duerme en el garaje hoy o un día futuro.
 *
 * YA NO BLOQUEAN: los traslados de hoy que ya terminaron y el reflejo `t_operativo.cond_id/vehi_id`
 * de un operativo sin tramos (la ocupación sale solo de los tramos desde el 2026-10-14). Un cuadro
 * CERRADO de hoy o de un día futuro SÍ bloquea: la Dirección lo congeló para ejecutarlo, y como ya
 * no admite cambios, la asignación no se podría liberar después.
 *
 * El aviso previo (`impacto-baja`) y la baja usan esta misma función: lo que se avisa es lo que
 * se rechaza.
 *
 * ES PURA: recibe las filas, «hoy» (AAAA-MM-DD de Quito) y «ahora» (HH:MM).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Un traslado (o una TAREA de taller) del recurso desde hoy. */
export interface TramoParaBaja {
  fecha: string;
  horaInicio: string;
  horaFin: string;
  cruzaMedianoche: boolean;
  /** El operativo, o la descripción de la TAREA. */
  identificador: string;
  esTarea: boolean;
}

/** Una parada de taller del vehículo que termina hoy o después. */
export interface ParadaParaBaja {
  desde: string;
  hasta: string;
  motivo: string | null;
  /** PROGRAMADO / EN_TALLER / LISTO. LISTO ya no bloquea. */
  estado: string | null;
}

/** Un vehículo que duerme en el garaje en esa fecha. */
export interface DestinoParaBaja {
  fecha: string;
  placa: string;
}

export type TipoBloqueoBaja = 'ASIGNACION' | 'MANTENIMIENTO' | 'GARAJE_EN_USO';

export interface BloqueoBaja {
  tipo: TipoBloqueoBaja;
  /** El texto para el administrador: qué lo impide y dónde se resuelve. */
  mensaje: string;
  /** Cuántos elementos lo impiden (traslados, paradas o vehículos). */
  cantidad: number;
}

/** Los traslados que aún no terminan, ordenados por fecha y hora. */
export function tramosPendientes(
  tramos: readonly TramoParaBaja[],
  hoy: string,
  ahora: string,
): TramoParaBaja[] {
  return tramos
    .filter(
      (t) =>
        t.fecha > hoy ||
        (t.fecha === hoy && (t.cruzaMedianoche || t.horaFin > ahora)),
    )
    .sort((a, b) =>
      `${a.fecha} ${a.horaInicio}`.localeCompare(`${b.fecha} ${b.horaInicio}`),
    );
}

/** Las paradas que siguen abiertas (no LISTO) y terminan hoy o después. */
export function paradasAbiertas(
  paradas: readonly ParadaParaBaja[],
  hoy: string,
): ParadaParaBaja[] {
  return paradas
    .filter((p) => p.estado !== 'LISTO' && p.hasta >= hoy)
    .sort((a, b) => a.desde.localeCompare(b.desde));
}

/**
 * Lo primero que impide la baja, o `null` si se puede. `sujeto` es la frase con que empieza el
 * mensaje («El vehículo de placa PMA-7056», «Jose Luis Sosa», «El garaje Calderón»).
 */
export function bloqueoDeBaja(
  sujeto: string,
  datos: {
    tramos?: readonly TramoParaBaja[];
    paradas?: readonly ParadaParaBaja[];
    destinos?: readonly DestinoParaBaja[];
  },
  hoy: string,
  ahora: string,
): BloqueoBaja | null {
  const pendientes = tramosPendientes(datos.tramos ?? [], hoy, ahora);
  if (pendientes.length > 0) {
    const primero = pendientes[0];
    const que = primero.esTarea
      ? `la tarea «${primero.identificador}»`
      : `el operativo ${primero.identificador}`;
    const mas =
      pendientes.length > 1
        ? ` y ${pendientes.length - 1} traslado${pendientes.length === 2 ? '' : 's'} más`
        : '';
    return {
      tipo: 'ASIGNACION',
      cantidad: pendientes.length,
      mensaje: `${sujeto} tiene transporte asignado el ${diaLegible(primero.fecha)} a las ${primero.horaInicio.replace(':', 'H')} (${que})${mas}. Libere esa asignación en «Planificar el día» antes de darlo de baja.`,
    };
  }

  const abiertas = paradasAbiertas(datos.paradas ?? [], hoy);
  if (abiertas.length > 0) {
    const primera = abiertas[0];
    const motivo = primera.motivo ? ` (${primera.motivo})` : '';
    return {
      tipo: 'MANTENIMIENTO',
      cantidad: abiertas.length,
      mensaje: `${sujeto} tiene un mantenimiento abierto del ${diaLegible(primera.desde)} al ${diaLegible(primera.hasta)}${motivo}. Retírelo o márquelo como listo en «Programar mantenimiento» antes de darlo de baja.`,
    };
  }

  const destinos = [...(datos.destinos ?? [])]
    .filter((d) => d.fecha >= hoy)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (destinos.length > 0) {
    const placas = [...new Set(destinos.map((d) => d.placa))];
    return {
      tipo: 'GARAJE_EN_USO',
      cantidad: placas.length,
      mensaje: `${sujeto} tiene vehículos que duermen ahí desde el ${diaLegible(destinos[0].fecha)}: ${placas.join(', ')}. Cambie su destino en «Planificar el día» antes de darlo de baja.`,
    };
  }

  return null;
}

/** «2026-10-23» → «23/10/2026». */
function diaLegible(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-');
  return `${dia}/${mes}/${anio}`;
}
