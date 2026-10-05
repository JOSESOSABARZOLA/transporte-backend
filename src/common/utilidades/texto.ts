/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Utilidades transversales
 * Archivo: texto.ts
 * Responsabilidad: Normalizar denominaciones para compararlas entre sí.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * POR QUÉ EXISTE. `uq_tipo_control_nombre` y `uq_institucion_sigla` distinguen
 * mayúsculas y acentos, de modo que «Control de ruido» y «CONTROL DE RUIDO» conviven
 * como dos filas distintas del mismo catálogo. La semilla de M-03 detecta e informa
 * esos casos en los datos de origen; esta utilidad los impide al crearse nuevos.
 *
 * `prisma/seed.ts` conserva una copia privada de `sinAcentos` porque se ejecuta fuera
 * del contenedor de Nest. Consolidar ambas queda registrado como refactor pendiente en
 * M07_FORMULARIOS_CATALOGOS.md §9.
 */

/** Retira las marcas diacríticas sin escribirlas literalmente en el patrón. */
export function sinAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/**
 * Forma canónica de una denominación de catálogo: sin acentos, en mayúsculas y con
 * los espacios colapsados. Dos valores con la misma forma canónica son, para el
 * negocio, el mismo valor escrito de dos maneras.
 */
export function normalizarParaComparar(texto: string): string {
  return sinAcentos(texto).toUpperCase().replace(/\s+/g, ' ').trim();
}
