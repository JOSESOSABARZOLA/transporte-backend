/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Maestro de personal
 * Archivo: personal.dto.ts
 * Responsabilidad: Declarar los contratos de personal, ausencias y elegibles.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DOS RESPUESTAS DISTINTAS PARA EL MISMO FUNCIONARIO, Y ES EL PUNTO DE ESTE ARCHIVO.
 *
 *   `FuncionarioResponseDto`   completo, con cédula y teléfono. Solo ADMINISTRADOR_DMIP.
 *   `PersonaElegibleResponseDto`  nombre, área y cargo. Es lo que ve quien arma el
 *                                 cuadro, y no necesita más para elegir.
 *
 * RN-34 dice que el teléfono vive solo en el maestro. Que el DTO de selección no lo
 * incluya no es una omisión: es la forma de que no pueda escaparse. Un campo que no
 * existe en el contrato no se filtra por descuido en una pantalla nueva.
 *
 * Es también el caso 5 del plan —«modificar teléfono desde el operativo: imposible,
 * el campo no existe en su DTO»—, aplicado ya desde aquí.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ORDEN DE LOS DECORADORES: el mensaje que debe leer el administrador se declara EL
 * ÚLTIMO. Criterio fijado en M-06.
 */

import {
  AreaPersonal,
  DenominacionInstruccion,
  EstadoDisponibilidad,
  RolDepartamental,
  TipoContrato,
  type Disponibilidad,
  type Funcionario,
} from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import type { PersonaElegible } from '../../application/personal-elegible.service';
import type {
  NivelEquidad,
  NivelFatiga,
} from '../../application/politicas/indice-fatiga.policy';
import {
  comoFechaIso,
  estadoDeAusencia,
  LONGITUD_CEDULA,
  PATRON_CEDULA,
  type EstadoDeAusencia,
} from '../../application/reglas-personal';
import { fechaIsoEnZona } from '../../../../common/utilidades/marca-tiempo';
import type {
  AusenciaDelMaestro,
  OperativoDeLaPersona,
} from '../../infrastructure/disponibilidad.repository';

/** De dónde sale la persona en un alta. Ver `CrearFuncionarioDto.origen`. */
export const ORIGENES_DE_ALTA = { AUTH: 'AUTH', MANUAL: 'MANUAL' } as const;
export type OrigenDeAlta =
  (typeof ORIGENES_DE_ALTA)[keyof typeof ORIGENES_DE_ALTA];

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MENSAJE_FECHA = 'La fecha se escribe como AAAA-MM-DD.';

export class CrearFuncionarioDto {
  @Matches(PATRON_CEDULA, {
    message: `La cédula son ${LONGITUD_CEDULA} dígitos, sin guiones ni espacios.`,
  })
  @IsNotEmpty({ message: 'Indique la cédula del funcionario.' })
  cedula: string;

  @MaxLength(90, { message: 'Los apellidos no superan los 90 caracteres.' })
  @IsString({ message: 'Los apellidos deben ser texto.' })
  @IsNotEmpty({ message: 'Indique los apellidos del funcionario.' })
  apellidos: string;

  @MaxLength(90, { message: 'Los nombres no superan los 90 caracteres.' })
  @IsString({ message: 'Los nombres deben ser texto.' })
  @IsNotEmpty({ message: 'Indique los nombres del funcionario.' })
  nombres: string;

  @MaxLength(20, { message: 'El teléfono no supera los 20 caracteres.' })
  @IsString({ message: 'El teléfono debe ser texto.' })
  @IsOptional()
  telefono?: string | null;

  /*
    EL FORMATO LO COMPRUEBA EL SERVICIO, no este decorador. `esCorreoValido` vive en
    `reglas-personal.ts` junto a la cédula y el teléfono, que es donde el proyecto guarda
    las reglas del maestro; repartirlas entre el DTO y el dominio dejaría dos sitios que
    corregir el día que el negocio precise el formato. Aquí solo se acota la longitud,
    que es lo que la columna admite.
  */
  @MaxLength(160, {
    message: 'El correo institucional no supera los 160 caracteres.',
  })
  @IsString({ message: 'El correo institucional debe ser texto.' })
  @IsOptional()
  correoInstitucional?: string | null;

