/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Cuadro diario
 * Archivo: cuadro.dto.ts
 * Responsabilidad: Declarar el contrato de apertura y la respuesta del cuadro.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL NÚMERO DE SEMANA NO ESTÁ EN EL CONTRATO DE ENTRADA, y es el caso 3 del plan.
 *
 * RN-06 dice que se calcula y es de solo lectura. Con `whitelist` y
 * `forbidNonWhitelisted` activos, un cliente que lo envíe recibe `400
 * CAMPOS_NO_PERMITIDOS` con el campo nombrado: no se descarta en silencio, se le dice
 * que ese dato no lo pone él. Es el campo que el Product Owner describió equivocándose
 * al escribirlo a mano.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * LA ORDEN DE TRABAJO SÍ SE PIDE. El plan la daba por derivada, pero **ninguna fuente
 * define su formato**: `FASE4` §6 solo dice «código institucional, único». Generarlo
 * por nuestra cuenta pondría un código inventado en la matriz consolidada y en cada
 * orden de servicio impresa. Se pide al administrador hasta que el negocio lo defina.
 * Ver PV-28 en PENDIENTES-VALIDACION.md.
 */

import { EstadoCuadro, type CuadroDiario } from '@prisma/client';
import { IsNotEmpty, Matches } from 'class-validator';

/**
 * UNA SOLA PROPIEDAD: LA FECHA.
 *
 * `ordenTrabajo` **se generó como dato de entrada hasta el 2026-08-07**, cuando el
 * Product Owner resolvió PV-28: el sistema lo compone con el formato `AMC-AAAA-MM-DD` y
 * su único uso es identificar el día en la matriz consolidada.
 *
 * Se retiró del contrato en lugar de dejarlo opcional. Con `forbidNonWhitelisted`, quien
 * lo envíe recibe `400 CAMPOS_NO_PERMITIDOS` y sabrá que el sistema lo genera; dejarlo
 * opcional habría permitido que conviviesen dos códigos distintos para el mismo día.
 */
export class CrearCuadroDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha del cuadro se escribe como AAAA-MM-DD.',
  })
  @IsNotEmpty({ message: 'Indique la fecha de la jornada.' })
  fecha: string;
}

export interface CuadroResponseDto {
  fecha: string;
  ordenTrabajo: string;
  nroSemana: number;
  anioSemana: number;
  estado: EstadoCuadro;
  /** Si admite modificaciones. Lo consulta la cabecera de todas las pantallas. */
  admiteEscritura: boolean;
  cerradoPor: number | null;
  cerradoEn: string | null;
  reaperturas: number;
}

export function aCuadroResponse(cuadro: CuadroDiario): CuadroResponseDto {
  return {
    fecha: cuadro.fecha.toISOString().slice(0, 10),
    ordenTrabajo: cuadro.ordenTrabajo,
    nroSemana: cuadro.nroSemana,
    anioSemana: cuadro.anioSemana,
    estado: cuadro.estado,
    admiteEscritura: cuadro.estado !== EstadoCuadro.CERRADO,
    cerradoPor: cuadro.cerradoPor,
    cerradoEn: cuadro.cerradoEn ? cuadro.cerradoEn.toISOString() : null,
    reaperturas: cuadro.reaperturas,
  };
}
