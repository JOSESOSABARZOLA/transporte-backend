/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: N/A
 * Archivo: application.error.ts
 * Responsabilidad: Ver la descripción del elemento exportado.
 * Desarrollador: Doris Villavicencio
 * Fecha: 24/03/2026
 */

export class ApplicationError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode = 500,
    public readonly code = 'APPLICATION_ERROR',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
