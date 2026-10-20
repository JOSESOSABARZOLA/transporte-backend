/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · versión consolidada
 * Archivo: vencimiento-documentos.ts
 * Responsabilidad: Avisar de la matrícula y el SOAT vencidos o por vencer de un vehículo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 *
 * Los vencimientos son columnas `@db.Date` (sin hora ni huso) y se comparan como días de
 * calendario contra el HOY DE QUITO (America/Guayaquil), nunca contra el día UTC: a las 20H00 de
 * Quito ya es mañana en UTC y un SOAT que vence hoy saldría «vencido». La anticipación del aviso es
 * el parámetro DAF_DIAS_AVISO_VENCIMIENTO (regla 2).
 *
 * `alertasDeVencimiento` es pura; `hoyEnGuayaquil` solo formatea el instante que recibe.
 */

export type DocumentoVehiculo = 'SOAT' | 'MATRICULA';

export interface AlertaVencimiento {
  documento: DocumentoVehiculo;
  /** AAAA-MM-DD. */
  vence: string;
  /** Días que faltan (negativo si ya venció; 0 = vence hoy). */
  dias: number;
  estado: 'VENCIDO' | 'POR_VENCER';
}

const ZONA = 'America/Guayaquil';
const MS_DIA = 86_400_000;

const formatoDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** El día de calendario de Quito para un instante, como AAAA-MM-DD. */
export function hoyEnGuayaquil(ahora: Date = new Date()): string {
  return formatoDia.format(ahora);
}

/** Días de calendario entre dos AAAA-MM-DD (b − a). */
function diasEntre(a: string, b: string): number {
  const utc = (t: string) => {
    const [anio, mes, dia] = t.split('-').map(Number);
    return Date.UTC(anio, mes - 1, dia);
  };
  return Math.round((utc(b) - utc(a)) / MS_DIA);
}

/** Una columna @db.Date (medianoche UTC) → AAAA-MM-DD sin desplazarla. */
function claveDia(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Las alertas de un vehículo: VENCIDO si la fecha ya pasó, POR_VENCER si vence hoy o dentro de
 * `diasAviso` días. Sin fecha registrada no hay alerta. Orden: SOAT, MATRICULA.
 */
export function alertasDeVencimiento(
  vehiculo: { soatVencimiento: Date | null; matriculaVencimiento: Date | null },
  hoy: string,
  diasAviso: number,
): AlertaVencimiento[] {
  const documentos: [DocumentoVehiculo, Date | null][] = [
    ['SOAT', vehiculo.soatVencimiento],
    ['MATRICULA', vehiculo.matriculaVencimiento],
  ];
  const alertas: AlertaVencimiento[] = [];
  for (const [documento, fecha] of documentos) {
    if (!fecha) continue;
    const vence = claveDia(fecha);
    const dias = diasEntre(hoy, vence);
    if (dias < 0) alertas.push({ documento, vence, dias, estado: 'VENCIDO' });
    else if (dias <= diasAviso)
      alertas.push({ documento, vence, dias, estado: 'POR_VENCER' });
  }
  return alertas;
}

/** El estado de los documentos de un vehículo, resumido en uno solo para la tabla de flota. */
export interface EstadoDocumentos {
  estado: 'VENCIDO' | 'POR_VENCER' | 'INCOMPLETO' | 'AL_DIA' | 'SIN_FECHAS';
  /**
   * El documento que decide el estado: el que vence (VENCIDO, POR_VENCER) o el que FALTA
   * (INCOMPLETO); `null` en AL_DIA y SIN_FECHAS.
   */
  documento: DocumentoVehiculo | null;
  /** AAAA-MM-DD de ese documento, o `null`. */
  vence: string | null;
  /** Días que le faltan (negativo si venció), o `null`. */
  dias: number | null;
}

/**
 * Flota y garajes (2026-10-14). El estado MÁS CRÍTICO de matrícula y SOAT: un documento vencido
 * gana a uno por vencer y, entre dos del mismo estado, el que vence antes. Sin ninguna fecha
 * registrada es SIN_FECHAS; con al menos una y ninguna alerta, AL_DIA. Es lo que cuenta el
 * indicador «Documentos por vencer» (VENCIDO o POR_VENCER) y lo que pinta la insignia de la fila.
 *
 * INCOMPLETO (2026-10-15): falta exactamente UNA de las dos fechas. Se evalúa primero la que sí
 * está: si está vencida o por vencer, gana esa alerta (VENCIDO > POR_VENCER > INCOMPLETO >
 * AL_DIA). Si no, INCOMPLETO con `documento` = el que falta, para que la fila diga «Falta SOAT» o
 * «Falta matrícula» en lugar de un «Al día» que no lo es.
 */
export function estadoDocumentos(
  matricula: Date | null,
  soat: Date | null,
  hoy: string,
  diasAviso: number,
): EstadoDocumentos {
  if (!matricula && !soat) {
    return { estado: 'SIN_FECHAS', documento: null, vence: null, dias: null };
  }
  const alertas = alertasDeVencimiento(
    { matriculaVencimiento: matricula, soatVencimiento: soat },
    hoy,
    diasAviso,
  );
  if (alertas.length === 0) {
    if (!matricula || !soat) {
      return {
        estado: 'INCOMPLETO',
        documento: matricula ? 'SOAT' : 'MATRICULA',
        vence: null,
        dias: null,
      };
    }
    return { estado: 'AL_DIA', documento: null, vence: null, dias: null };
  }
  const critica = alertas.reduce((peor, alerta) =>
    alerta.dias < peor.dias ? alerta : peor,
  );
  return {
    estado: critica.estado,
    documento: critica.documento,
    vence: critica.vence,
    dias: critica.dias,
  };
}