  @MaxLength(160, {
    message: 'El correo personal no supera los 160 caracteres.',
  })
  @IsString({ message: 'El correo personal debe ser texto.' })
  @IsOptional()
  correoPersonal?: string | null;

  @MaxLength(90, { message: 'El cargo no supera los 90 caracteres.' })
  @IsString({ message: 'El cargo debe ser texto.' })
  @IsOptional()
  cargo?: string | null;

  @IsEnum(AreaPersonal, {
    message: `El área admite estos valores: ${Object.values(AreaPersonal).join(', ')}.`,
  })
  @IsNotEmpty({ message: 'Indique el área del funcionario.' })
  area: AreaPersonal;

  @IsEnum(TipoContrato, {
    message: `El tipo de contrato admite estos valores: ${Object.values(TipoContrato).join(', ')}.`,
  })
  @IsNotEmpty({
    message:
      'Indique el tipo de contrato. De él depende si la persona puede salir de noche o en fin de semana.',
  })
  tipoContrato: TipoContrato;

  /**
   * Zonal de trabajo. OPCIONAL; se ofrece al personal DMIP (OPERATIVOS/GENERAL/TECNICO). Para
   * INSTRUCCION no viaja (la fija la matriz de cobertura). Si llega, el servicio la valida
   * vigente. 2026-09-21.
   */
  @IsPositive({ message: 'La zonal seleccionada no es válida.' })
  @IsInt({ message: 'La zonal seleccionada no es válida.' })
  @IsOptional()
  zonalId?: number | null;

  /**
   * DE DÓNDE SALE LA PERSONA (rediseño de P-07, 2026-10-08).
   *
   *   · `AUTH`   — elegida del directorio de Auth central. El correo institucional lo toma el
   *                SERVIDOR de Auth por la cédula; el que llegue en `correoInstitucional` se
   *                ignora (ver `CorreoInstitucionalAuthService`).
   *   · `MANUAL` — «¿No aparece? Registro manual». Sin Auth: se acepta el correo del cliente.
   *
   * Opcional y `MANUAL` por omisión, para que un cliente anterior al rediseño siga funcionando
   * exactamente como antes.
   */
  @IsEnum(ORIGENES_DE_ALTA, {
    message: 'El origen del alta admite estos valores: AUTH, MANUAL.',
  })
  @IsOptional()
  origen?: OrigenDeAlta;

  /*
    ═══════════════════════════════════════════════════════════════════════════════
    LA DIRECCIÓN NO SE RECIBE. Retirada del contrato el 2026-09-01.

    La deduce el servicio del área, con `ROL_DEL_AREA`. Aceptarla aquí —aunque fuera
    opcional— dejaría abierto que un cliente enviara un área de un departamento y la
    dirección de otro: la ficha acabaría en un maestro que no le corresponde, invisible
    para quien tendría que administrarla.

    Y admitía **cualquier** valor del enumerado, incluidos `DIRECTOR` y los tres
    administradores, que no son direcciones con personal. Era un hueco de validación
    que se cierra al dejar de preguntarla.
    ═══════════════════════════════════════════════════════════════════════════════
  */
}

/** Todo opcional: se modifica lo que llega y se conserva lo demás. */
export class ActualizarFuncionarioDto {
  @Matches(PATRON_CEDULA, {
    message: `La cédula son ${LONGITUD_CEDULA} dígitos, sin guiones ni espacios.`,
  })
  @IsOptional()
  cedula?: string;

  @MaxLength(90, { message: 'Los apellidos no superan los 90 caracteres.' })
  @IsString({ message: 'Los apellidos deben ser texto.' })
  @IsOptional()
  apellidos?: string;

  @MaxLength(90, { message: 'Los nombres no superan los 90 caracteres.' })
  @IsString({ message: 'Los nombres deben ser texto.' })
  @IsOptional()
  nombres?: string;

