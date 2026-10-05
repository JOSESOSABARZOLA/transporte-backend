/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: N/A
 * Archivo: auth-user.interface.ts
 * Responsabilidad: Ver la descripción del elemento exportado.
 * Desarrollador:
 * Fecha: 24/03/2026
 */

export interface AuthUser {
  id: string;
  email?: string;
  roles?: string[];
  permissions?: string[];
}
