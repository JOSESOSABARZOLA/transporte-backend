/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos · Trámites de Inspección
 * Archivo: tramites-inspeccion.dto.ts
 * Responsabilidad: Validar la consulta de trámites y dar forma a su respuesta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 *
 * `funcionarioId` admite uno o varios: `?funcionarioId=4&funcionarioId=9`. Con uno solo, la cadena
 * de consulta lo entrega como texto y no como lista; `aListaDeIds` lo normaliza antes de validar.
 */

import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsInt,
  IsPositive,
  Matches,
} from 'class-validator';

import type { ConsultaTramites } from '../../application/tramites-inspeccion.service';

/** `'4'`, `['4','9']` o `'4,9'` → `[4, 9]`. Lo que no es número queda como `NaN` y lo rechaza `IsInt`. */
function aListaDeIds(valor: unknown): number[] {
  const crudos = Array.isArray(valor) ? valor : [valor];
  return crudos
    .flatMap((crudo) => String(crudo).split(','))
    .map((texto) => texto.trim())
    .filter((texto) => texto !== '')
    .map((texto) => Number(texto));
}

export class ConsultarTramitesDto {
  // La regex fija el formato y `IsDateString` estricto, que la fecha exista (rechaza 2026-02-30).
  @IsDateString(
    { strict: true },
    { message: 'La fecha no existe en el calendario.' },
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha se escribe como AAAA-MM-DD.',
  })
  fecha: string;

  @Transform(({ value }) => aListaDeIds(value))
  @IsPositive({ each: true, message: 'Una de las personas no es válida.' })
  @IsInt({ each: true, message: 'Una de las personas no es válida.' })
  @ArrayMaxSize(60, { message: 'Consulte como máximo 60 personas a la vez.' })
  @ArrayNotEmpty({ message: 'Indique al menos una persona.' })
  @IsArray({ message: 'Indique al menos una persona.' })
  funcionarioId: number[];
}

/** La respuesta tal cual la arma el servicio: sin cédulas. */
export type ConsultaTramitesResponseDto = ConsultaTramites;
