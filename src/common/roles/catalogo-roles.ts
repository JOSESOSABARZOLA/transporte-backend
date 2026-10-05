/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Catálogo de roles
 * Archivo: catalogo-roles.ts
 * Responsabilidad: Nombrar los roles del módulo y decir cuáles se pueden asignar.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-01
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * HABÍA TRES COPIAS DEL MISMO MAPA, Y NINGUNA ERA LA FUENTE.
 *
 * `documentos/application/reglas-matriz.ts` nombraba los roles para la fila de evidencia
 * del PDF; `operativos/application/solicitud-apoyo.service.ts` los nombraba para sus
 * mensajes de rechazo; y el frontend tenía la suya en `utils/parametro.util.ts`, de la que
 * salía además la lista del desplegable de P-11.
 *
 * Tres listas del mismo hecho **se separan**, y ya se separaron una vez: al ampliar el
 * enumerado el 2026-09-01 el compilador obligó a completar la de `solicitud-apoyo`
 * —está tipada `Record<RolDepartamental, string>`— pero **no** la de `reglas-matriz`, que
 * es `Record<string, string>` con `?? rol` de respaldo. Sin completarla a mano, la matriz
 * habría impreso `ADMINISTRADOR_DMIP` en crudo dentro de un documento oficial y nada
 * habría fallado.
 *
 * ESTA ES LA FUENTE. Está tipada `Record<RolDepartamental, string>` **a propósito**: el
 * día que el enumerado crezca, el compilador señala este archivo y solo este.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { RolDepartamental } from '@prisma/client';

/** Nombre del rol en las palabras del organigrama. */
export const NOMBRE_ROL: Record<RolDepartamental, string> = {
  DMIP_OPERATIVOS: 'DMIP · Unidad de Operativos',
  DMIP_INSPECCIONES: 'DMIP · Inspecciones Técnicas y Generales',
  DMIT_INSTRUCTOR: 'DMIT · Instrucción',
  DAF: 'DAF · Transportes',
  DIRECTOR: 'Dirección',
  FUNCIONARIO: 'Funcionario (rol retirado)',
  ADMINISTRADOR_DMIP: 'Administración · DMIP',
  ADMINISTRADOR_DMIT: 'Administración · DMIT',
  ADMINISTRADOR_DAF: 'Administración · DAF',
  ADMINISTRADOR: 'Administración del sistema',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SE PUEDE NOMBRAR TODO; NO SE PUEDE ASIGNAR TODO.
 *
 * `FUNCIONARIO` se retiró el 2026-09-10: el personal de campo ya no inicia sesión —sus
 * órdenes se generan para él desde la Dirección (P-05) y se entregan por otro canal—, así
 * que ofrecerlo en «Cuentas del cuadro» dejaría crear cuentas que entran y **no pueden
 * hacer nada** (además nunca tuvo rol en Auth: la incidencia F-01). El valor sobrevive en
 * el enumerado solo porque PostgreSQL no admite retirar un valor sin recrear el tipo.
 *
 * Se sigue **nombrando** porque hay filas de auditoría e histórico que lo llevan, y un rol
 * que no se sepa nombrar sale en crudo en pantalla. Es el mismo trato que ya recibía el
 * retirado `ADMINISTRADOR`, que desde el 2026-09-10 **vuelve a estar activo** como
 * administrador general del sistema y por eso ya no está aquí.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const NO_ASIGNABLES: RolDepartamental[] = [RolDepartamental.FUNCIONARIO];

/** Un rol del módulo, tal como lo consume una pantalla. */
export interface RolDelCatalogo {
  codigo: RolDepartamental;
  nombre: string;
  /** Si se puede otorgar a una cuenta nueva. Todos se pueden **nombrar**. */
  asignable: boolean;
}

/**
 * El catálogo entero, en el orden del organigrama.
 *
 * SE DERIVA DE `NOMBRE_ROL` Y NO SE ESCRIBE APARTE: es la misma pregunta —«qué roles
 * hay»— y dos listas separadas volverían al problema que este archivo viene a cerrar.
 * El orden de las claves del mapa es el orden en que se ofrecen.
 */
export function catalogoDeRoles(): RolDelCatalogo[] {
  return (Object.keys(NOMBRE_ROL) as RolDepartamental[]).map((codigo) => ({
    codigo,
    nombre: NOMBRE_ROL[codigo],
    asignable: !NO_ASIGNABLES.includes(codigo),
  }));
}
