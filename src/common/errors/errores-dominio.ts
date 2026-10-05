/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Manejo de errores
 * Archivo: errores-dominio.ts
 * Responsabilidad: Declarar la jerarquía de errores del módulo sobre ApplicationError.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * Jerarquía de docs/FASE4-arquitectura-tecnica.md §13.1.
 *
 * CRITERIO DE REDACCIÓN. El campo `message` se muestra TAL CUAL al funcionario: debe
 * nombrar a la persona o el recurso implicado y explicar el motivo en términos
 * operativos. Prohibido «error de validación» o «dato inválido».
 * Ver docs/FASE2-documentacion-funcional.md §19.5.
 */

import { ApplicationError } from './application.error';
import {
  CODIGO_NO_ENCONTRADO,
  CODIGO_VALIDACION,
  CODIGOS_ERROR,
  type CodigoError,
} from './codigos-error';

/** 400 · Datos con forma incorrecta. */
export class ValidacionError extends ApplicationError {
  constructor(mensaje: string, detalles?: unknown, codigo = CODIGO_VALIDACION) {
    super(mensaje, 400, codigo, detalles);
    this.name = 'ValidacionError';
  }
}

/** 403 · El rol no tiene permiso sobre el recurso. */
export class AutorizacionError extends ApplicationError {
  constructor(codigo: CodigoError, mensaje: string, detalles?: unknown) {
    super(mensaje, 403, codigo, detalles);
    this.name = 'AutorizacionError';
  }
}

/** 404 · El identificador no corresponde a ningún recurso. */
export class RecursoNoEncontradoError extends ApplicationError {
  constructor(mensaje: string, detalles?: unknown) {
    super(mensaje, 404, CODIGO_NO_ENCONTRADO, detalles);
    this.name = 'RecursoNoEncontradoError';
  }
}

/**
 * 409 · Regla de negocio incumplida: descanso, duplicidad o condicionante.
 *
 * Es el error de las reglas que protegen a las personas. Su mensaje llega íntegro
 * al funcionario, así que debe nombrar a quien corresponda:
 *
 *   «BENAVIDES FERNANDO salió en patrulla ayer. No puede tener patrulla dos días
 *    seguidos, ni diurna ni nocturna.»
 */
export class ReglaNegocioError extends ApplicationError {
  constructor(codigo: CodigoError, mensaje: string, detalles?: unknown) {
    super(mensaje, 409, codigo, detalles);
    this.name = 'ReglaNegocioError';
  }
}

/** 409 · La versión del registro está desactualizada. Bloqueo optimista. */
export class ConflictoConcurrenciaError extends ApplicationError {
  constructor(mensaje: string, detalles?: unknown) {
    super(mensaje, 409, CODIGOS_ERROR.CONFLICTO_CONCURRENCIA, detalles);
    this.name = 'ConflictoConcurrenciaError';
  }
}

/**
 * 423 · Escritura fuera de la ventana del rol.
 *
 * El estado 423 se eligió a propósito y no un 403: el rol sí tiene permiso, lo que
 * no tiene es el momento. El mensaje debe indicar cuándo vuelve a abrirse.
 */
export class VentanaCerradaError extends ApplicationError {
  constructor(mensaje: string, detalles?: unknown) {
    super(mensaje, 423, CODIGOS_ERROR.VENTANA_CARGA_CERRADA, detalles);
    this.name = 'VentanaCerradaError';
  }
}
