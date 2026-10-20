/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · planificar el día (paso 2)
 * Archivo: sugerencia-libres.ts
 * Responsabilidad: Decir si conviene usar conductores de libre y quiénes, comparando dos simulaciones.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-08
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * «NO ALCANZAN LOS CONDUCTORES DE TURNO PARA N OPERATIVOS. HAY K DE LIBRE QUE PODRÍAN CUBRIRLOS.»
 *
 * Se simula el optimizador DOS veces sobre el mismo estado —sin libres y con libres— y se compara.
 * La sugerencia aplica SOLO si con libres se cubren MÁS operativos: un libre son horas extra
 * (regla de la DAF), y proponerlo para cubrir lo mismo sería gastar sin ganar nada. Los libres que
 * se nombran son los que la simulación con libres activaría, no todos los que tienen el día libre.
 *
 * ES PURA: recibe las dos propuestas ya calculadas.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface ResumenSimulacion {
  cubiertos: number;
  total: number;
  activaciones: { conductorId: number }[];
}

export interface SugerenciaLibres {
  aplica: boolean;
  /** Operativos que quedan sin conductor sin usar libres. */
  pendientesSinLibres: number;
  /** Cuántos operativos MÁS se cubrirían con libres. */
  operativosExtra: number;
  /** Los libres que haría falta activar. */
  libres: { conductorId: number; nombre: string }[];
}

export function sugerirLibres(
  sinLibres: ResumenSimulacion,
  conLibres: ResumenSimulacion,
  nombres: ReadonlyMap<number, string>,
): SugerenciaLibres {
  const pendientesSinLibres = Math.max(
    0,
    sinLibres.total - sinLibres.cubiertos,
  );
  const extra = conLibres.cubiertos - sinLibres.cubiertos;
  if (extra <= 0 || conLibres.activaciones.length === 0) {
    return {
      aplica: false,
      pendientesSinLibres,
      operativosExtra: 0,
      libres: [],
    };
  }
  const ids = [...new Set(conLibres.activaciones.map((a) => a.conductorId))];
  return {
    aplica: true,
    pendientesSinLibres,
    operativosExtra: extra,
    libres: ids.map((conductorId) => ({
      conductorId,
      nombre: nombres.get(conductorId) ?? '',
    })),
  };
}