  @MaxLength(20, { message: 'El teléfono no supera los 20 caracteres.' })
  @IsString({ message: 'El teléfono debe ser texto.' })
  @IsOptional()
  telefono?: string | null;

  /*
    EL FORMATO LO COMPRUEBA EL SERVICIO, no este decorador. `esCorreoValido` vive en
    `reglas-personal.ts` junto a la cédula y el teléfono, que es donde el proyecto guarda
    las reglas del maestro; repartirlas entre el DTO y el dominio dejaría dos sitios que
    corregir el día que el negocio precise el formato. Aquí solo se acota la longitud,
    que es lo que la columna admite.
  */
  @MaxLength(160, {
    message: 'El correo institucional no supera los 160 caracteres.',
  })
  @IsString({ message: 'El correo institucional debe ser texto.' })
  @IsOptional()
  correoInstitucional?: string | null;

  @MaxLength(160, {
    message: 'El correo personal no supera los 160 caracteres.',
  })
  @IsString({ message: 'El correo personal debe ser texto.' })
  @IsOptional()
  correoPersonal?: string | null;

  @MaxLength(90, { message: 'El cargo no supera los 90 caracteres.' })
  @IsString({ message: 'El cargo debe ser texto.' })
  @IsOptional()
  cargo?: string | null;

  @IsEnum(AreaPersonal, { message: 'El área indicada no existe.' })
  @IsOptional()
  area?: AreaPersonal;

  @IsEnum(TipoContrato, { message: 'El tipo de contrato indicado no existe.' })
  @IsOptional()
  tipoContrato?: TipoContrato;

  /* La dirección tampoco se recibe al editar: cambia con el área. Ver el alta. */

  /** Zonal de trabajo (personal DMIP). Ver `CrearFuncionarioDto`. 2026-09-21. */
  @IsPositive({ message: 'La zonal seleccionada no es válida.' })
  @IsInt({ message: 'La zonal seleccionada no es válida.' })
  @IsOptional()
  zonalId?: number | null;

  @IsBoolean({ message: 'El estado del funcionario es verdadero o falso.' })
  @IsOptional()
  activo?: boolean;
}

/**
 * MOTIVO DE LA BAJA (2026-09-30). Códigos fijos; «OTRO» exige un detalle escrito. Son valores de
 * negocio, no un enumerado de la base: la columna guarda el código como texto. El detalle se
 * ignora cuando el motivo no es «OTRO».
 */
export enum MotivoBaja {
  FIN_CONTRATO = 'FIN_CONTRATO',
  RENUNCIA = 'RENUNCIA',
  TRASLADO = 'TRASLADO',
  OTRO = 'OTRO',
}

export class BajaFuncionarioDto {
  @IsEnum(MotivoBaja, {
    message:
      'Indique el motivo de la baja: fin de contrato, renuncia, traslado u otro.',
  })
  @IsNotEmpty({ message: 'Indique el motivo de la baja.' })
  motivo: MotivoBaja;

  /**
   * Detalle libre, OBLIGATORIO solo cuando el motivo es «OTRO». `ValidateIf` desactiva las demás
   * reglas cuando no aplica, de modo que un detalle vacío con un motivo estándar no rechaza.
   */
  @ValidateIf((dto: BajaFuncionarioDto) => dto.motivo === MotivoBaja.OTRO)
  @MaxLength(220, { message: 'El detalle no supera los 220 caracteres.' })
  @IsString({ message: 'El detalle debe ser texto.' })
  @IsNotEmpty({ message: 'Con motivo «Otro», escriba el detalle de la baja.' })
  detalle?: string;
}

export class CrearDisponibilidadDto {
  @IsEnum(EstadoDisponibilidad, {
    message:
      'La situación admite estos valores: DISPONIBLE, VACACIONES, REPOSO_MEDICO, CALAMIDAD, PERMISO, LICENCIA, CAPACITACION, COMISION_SERVICIOS.',
  })
  @IsNotEmpty({ message: 'Indique la situación de la persona.' })
  estado: EstadoDisponibilidad;

  @Matches(PATRON_FECHA, { message: MENSAJE_FECHA })
  @IsNotEmpty({ message: 'Indique desde qué día está ausente.' })
  desde: string;

