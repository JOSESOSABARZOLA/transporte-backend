/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · traslados entre zonales
 * Archivo: traslados.ts
 * Responsabilidad: Decir cuántos minutos tarda un conductor en ir de un lugar a otro.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * IMPORTA EL TRASLADO, NO SOLO EL HORARIO. Un conductor que termina a las 18H00 en Eloy Alfaro no
 * puede empezar a las 18H00 en la Matriz, y desde el Chocó Andino son ~1h30 (reunión DAF).
 *
 * Orden de prioridad (regla 2: los tres valores por defecto son parámetros):
 *   1. la matriz `t_traslado_zonal` (origen → destino), si tiene ese par;
 *   2. misma zonal → TRASLADO_MISMA_ZONA_MIN;
 *   3. mismo sector de la ciudad → TRASLADO_MISMO_SECTOR_MIN;
 *   4. en otro caso → TRASLADO_OTRO_SECTOR_MIN.
 *
 * Si no se sabe dónde está uno de los dos lugares, no hay distancia que medir: 0 minutos. Si se sabe
 * la zonal pero no el sector, se toma el caso CONSERVADOR (otro sector), porque subestimar un
 * traslado deja a un funcionario esperando.
 *
 * ES PURA.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Un lugar en la ciudad: una zonal (si se sabe) y su sector (si se sabe). */
export interface Lugar {
  zonalId: number | null;
  sector: string | null;
  /**
   * Lugar CONOCIDO pero sin sector (2026-10-06): un garaje autorizado sin zonal —«Matriz»— o un
   * punto que vale para todo el distrito. No es «no sé dónde está» (eso da 0 para no inventar un
   * "no llega"), sino «está, pero no en un sector»: se le aplica la regla de OTRO sector.
   */
  sinSector?: boolean;
}

export interface ParametrosTraslado {
  mismaZona: number;
  mismoSector: number;
  otroSector: number;
}

/** La matriz de traslados explícitos, por clave `origen-destino`. */
export type TablaTraslados = ReadonlyMap<string, number>;

/** La clave de un par de la matriz. */
export function claveTraslado(origenId: number, destinoId: number): string {
  return `${origenId}-${destinoId}`;
}

/** Minutos de traslado entre dos lugares. Ver la prioridad en la cabecera. */
export function minutosTraslado(
  origen: Lugar | null,
  destino: Lugar | null,
  tabla: TablaTraslados,
  parametros: ParametrosTraslado,
): number {
  if (!origen || !destino) return 0;
  // Sin zonal ni sector y SIN marca de «conocido»: no se sabe dónde está → no se inventa un traslado.
  const desconocido = (lugar: Lugar): boolean =>
    lugar.zonalId === null && lugar.sector === null && lugar.sinSector !== true;
  if (desconocido(origen) || desconocido(destino)) return 0;

  if (origen.zonalId !== null && destino.zonalId !== null) {
    const explicito = tabla.get(claveTraslado(origen.zonalId, destino.zonalId));
    if (explicito !== undefined) return explicito;
    if (origen.zonalId === destino.zonalId) return parametros.mismaZona;
  }

  if (origen.sector !== null && origen.sector === destino.sector) {
    return parametros.mismoSector;
  }

  return parametros.otroSector;
}

/**
 * Cuántos pares dirigidos (origen ≠ destino) de las zonales dadas NO tienen tiempo en la matriz
 * (G7, 2026-10-15): esos usan la regla general. Es un dato pendiente de la DAF, no un error. Los pares
 * que miran a zonales fuera de la lista (inactivas, o el DMQ que se excluye) no cuentan.
 */
export function paresSinTiempo(
  zonalIds: readonly number[],
  pares: readonly { zonalOrigenId: number; zonalDestinoId: number }[],
): { posibles: number; sinTiempo: number } {
  const ids = new Set(zonalIds);
  const posibles = ids.size > 1 ? ids.size * (ids.size - 1) : 0;
  const conTiempo = new Set(
    pares
      .filter(
        (p) =>
          p.zonalOrigenId !== p.zonalDestinoId &&
          ids.has(p.zonalOrigenId) &&
          ids.has(p.zonalDestinoId),
      )
      .map((p) => claveTraslado(p.zonalOrigenId, p.zonalDestinoId)),
  );
  return { posibles, sinTiempo: posibles - conTiempo.size };
}
