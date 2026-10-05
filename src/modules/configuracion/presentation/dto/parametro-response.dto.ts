/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Parámetros de política
 * Archivo: parametro-response.dto.ts
 * Responsabilidad: Componer la respuesta de un parámetro para la pantalla P-09.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * La pantalla muestra el rango admisible junto al valor, para que el administrador
 * sepa qué puede poner antes de intentarlo. Ver docs/FASE5-diseno-interfaz.md.
 */

import type { ParametroPolitica, TipoParametro } from '@prisma/client';

export interface ParametroResponseDto {
  clave: string;
  valor: string;
  tipo: TipoParametro;
  descripcion: string;
  unidad: string | null;
  minimo: string | null;
  maximo: string | null;
  modificadoPor: number | null;
  modificadoEn: string;
}

export function aParametroResponse(
  parametro: ParametroPolitica,
): ParametroResponseDto {
  return {
    clave: parametro.clave,
    valor: parametro.valor,
    tipo: parametro.tipo,
    descripcion: parametro.descripcion,
    unidad: parametro.unidad,
    minimo: parametro.minimo,
    maximo: parametro.maximo,
    modificadoPor: parametro.modificadoPor,
    modificadoEn: parametro.modificadoEn.toISOString(),
  };
}