  @Matches(PATRON_FECHA, { message: MENSAJE_FECHA })
  @IsNotEmpty({ message: 'Indique hasta qué día está ausente.' })
  hasta: string;

  @MaxLength(220, { message: 'El motivo no supera los 220 caracteres.' })
  @IsString({ message: 'El motivo debe ser texto.' })
  @IsOptional()
  motivo?: string | null;
}

// ─────────────────────────── Respuestas ───────────────────────────

/** Ficha completa. **Solo la ve el ADMINISTRADOR_DMIP.** */
export interface FuncionarioResponseDto {
  id: number;
  cedula: string;
  apellidos: string;
  nombres: string;
  telefono: string | null;
  /**
   * Correo institucional (añadido el 2026-09-01) y personal (añadido el 2026-10-01).
   *
   * VIAJAN EN ESTE DTO Y NO EN `PersonaElegibleResponseDto`, por el mismo criterio que el
   * teléfono: quien arma el cuadro elige personas, no las contacta. Un campo que no
   * existe en aquel contrato no se filtra por descuido en una pantalla nueva.
   */
  correoInstitucional: string | null;
  correoPersonal: string | null;
  cargo: string | null;
  area: AreaPersonal;
  tipoContrato: TipoContrato;
  direccion: RolDepartamental;
  /** Zona y denominación de Instrucción (nulos para el resto del personal). */
  zonalId: number | null;
  denominacion: DenominacionInstruccion | null;
  activo: boolean;
}

/**
 * Lo que ve quien arma el cuadro. Sin cédula y sin teléfono, a propósito.
 *
 * PV-37, RESUELTO EL 2026-08-11: llegan **todos** los candidatos del formulario, con
 * `elegible` y, si no lo es, el motivo redactado. Antes solo llegaban los aptos y quien
 * faltaba desaparecía sin explicación. El motivo de una ausencia se dice sin su causa:
 * ver `PersonalElegibleService`.
 */
export interface PersonaElegibleResponseDto {
  id: number;
  apellidos: string;
  nombres: string;
  area: AreaPersonal;
  cargo: string | null;
  /** Zona que la persona gestiona; la pantalla la propone como zonal del operativo al asignarla. */
  zonalId: number | null;
  elegible: boolean;
  motivo: string | null;
  /**
   * DOS SEÑALES ADVISORY DISTINTAS, ambas opcionales (solo viajan si se calcularon) y ninguna
   * cambia el filtrado por `elegible`.
   *
   * 1) FATIGA (seguridad, FRMS / ISO 45001): `indiceCarga` + `nivelFatiga`, por umbrales ABSOLUTOS.
   *    ¿La persona está cerca de un límite de fatiga? No depende del grupo.
   * 2) EQUIDAD (reparto): `cuotaJusta` (media del grupo), `desviacionCarga` (carga − cuota) y
   *    `nivelEquidad` (DEBAJO/EQUILIBRADO/ENCIMA). ¿Carga más o menos que su parte justa?
   *
   * `sugerido` marca a los elegibles por DEBAJO de su cuota: candidatos a recibir más para repartir.
   */
  indiceCarga?: number;
  nivelFatiga?: NivelFatiga;
  operativosAsignados?: number;
  cuotaJusta?: number;
  desviacionCarga?: number;
  nivelEquidad?: NivelEquidad;
  sugerido?: boolean;
}

export interface DisponibilidadResponseDto {
  id: number;
  estado: EstadoDisponibilidad;
  desde: string;
  hasta: string;
  motivo: string | null;
  registradoPor: number;
  /**
   * EN_CURSO · PROXIMA · PASADA respecto de hoy en Quito (2026-10-08). Una PASADA ya no se
   * puede quitar (409 `AUSENCIA_PASADA`). El frontend la espeja para el distintivo.
   */
  momento: EstadoDeAusencia;
}

/** Una ausencia en la lista del maestro (B5). Sin motivo: puede ser un dato de salud. */
export interface AusenciaDelMaestroResponseDto {
  id: number;
  funcionarioId: number;
  estado: EstadoDisponibilidad;
  desde: string;
  hasta: string;
  momento: EstadoDeAusencia;
}

