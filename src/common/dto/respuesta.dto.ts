/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Contratos compartidos
 * Archivo: respuesta.dto.ts
 * Responsabilidad: Declarar la forma de las respuestas paginadas.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

/** Metadatos que acompañan a un listado paginado. */
export interface MetadatosPaginacion {
  pagina: number;
  tamanio: number;
  total: number;
  totalPaginas: number;
}

/** Respuesta de un listado paginado. */
export interface RespuestaPaginada<T> {
  datos: T[];
  meta: MetadatosPaginacion;
}

/** Compone la respuesta paginada a partir del resultado y sus parámetros. */
export function componerPaginada<T>(
  datos: T[],
  total: number,
  pagina = 1,
  tamanio = 25,
): RespuestaPaginada<T> {
  return {
    datos,
    meta: {
      pagina,
      tamanio,
      total,
      totalPaginas: tamanio > 0 ? Math.ceil(total / tamanio) : 0,
    },
  };
}
