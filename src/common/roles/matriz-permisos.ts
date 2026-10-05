/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso (RBAC)
 * Archivo: matriz-permisos.ts
 * Responsabilidad: Documentar la semilla de la matriz rol<->permiso (fuente de verdad).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-16
 *
 * ESPEJO DE LA SEMILLA SQL de `20260916180000_rbac_permisos`. La autoridad en runtime es la
 * tabla `t_rol_permiso` (la lee `PermisosService`); esta constante existe para las pruebas y
 * para leer de un vistazo qué otorga cada permiso. Ambas deben coincidir: la prueba de
 * integración `rbac.integracion-spec` verifica que la base y esta constante digan lo mismo.
 */

import { RolDepartamental as R } from '@prisma/client';

/** Permiso atómico -> roles que lo tienen en la semilla (paridad con los `@Roles` de origen). */
export const SEMILLA_ROL_PERMISO: Record<string, R[]> = {
  'operativos:leer': [
    R.DMIP_OPERATIVOS,
    R.DMIP_INSPECCIONES,
    R.DMIT_INSTRUCTOR,
    R.DAF,
    R.DIRECTOR,
  ],
  'operativos:registrar': [
    R.DMIP_OPERATIVOS,
    R.DMIP_INSPECCIONES,
    R.DMIT_INSTRUCTOR,
  ],
  'operativos:editar': [
    R.DMIP_OPERATIVOS,
    R.DMIP_INSPECCIONES,
    R.DMIT_INSTRUCTOR,
  ],
  'operativos:retirar': [
    R.DMIP_OPERATIVOS,
    R.DMIP_INSPECCIONES,
    R.DMIT_INSTRUCTOR,
  ],
  'operativos:personal:gestionar': [
    R.DMIP_OPERATIVOS,
    R.DMIP_INSPECCIONES,
    R.DMIT_INSTRUCTOR,
  ],
  'operativos:adicional:crear': [
    R.DMIP_OPERATIVOS,
    R.DMIP_INSPECCIONES,
    R.DMIT_INSTRUCTOR,
    R.DIRECTOR,
  ],
  'operativos:apoyo:solicitar': [
    R.DMIP_OPERATIVOS,
    R.DMIP_INSPECCIONES,
    R.DMIT_INSTRUCTOR,
  ],
  'operativos:apoyo:ver': [
    R.DMIP_OPERATIVOS,
    R.DMIP_INSPECCIONES,
    R.DMIT_INSTRUCTOR,
    R.DAF,
    R.DIRECTOR,
    R.ADMINISTRADOR_DMIP,
  ],
  'operativos:apoyo:bandeja': [
    R.DMIP_OPERATIVOS,
    R.DMIP_INSPECCIONES,
    R.DMIT_INSTRUCTOR,
    R.DIRECTOR,
    R.ADMINISTRADOR_DMIP,
  ],
  'cuadro:abrir': [R.ADMINISTRADOR_DMIP, R.ADMINISTRADOR],
  'cuadro:cerrar-reabrir': [R.DIRECTOR],
  'transporte:pendientes:ver': [R.DAF, R.DIRECTOR],
  'transporte:vehiculos:ver': [R.DAF, R.DIRECTOR, R.ADMINISTRADOR_DAF],
  'transporte:conductores:ver': [R.DAF, R.DIRECTOR],
  'transporte:destinos:ver': [R.DAF, R.DIRECTOR],
  'transporte:jornada:ver': [R.DAF],
  'transporte:asignar': [R.DAF],
  'transporte:destino:fijar': [R.DAF],
  'transporte:propios-medios': [R.DAF],
  'transporte:desasignar': [R.DAF],
  'flota:administrar': [R.ADMINISTRADOR_DAF, R.DAF, R.ADMINISTRADOR],
  'flota:mantenimiento': [R.ADMINISTRADOR_DAF, R.DAF, R.ADMINISTRADOR],
  'flota:capacidad:ver': [R.DAF, R.DIRECTOR],
  'flota:capacidad:declarar': [R.DAF, R.ADMINISTRADOR_DMIP, R.ADMINISTRADOR],
  'matriz:ver': [R.DIRECTOR],
  'ordenes:gestionar': [R.DIRECTOR],
  'jornada:ver': [R.DMIP_OPERATIVOS, R.DMIP_INSPECCIONES, R.DMIT_INSTRUCTOR],
  'personal:administrar': [
    R.ADMINISTRADOR_DMIP,
    R.ADMINISTRADOR_DMIT,
    R.ADMINISTRADOR,
  ],
  'personal:directorio:ver': [
    R.ADMINISTRADOR_DMIP,
    R.ADMINISTRADOR_DMIT,
    R.ADMINISTRADOR,
  ],
  'catalogos:administrar': [R.ADMINISTRADOR_DMIP, R.ADMINISTRADOR],
  'usuarios:administrar': [R.ADMINISTRADOR_DMIP, R.ADMINISTRADOR],
  'ventanas:administrar': [R.ADMINISTRADOR_DMIP, R.ADMINISTRADOR],
  'roles-auth:administrar': [R.ADMINISTRADOR_DMIP, R.ADMINISTRADOR],
  'roles:ver': [R.ADMINISTRADOR_DMIP, R.ADMINISTRADOR],
  'parametros:administrar': [
    R.ADMINISTRADOR_DMIP,
    R.ADMINISTRADOR,
    R.ADMINISTRADOR_DMIT,
  ],
  'permisos:administrar': [R.ADMINISTRADOR],
};