/** Un operativo activo de la persona en el rango consultado (B6). */
export interface OperativoDeLaPersonaResponseDto {
  operativoId: number;
  identificador: string;
  /** Fecha de la jornada, `AAAA-MM-DD`. */
  fecha: string;
}

/** Fechas de la consulta de operativos de una persona (B6). */
export class RangoFechasDto {
  @Matches(PATRON_FECHA, { message: MENSAJE_FECHA })
  @IsNotEmpty({ message: 'Indique desde qué día consultar.' })
  desde: string;

  @Matches(PATRON_FECHA, { message: MENSAJE_FECHA })
  @IsNotEmpty({ message: 'Indique hasta qué día consultar.' })
  hasta: string;
}

/** Desde qué día listar las ausencias del maestro (B5). Sin él, hoy en Quito. */
export class DesdeFechaDto {
  @Matches(PATRON_FECHA, { message: MENSAJE_FECHA })
  @IsOptional()
  desde?: string;
}

export function aAusenciaDelMaestroResponse(
  ausencia: AusenciaDelMaestro,
  hoy: string = fechaIsoEnZona(),
): AusenciaDelMaestroResponseDto {
  const desde = comoFechaIso(ausencia.desde);
  const hasta = comoFechaIso(ausencia.hasta);
  return {
    id: ausencia.id,
    funcionarioId: ausencia.funcionarioId,
    estado: ausencia.estado,
    desde,
    hasta,
    momento: estadoDeAusencia(desde, hasta, hoy),
  };
}

export function aOperativoDeLaPersonaResponse(
  operativo: OperativoDeLaPersona,
): OperativoDeLaPersonaResponseDto {
  return {
    operativoId: operativo.operativoId,
    identificador: operativo.identificador,
    fecha: comoFechaIso(operativo.fecha),
  };
}

export function aFuncionarioResponse(
  funcionario: Funcionario,
): FuncionarioResponseDto {
  return {
    id: funcionario.id,
    cedula: funcionario.cedula,
    apellidos: funcionario.apellidos,
    nombres: funcionario.nombres,
    telefono: funcionario.telefono,
    correoInstitucional: funcionario.correoInstitucional,
    correoPersonal: funcionario.correoPersonal,
    cargo: funcionario.cargo,
    area: funcionario.area,
    tipoContrato: funcionario.tipoContrato,
    direccion: funcionario.direccion,
    zonalId: funcionario.zonalId,
    denominacion: funcionario.denominacion,
    activo: funcionario.activo,
  };
}

export function aPersonaElegibleResponse(
  persona: PersonaElegible,
): PersonaElegibleResponseDto {
  return {
    id: persona.id,
    apellidos: persona.apellidos,
    nombres: persona.nombres,
    area: persona.area,
    cargo: persona.cargo,
    zonalId: persona.zonalId,
    elegible: persona.elegible,
    motivo: persona.motivo,
    // Advisory. `undefined` se omite al serializar a JSON, así que el contrato sin estos campos
    // (cuando no se calcularon) queda idéntico al anterior.
    indiceCarga: persona.indiceCarga,
    nivelFatiga: persona.nivelFatiga,
    operativosAsignados: persona.operativosAsignados,
    cuotaJusta: persona.cuotaJusta,
    desviacionCarga: persona.desviacionCarga,
    nivelEquidad: persona.nivelEquidad,
    sugerido: persona.sugerido,
  };
}

export function aDisponibilidadResponse(
  periodo: Disponibilidad,
  hoy: string = fechaIsoEnZona(),
): DisponibilidadResponseDto {
  const desde = comoFechaIso(periodo.desde);
  const hasta = comoFechaIso(periodo.hasta);
  return {
    id: periodo.id,
    estado: periodo.estado,
    desde,
    hasta,
    motivo: periodo.motivo,
    registradoPor: periodo.registradoPor,
    momento: estadoDeAusencia(desde, hasta, hoy),
  };
}
