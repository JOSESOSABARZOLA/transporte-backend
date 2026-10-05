/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: formulario-desde.decorator.ts
 * Responsabilidad: Indicar a FormularioRolGuard dónde encontrar el código del
 *                  formulario dentro de la petición.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * El decorador solo dice DÓNDE viene el código del formulario. Quién es su dueño lo
 * decide siempre la tabla `t_formulario`, nunca la petición.
 */

import { SetMetadata } from '@nestjs/common';

export const FORMULARIO_DESDE_KEY = 'formularioDesde';

export type OrigenFormulario = 'body' | 'params' | 'query';

export interface UbicacionFormulario {
  origen: OrigenFormulario;
  /** Nombre de la propiedad que contiene el código. */
  propiedad: string;
}

/**
 * @example @FormularioDesde('body', 'formularioCodigo')
 * @example @FormularioDesde('params', 'codigo')
 */
export const FormularioDesde = (
  origen: OrigenFormulario,
  propiedad: string,
): MethodDecorator & ClassDecorator =>
  SetMetadata(FORMULARIO_DESDE_KEY, { origen, propiedad });
