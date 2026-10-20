/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ventanas de carga
 * Archivo: ventana.dto.ts
 * Responsabilidad: Declarar los contratos de consulta y administración de ventanas.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * ORDEN DE LOS DECORADORES. class-validator informa las restricciones en orden inverso
 * al de declaración y el filtro muestra la primera como `mensaje`: el texto que debe
 * leer el administrador se declara EL ÚLTIMO. Criterio fijado en M-06.
 *
 * `null` ES UN VALOR CON SIGNIFICADO en este contrato, no la ausencia del campo. Una
 * hora de apertura nula significa «sin restricción de apertura», que es justo lo que
 * las fuentes permiten afirmar de los departamentos: solo definen la hora de CIERRE.
 * `@IsOptional()` deja pasar `null` y `undefined`, y el servicio los distingue: lo que
 * no viene no se toca, lo que viene como nulo se limpia.
 */

import { RolDepartamental, TipoVentana } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';

import { resolverMensajeVentana } from '../../../../common/auth/application/mensaje-ventana';
import { exigirEnumerado } from '../../../../common/utilidades/enumerado';
import { aMinutos, PATRON_HORA } from '../../../../common/utilidades/hora';
import type { EstadoVentana } from '../../application/ventana-carga.service';

const MENSAJE_HORA =
  'La hora se escribe en formato HH:MM, de 00:00 a 23:59. Por ejemplo, 15:00.';
const MENSAJE_DIA =
  'El día se indica de 1 a 7, donde 1 es lunes y 7 es domingo.';

/**
 * Consulta del estado de la ventana. 2026-08-20.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * `rol` ES OPCIONAL, Y ADMITIRLO NO CONTRADICE LA REGLA DE ESTE ENDPOINT.
 *
 * La cabecera del controlador decía —con razón— que la ventana no se pide, se deduce de
 * la identidad: si viniera libremente en la petición, cualquiera podría consultar el
 * horario de otro departamento. Eso sigue en pie. Lo que cambió es otra cosa: **desde el
 * 19-AGO-2026 una persona puede tener varios roles**, y entonces «su» ventana deja de ser
 * una sola. Preguntar por una de las propias no es espiar a nadie, y el controlador
 * **comprueba que el rol pedido esté entre los suyos** antes de responder.
 *
 * Omitirlo conserva el comportamiento anterior: la ventana del rol efectivo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export class ConsultarVentanaDto {
  @IsEnum(RolDepartamental, {
    message: 'El rol indicado no es un rol del Cuadro de Colores.',
  })
  @IsOptional()
  rol?: RolDepartamental;
}

/** Los tipos que se pueden elegir desde el 2026-10-07. SEMANAL e INTERVALO ya no se ofrecen. */
export const TIPOS_VENTANA_ELEGIBLES: TipoVentana[] = [
  TipoVentana.DIARIO,
  TipoVentana.LABORABLE,
  TipoVentana.SIN_RESTRICCION,
];

export const MENSAJE_CIERRE_POSTERIOR =
  'La hora de cierre debe ser posterior a la de apertura.';

/**
 * El cierre va DESPUÉS de la apertura cuando las dos viajan en la misma petición (2026-10-07).
 * Cuando solo llega una, la comprobación sobre la ventana combinada la hace el servicio
 * (`reglas-ventana.ts`) con el mismo mensaje.
 */
@ValidatorConstraint({ name: 'cierrePosteriorAApertura', async: false })
class CierrePosteriorAApertura implements ValidatorConstraintInterface {
  validate(cierre: unknown, argumentos: ValidationArguments): boolean {
    const { horaApertura } = argumentos.object as ActualizarVentanaDto;
    if (typeof cierre !== 'string' || typeof horaApertura !== 'string')
      return true;
    if (!PATRON_HORA.test(cierre) || !PATRON_HORA.test(horaApertura))
      return true;
    return aMinutos(cierre) > aMinutos(horaApertura);
  }

  defaultMessage(): string {
    return MENSAJE_CIERRE_POSTERIOR;
  }
}

export class ActualizarVentanaDto {
  @IsIn(TIPOS_VENTANA_ELEGIBLES, {
    message:
      'El tipo de ventana admite estos valores: DIARIO, LABORABLE, SIN_RESTRICCION.',
  })
  @IsOptional()
  tipo?: TipoVentana;

  @Max(7, { message: MENSAJE_DIA })
  @Min(1, { message: MENSAJE_DIA })
  @IsInt({ message: MENSAJE_DIA })
  @IsOptional()
  diaApertura?: number | null;

  @Matches(PATRON_HORA, { message: MENSAJE_HORA })
  @IsString({ message: MENSAJE_HORA })
  @IsOptional()
  horaApertura?: string | null;

  @Max(7, { message: MENSAJE_DIA })
  @Min(1, { message: MENSAJE_DIA })
  @IsInt({ message: MENSAJE_DIA })
  @IsOptional()
  diaCierre?: number | null;

  @Validate(CierrePosteriorAApertura)
  @Matches(PATRON_HORA, { message: MENSAJE_HORA })
  @IsString({ message: MENSAJE_HORA })
  @IsOptional()
  horaCierre?: string | null;

  @MaxLength(400, {
    message: 'El mensaje de cierre no puede superar los 400 caracteres.',
  })
  @MinLength(10, {
    message:
      'El mensaje de cierre debe explicarle al funcionario cuándo vuelve a abrirse.',
  })
  @IsString({ message: 'El mensaje de cierre debe ser texto.' })
  @IsOptional()
  mensajeCierre?: string;

  @IsBoolean({ message: 'El estado de la ventana es verdadero o falso.' })
  @IsOptional()
  activo?: boolean;
}

/** Estado de la ventana propia. Es lo que consulta la cabecera de la aplicación. */
export interface VentanaEstadoResponseDto {
  rol: RolDepartamental;
  abierta: boolean;
  activo: boolean;
  zonaHoraria: string;
  horaApertura: string | null;
  horaCierre: string | null;
  diaApertura: number | null;
  diaCierre: number | null;
  mensaje: string;
  /** El horario calculado de las horas reales (2026-10-06): lo que se muestra como horario. */
  horarioTexto: string;
  /** Solo la DAF: el motivo de su hora de apertura (RN-56), o null. */
  motivoApertura: string | null;
  /** El texto libre del administrador, como nota secundaria. */
  notaAdministrador: string | null;
  evaluadoEn: string;
}

/** Ventana completa, para la pantalla de administración. */
export interface VentanaResponseDto {
  rol: RolDepartamental;
  tipo: TipoVentana;
  diaApertura: number | null;
  horaApertura: string | null;
  diaCierre: number | null;
  horaCierre: string | null;
  zonaHoraria: string;
  mensajeCierre: string;
  /** El mensaje con `{cierre}` / `{apertura}` ya reemplazados (2026-10-07): lo que lee la tabla. */
  mensajeResuelto: string;
  activo: boolean;
}

export function aVentanaEstadoResponse(
  estado: EstadoVentana,
): VentanaEstadoResponseDto {
  return {
    rol: estado.rol,
    abierta: estado.abierta,
    activo: estado.activo,
    zonaHoraria: estado.zonaHoraria,
    horaApertura: estado.horaApertura,
    horaCierre: estado.horaCierre,
    diaApertura: estado.diaApertura,
    diaCierre: estado.diaCierre,
    mensaje: estado.mensaje,
    horarioTexto: estado.horarioTexto,
    motivoApertura: estado.motivoApertura,
    notaAdministrador: estado.notaAdministrador,
    evaluadoEn: estado.evaluadoEn.toISOString(),
  };
}

export function aVentanaResponse(ventana: {
  rol: RolDepartamental;
  tipo: TipoVentana;
  diaApertura: number | null;
  horaApertura: string | null;
  diaCierre: number | null;
  horaCierre: string | null;
  zonaHoraria: string;
  mensajeCierre: string;
  activo: boolean;
}): VentanaResponseDto {
  return {
    rol: ventana.rol,
    tipo: ventana.tipo,
    diaApertura: ventana.diaApertura,
    horaApertura: ventana.horaApertura,
    diaCierre: ventana.diaCierre,
    horaCierre: ventana.horaCierre,
    zonaHoraria: ventana.zonaHoraria,
    mensajeCierre: ventana.mensajeCierre,
    mensajeResuelto: resolverMensajeVentana(
      ventana.mensajeCierre,
      ventana.horaApertura,
      ventana.horaCierre,
    ),
    activo: ventana.activo,
  };
}

/**
 * Interpreta el rol que llega en la ruta.
 *
 * Sin esta comprobación, un valor cualquiera llegaría hasta Prisma y saldría como
 * error no controlado. La comprobación vive en `common/utilidades/enumerado.ts`, que
 * es la misma que usan los filtros del maestro de personal: un solo mensaje para el
 * mismo problema.
 */
export function aRolDepartamental(valor: string): RolDepartamental {
  return exigirEnumerado(valor, RolDepartamental, 'el rol del cuadro');
}
