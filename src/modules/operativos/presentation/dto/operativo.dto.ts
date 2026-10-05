/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos
 * Archivo: operativo.dto.ts
 * Responsabilidad: Declarar el contrato de registro, edición, consulta y respuesta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * NO INCLUYE `conductorId` NI `vehiculoId`. RN-40: nacen nulos y **solo la DAF los
 * completa**, desde `ActualizarTransporteDto` (M-17), que tiene exactamente dos
 * propiedades. Con `whitelist` y `forbidNonWhitelisted`, enviarlos aquí produce
 * `400 CAMPOS_NO_PERMITIDOS` con el campo nombrado. Es el caso 3 del plan.
 *
 * Tampoco incluye campos calculados —identificador, secuencial, duración, si es
 * nocturno, alertas—: los deriva el servidor. Enviarlos produce el mismo 400.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * `personalIds[]` SÍ VIAJA EN EL REGISTRO **desde el 2026-08-11**, y es opcional. Hasta
 * entonces no viajaba: cada asignación tiene su veredicto y su código de rechazo, y
 * enviarlas en bloque obligaba a decidir qué hacer con las tres que pasan cuando la
 * cuarta no. La decisión está tomada —no entra ninguna, ni el operativo— porque el
 * criterio anterior dejaba operativos vacíos en cuanto una persona era rechazada. El
 * detalle, sobre el propio campo.
 *
 * `cuadroFecha` y `formularioCodigo` NO SE PUEDEN EDITAR. Los dos componen el
 * identificador ya emitido —prefijo del formulario y día de la jornada—: cambiarlos
 * dejaría un código impreso en la matriz que ya no corresponde a lo que nombra. Mover un
 * operativo a otro día o a otro formulario es registrar otro y retirar este.
 */

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import type { PoliticaVehiculo } from '@prisma/client';

import { PaginacionDto } from '../../../../common/dto/paginacion.dto';
import type { Alerta } from '../../application/politicas/alertas-operativo';
import { estadoDeComposicion } from '../../application/politicas/composicion-personal';
import type { OperativoCompleto } from '../../infrastructure/operativos.repository';

/** RN-07. Horas en punto o y media. Mismo patrón que `ck_operativo_hora_inicio`. */
const PATRON_HORA = /^([01][0-9]|2[0-3]):(00|30)$/;

const MENSAJE_HORA_INICIO =
  'La hora de inicio debe ser una hora en punto o y media, escrita como HH:MM.';
const MENSAJE_HORA_FIN =
  'La hora de fin debe ser una hora en punto o y media, escrita como HH:MM.';

/**
 * Una persona asignada con su VENTANA HORARIA PROPIA, opcional (2026-09-08).
 *
 * `horaInicio`/`horaFin` van juntas —o las dos, o ninguna— y, si faltan, la persona cumple
 * el horario del operativo (el caso de siempre). El servicio comprueba además que la ventana
 * caiga DENTRO de la del operativo. Convive con `personalIds` por compatibilidad: cuando
 * viaja `personal`, se usa esta lista; si no, `personalIds` (todos con el horario del operativo).
 */
export class PersonaConHorarioDto {
  @IsPositive({ message: 'La persona seleccionada no es válida.' })
  @IsInt({ message: 'La persona seleccionada no es válida.' })
  funcionarioId: number;

  @Matches(PATRON_HORA, { message: MENSAJE_HORA_INICIO })
  @IsOptional()
  horaInicio?: string;

  @Matches(PATRON_HORA, { message: MENSAJE_HORA_FIN })
  @IsOptional()
  horaFin?: string;

  /**
   * Cuántos operativos genera ESTA persona (2026-09-10). Por defecto 1. Solo tiene efecto en
   * los formularios con `form_varios_por_persona` (el 8 y el 5): la persona genera N operativos
   * de una sola persona, con su horario dividido en N tramos consecutivos. En los demás
   * formularios, una cantidad > 1 se rechaza. Tope de 50 por persona (sin tope total).
   */
  @Max(50, {
    message: 'Una persona no puede generar más de 50 operativos.',
  })
  @Min(1, {
    message: 'La cantidad de operativos de una persona debe ser al menos 1.',
  })
  @IsInt({ message: 'La cantidad de operativos debe ser un número entero.' })
  @IsOptional()
  cantidad?: number;
}

/**
 * PUNTO DE ENCUENTRO NUEVO, capturado al registrar (Unidad de Operativos, 2026-09-24).
 *
 * Lo pidió Unidad de Operativos: teclear un punto que no está en el catálogo y que quede
 * registrado ligado a la zonal elegida. **Se crea DENTRO de la transacción del registro**, de
 * modo que si el operativo no se crea (personal rechazado, catálogo inválido…), el punto tampoco
 * queda: entran juntos o no entra ninguno (regla 5 de CLAUDE.md). Es excluyente con
 * `puntoEncuentroId` (uno del catálogo) y con `puntoLibre` (ADICIONALES): o se elige uno, o se
 * teclea uno adicional suelto, o se crea uno nuevo. Solo lo admiten los formularios con
 * `form_punto_manual` (los de Unidad de Operativos, 1-4); el servicio lo verifica.
 */
export class PuntoNuevoDto {
  @MaxLength(200, {
    message:
      'El nombre del punto de encuentro no puede superar los 200 caracteres.',
  })
  @MinLength(3, {
    message:
      'El nombre del punto de encuentro debe tener al menos 3 caracteres.',
  })
  @IsString({ message: 'El nombre del punto de encuentro es un texto.' })
  @IsNotEmpty({ message: 'Escriba el nombre del punto de encuentro.' })
  nombre: string;

  @IsPositive({ message: 'La zonal del punto de encuentro no es válida.' })
  @IsInt({ message: 'La zonal del punto de encuentro no es válida.' })
  @IsNotEmpty({ message: 'Indique la zonal del nuevo punto de encuentro.' })
  zonalId: number;
}

export class CrearOperativoDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha de la jornada se escribe como AAAA-MM-DD.',
  })
  @IsNotEmpty({ message: 'Indique la fecha de la jornada del operativo.' })
  cuadroFecha: string;

  @MaxLength(40, { message: 'El código de formulario es demasiado largo.' })
  @IsNotEmpty({
    message: 'Indique el formulario en el que registra el operativo.',
  })
  formularioCodigo: string;

  /**
   * Horario del operativo. **Opcional desde RN-66 (2026-09-08):** el operativo ya no tiene
   * horario propio; lo TOMA de las ventanas de las personas (cada una obligatoria en
   * `personal[]`). Se conserva por compatibilidad y para el modo clásico. El servicio exige
   * que, si no viaja, cada persona traiga su ventana completa.
   */
  @Matches(PATRON_HORA, { message: MENSAJE_HORA_INICIO })
  @IsOptional()
  horaInicio?: string;

  @Matches(PATRON_HORA, { message: MENSAJE_HORA_FIN })
  @IsOptional()
  horaFin?: string;

  @IsInt({
    each: true,
    message: 'Alguna de las zonales indicadas no es válida.',
  })
  @ArrayNotEmpty({ message: 'Elija al menos una zonal.' })
  @IsArray({ message: 'Elija al menos una zonal.' })
  zonalesIds: number[];

  @IsPositive({ message: 'El punto de encuentro seleccionado no es válido.' })
  @IsInt({ message: 'El punto de encuentro seleccionado no es válido.' })
  @IsOptional()
  puntoEncuentroId?: number;

  @MaxLength(220, {
    message:
      'El punto de encuentro adicional no puede superar los 220 caracteres.',
  })
  @IsOptional()
  puntoLibre?: string;

  /**
   * PUNTO NUEVO que se crea al registrar (Unidad de Operativos, 2026-09-24). Excluyente con
   * `puntoEncuentroId` y `puntoLibre`. El servicio lo crea DENTRO de la transacción del registro
   * y solo si el formulario lo permite. Ver `PuntoNuevoDto`.
   */
  @ValidateNested()
  @Type(() => PuntoNuevoDto)
  @IsOptional()
  puntoNuevo?: PuntoNuevoDto;

  @IsPositive({ message: 'El tipo de control seleccionado no es válido.' })
  @IsInt({ message: 'El tipo de control seleccionado no es válido.' })
  @IsOptional()
  tipoControlId?: number;

  /**
   * Varios tipos de control, SOLO en el formulario que lo admite (form 8). En los demás se
   * envía `tipoControlId` (uno solo). El servidor valida la cardinalidad según el formulario.
   */
  @IsPositive({
    each: true,
    message: 'El tipo de control seleccionado no es válido.',
  })
  @IsInt({
    each: true,
    message: 'El tipo de control seleccionado no es válido.',
  })
  @IsArray()
  @IsOptional()
  tipoControlIds?: number[];

  @MaxLength(220, {
    message:
      'El tipo de control adicional no puede superar los 220 caracteres.',
  })
  @IsOptional()
  tipoLibre?: string;

  @IsInt({
    each: true,
    message: 'Alguna de las instituciones indicadas no es válida.',
  })
  @ArrayNotEmpty({ message: 'Elija al menos una institución participante.' })
  @IsArray({ message: 'Elija al menos una institución participante.' })
  institucionesIds: number[];

  /**
   * Personal que se asigna junto con el registro. **Opcional.**
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * AGREGADO EL 2026-08-11 · EL OPERATIVO Y SU PERSONAL ENTRAN JUNTOS O NO ENTRAN.
   *
   * Hasta esta fecha `personal[]` no viajaba en el registro a propósito: cada asignación
   * tiene su veredicto y su código de rechazo, y enviarlas en bloque obligaba a decidir
   * qué se hace con las tres que pasan cuando la cuarta no. Se resolvió creando primero
   * el operativo y asignando después, una a una.
   *
   * En uso real eso dejaba **operativos vacíos**: al rechazarse una persona, el operativo
   * ya estaba creado y sin nadie dentro. La pregunta que quedaba abierta tiene ahora
   * respuesta: **no entra ninguna, y tampoco el operativo**. Quien captura corrige la
   * persona y reintenta, sin perder lo escrito.
   *
   * Sigue existiendo `POST /operativos/:id/personal` para agregar sobre un operativo ya
   * registrado, que es lo que hace la pantalla de edición: ahí sí tiene sentido que una
   * persona rechazada no afecte a las que ya están dentro.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  @IsInt({
    each: true,
    message: 'Alguna de las personas indicadas no es válida.',
  })
  @IsArray({ message: 'El personal se indica como una lista.' })
  @IsOptional()
  personalIds?: number[];

  /**
   * Personal con su ventana horaria propia (2026-09-08). Si viaja, tiene prioridad sobre
   * `personalIds`; cada persona sin `horaInicio/horaFin` cumple el horario del operativo.
   */
  @ValidateNested({ each: true })
  @Type(() => PersonaConHorarioDto)
  @IsArray({ message: 'El personal se indica como una lista.' })
  @IsOptional()
  personal?: PersonaConHorarioDto[];

  /**
   * Notas del operativo (bitácora, 2026-09-09). Cada una es una nota independiente; se guardan
   * como filas propias con su autor y fecha. Antes era un solo campo de texto.
   */
  @MaxLength(2000, {
    each: true,
    message: 'Cada nota no puede superar los 2000 caracteres.',
  })
  @IsString({ each: true, message: 'Cada nota es un texto.' })
  @ArrayMaxSize(50, { message: 'No se pueden registrar más de 50 notas.' })
  @IsArray({ message: 'Las notas se indican como una lista.' })
  @IsOptional()
  observaciones?: string[];
}

/**
 * Registro de un ADICIONAL. 2026-08-20.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ES `CrearOperativoDto` MENOS DOS CAMPOS, y su ausencia es el contrato:
 *
 *   · `cuadroFecha` la pone el operativo del que nace. Un adicional en otra fecha no
 *     es un adicional: se dispone el mismo día que se ejecuta lo que lo motivó.
 *   · `formularioCodigo` también. En otro formulario llevaría un prefijo que no
 *     corresponde a su padre, y el identificador dejaría de significar lo que nombra.
 *
 * Con `whitelist` y `forbidNonWhitelisted`, enviarlos produce `400 CAMPOS_NO_PERMITIDOS`
 * con el campo nombrado. NO se hereda de `CrearOperativoDto` con `Omit`: `class-validator`
 * trabaja sobre metadatos de la clase, y omitir propiedades en el tipo no retira sus
 * decoradores. La lista se escribe entera, que es lo único que garantiza el rechazo.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * TODO LO DEMÁS SÍ VIAJA, y puede diferir del padre: horario, zonales, punto, tipo,
 * instituciones y personal son del adicional. Si coincidiera en todo con el operativo del
 * que nace, no habría razón para crearlo.
 */
export class CrearAdicionalDto {
  /** Horario del adicional. Opcional desde RN-66: se toma de las personas. Ver `CrearOperativoDto`. */
  @Matches(PATRON_HORA, { message: MENSAJE_HORA_INICIO })
  @IsOptional()
  horaInicio?: string;

  @Matches(PATRON_HORA, { message: MENSAJE_HORA_FIN })
  @IsOptional()
  horaFin?: string;

  @IsInt({
    each: true,
    message: 'Alguna de las zonales indicadas no es válida.',
  })
  @ArrayNotEmpty({ message: 'Elija al menos una zonal.' })
  @IsArray({ message: 'Elija al menos una zonal.' })
  zonalesIds: number[];

  @IsPositive({ message: 'El punto de encuentro seleccionado no es válido.' })
  @IsInt({ message: 'El punto de encuentro seleccionado no es válido.' })
  @IsOptional()
  puntoEncuentroId?: number;

  @MaxLength(220, {
    message:
      'El punto de encuentro adicional no puede superar los 220 caracteres.',
  })
  @IsOptional()
  puntoLibre?: string;

  @IsPositive({ message: 'El tipo de control seleccionado no es válido.' })
  @IsInt({ message: 'El tipo de control seleccionado no es válido.' })
  @IsOptional()
  tipoControlId?: number;

  /**
   * Varios tipos de control, SOLO en el formulario que lo admite (form 8). En los demás se
   * envía `tipoControlId` (uno solo). El servidor valida la cardinalidad según el formulario.
   */
  @IsPositive({
    each: true,
    message: 'El tipo de control seleccionado no es válido.',
  })
  @IsInt({
    each: true,
    message: 'El tipo de control seleccionado no es válido.',
  })
  @IsArray()
  @IsOptional()
  tipoControlIds?: number[];

  @MaxLength(220, {
    message:
      'El tipo de control adicional no puede superar los 220 caracteres.',
  })
  @IsOptional()
  tipoLibre?: string;

  @IsInt({
    each: true,
    message: 'Alguna de las instituciones indicadas no es válida.',
  })
  @ArrayNotEmpty({ message: 'Elija al menos una institución participante.' })
  @IsArray({ message: 'Elija al menos una institución participante.' })
  institucionesIds: number[];

  /** Todo o nada, igual que en el registro ordinario. Ver `CrearOperativoDto`. */
  @IsInt({
    each: true,
    message: 'Alguna de las personas indicadas no es válida.',
  })
  @IsArray({ message: 'El personal se indica como una lista.' })
  @IsOptional()
  personalIds?: number[];

  /**
   * Personal con su ventana horaria propia (2026-09-08). Si viaja, tiene prioridad sobre
   * `personalIds`; cada persona sin `horaInicio/horaFin` cumple el horario del operativo.
   */
  @ValidateNested({ each: true })
  @Type(() => PersonaConHorarioDto)
  @IsArray({ message: 'El personal se indica como una lista.' })
  @IsOptional()
  personal?: PersonaConHorarioDto[];

  /**
   * Notas del operativo (bitácora, 2026-09-09). Cada una es una nota independiente; se guardan
   * como filas propias con su autor y fecha. Antes era un solo campo de texto.
   */
  @MaxLength(2000, {
    each: true,
    message: 'Cada nota no puede superar los 2000 caracteres.',
  })
  @IsString({ each: true, message: 'Cada nota es un texto.' })
  @ArrayMaxSize(50, { message: 'No se pueden registrar más de 50 notas.' })
  @IsArray({ message: 'Las notas se indican como una lista.' })
  @IsOptional()
  observaciones?: string[];
}

/**
 * Edición. Todo opcional salvo `version`, que sostiene el bloqueo optimista.
 *
 * `version` es obligatoria a propósito: sin ella, dos asistentes editando el mismo
 * operativo se sobrescribirían en silencio y el último ganaría sin saberlo.
 */
export class ActualizarOperativoDto {
  @Min(1, { message: 'La versión del operativo no es válida.' })
  @IsInt({ message: 'La versión del operativo no es válida.' })
  @IsNotEmpty({
    message:
      'Falta la versión del operativo. Vuelva a abrirlo y guarde de nuevo para no sobrescribir el trabajo de otra persona.',
  })
  version: number;

  @Matches(PATRON_HORA, { message: MENSAJE_HORA_INICIO })
  @IsOptional()
  horaInicio?: string;

  @Matches(PATRON_HORA, { message: MENSAJE_HORA_FIN })
  @IsOptional()
  horaFin?: string;

  @IsInt({
    each: true,
    message: 'Alguna de las zonales indicadas no es válida.',
  })
  @ArrayNotEmpty({ message: 'Elija al menos una zonal.' })
  @IsArray({ message: 'Elija al menos una zonal.' })
  @IsOptional()
  zonalesIds?: number[];

  @IsPositive({ message: 'El punto de encuentro seleccionado no es válido.' })
  @IsInt({ message: 'El punto de encuentro seleccionado no es válido.' })
  @IsOptional()
  puntoEncuentroId?: number;

  @MaxLength(220, {
    message:
      'El punto de encuentro adicional no puede superar los 220 caracteres.',
  })
  @IsOptional()
  puntoLibre?: string;

  @IsPositive({ message: 'El tipo de control seleccionado no es válido.' })
  @IsInt({ message: 'El tipo de control seleccionado no es válido.' })
  @IsOptional()
  tipoControlId?: number;

  /**
   * Varios tipos de control, SOLO en el formulario que lo admite (form 8). En los demás se
   * envía `tipoControlId` (uno solo). El servidor valida la cardinalidad según el formulario.
   */
  @IsPositive({
    each: true,
    message: 'El tipo de control seleccionado no es válido.',
  })
  @IsInt({
    each: true,
    message: 'El tipo de control seleccionado no es válido.',
  })
  @IsArray()
  @IsOptional()
  tipoControlIds?: number[];

  @MaxLength(220, {
    message:
      'El tipo de control adicional no puede superar los 220 caracteres.',
  })
  @IsOptional()
  tipoLibre?: string;

  @IsInt({
    each: true,
    message: 'Alguna de las instituciones indicadas no es válida.',
  })
  @ArrayNotEmpty({ message: 'Elija al menos una institución participante.' })
  @IsArray({ message: 'Elija al menos una institución participante.' })
  @IsOptional()
  institucionesIds?: number[];

  /**
   * Notas NUEVAS a agregar (bitácora append-only, 2026-09-09). Las ya escritas no se editan
   * ni se borran: quedan como constancia. En la edición solo se añaden.
   */
  @MaxLength(2000, {
    each: true,
    message: 'Cada nota no puede superar los 2000 caracteres.',
  })
  @IsString({ each: true, message: 'Cada nota es un texto.' })
  @ArrayMaxSize(50, {
    message: 'No se pueden agregar más de 50 notas a la vez.',
  })
  @IsArray({ message: 'Las notas se indican como una lista.' })
  @IsOptional()
  observacionesNuevas?: string[];
}

/** Baja lógica. Exige la versión por el mismo motivo que la edición. */
export class RetirarOperativoDto {
  @Min(1, { message: 'La versión del operativo no es válida.' })
  @IsInt({ message: 'La versión del operativo no es válida.' })
  @Type(() => Number)
  @IsNotEmpty({
    message:
      'Falta la versión del operativo. Vuelva a abrirlo y reintente el retiro.',
  })
  version: number;
}

/**
 * Asignación de una persona. RN-34: **el teléfono no viaja en la petición**.
 *
 * Se resuelve desde el maestro al componer la respuesta. Si se pudiera enviar, el cuadro
 * acabaría con tres números distintos para la misma persona, que es exactamente lo que
 * hoy ocurre en el Excel.
 */
export class AsignacionPersonalDto {
  @IsPositive({ message: 'La persona seleccionada no es válida.' })
  @IsInt({ message: 'La persona seleccionada no es válida.' })
  @IsNotEmpty({ message: 'Indique la persona que desea asignar.' })
  funcionarioId: number;

  @IsBoolean({
    message: 'Indique con verdadero o falso si la persona es responsable.',
  })
  @IsOptional()
  esResponsable?: boolean;

  /** Ventana horaria propia (opcional, 2026-09-08). Si falta, cumple la del operativo. */
  @Matches(PATRON_HORA, { message: MENSAJE_HORA_INICIO })
  @IsOptional()
  horaInicio?: string;

  @Matches(PATRON_HORA, { message: MENSAJE_HORA_FIN })
  @IsOptional()
  horaFin?: string;
}

/**
 * Cambio del turno propio de una persona ya asignada (RN-66, 2026-09-09).
 *
 * LAS DOS HORAS SON OBLIGATORIAS: editar el horario es fijar una ventana completa, no dejarla
 * a medias. A diferencia de `AsignacionPersonalDto` —donde el turno es opcional al asignar—,
 * aquí el propósito ES el turno. El operativo re-deriva su ventana (envolvente) de los turnos
 * de su gente, así que no se pide ni se admite un horario de operativo.
 */
export class ActualizarTurnoPersonalDto {
  @Matches(PATRON_HORA, { message: MENSAJE_HORA_INICIO })
  @IsNotEmpty({ message: 'Indique la hora de inicio del turno de la persona.' })
  @IsString({ message: 'La hora de inicio del turno no es válida.' })
  horaInicio: string;

  @Matches(PATRON_HORA, { message: MENSAJE_HORA_FIN })
  @IsNotEmpty({ message: 'Indique la hora de fin del turno de la persona.' })
  @IsString({ message: 'La hora de fin del turno no es válida.' })
  horaFin: string;
}

/**
 * Editar los campos GENERALES de toda una patrulla (Form 5/6). 2026-09-18.
 *
 * Es `ActualizarOperativoDto` **sin `version` ni horario**: la versión se resuelve por miembro
 * en el servidor y el horario es por persona/código, no de la patrulla. Lo enviado se aplica a
 * TODOS los códigos del lote (`grupoRegistro`); lo no enviado no cambia.
 */
export class EditarPatrullaDto {
  @IsInt({
    each: true,
    message: 'Alguna de las zonales indicadas no es válida.',
  })
  @ArrayNotEmpty({ message: 'Elija al menos una zonal.' })
  @IsArray({ message: 'Elija al menos una zonal.' })
  @IsOptional()
  zonalesIds?: number[];

  @IsPositive({ message: 'El punto de encuentro seleccionado no es válido.' })
  @IsInt({ message: 'El punto de encuentro seleccionado no es válido.' })
  @IsOptional()
  puntoEncuentroId?: number;

  @MaxLength(220, {
    message:
      'El punto de encuentro adicional no puede superar los 220 caracteres.',
  })
  @IsOptional()
  puntoLibre?: string;

  @IsPositive({ message: 'El tipo de control seleccionado no es válido.' })
  @IsInt({ message: 'El tipo de control seleccionado no es válido.' })
  @IsOptional()
  tipoControlId?: number;

  @IsPositive({
    each: true,
    message: 'El tipo de control seleccionado no es válido.',
  })
  @IsInt({
    each: true,
    message: 'El tipo de control seleccionado no es válido.',
  })
  @IsArray()
  @IsOptional()
  tipoControlIds?: number[];

  @MaxLength(220, {
    message:
      'El tipo de control adicional no puede superar los 220 caracteres.',
  })
  @IsOptional()
  tipoLibre?: string;

  @IsInt({
    each: true,
    message: 'Alguna de las instituciones indicadas no es válida.',
  })
  @ArrayNotEmpty({ message: 'Elija al menos una institución participante.' })
  @IsArray({ message: 'Elija al menos una institución participante.' })
  @IsOptional()
  institucionesIds?: number[];

  @MaxLength(2000, {
    each: true,
    message: 'Cada nota no puede superar los 2000 caracteres.',
  })
  @IsString({ each: true, message: 'Cada nota es un texto.' })
  @ArrayMaxSize(50, {
    message: 'No se pueden agregar más de 50 notas a la vez.',
  })
  @IsArray({ message: 'Las notas se indican como una lista.' })
  @IsOptional()
  observacionesNuevas?: string[];
}

/**
 * Reemplazar a la persona de un operativo de una sola persona (patrulla). 2026-09-18.
 *
 * Solo la persona nueva: el código y su horario se conservan, y el servidor exige que sea de la
 * MISMA área que el ocupante saliente (el identificador la codifica).
 */
export class ReemplazarPersonalDto {
  @IsPositive({ message: 'La persona seleccionada no es válida.' })
  @IsInt({ message: 'La persona seleccionada no es válida.' })
  @IsNotEmpty({ message: 'Indique la persona que reemplazará a la actual.' })
  funcionarioId: number;
}

export class FiltroOperativosDto extends PaginacionDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha se escribe como AAAA-MM-DD.',
  })
  @IsOptional()
  fecha?: string;

  @MaxLength(40, { message: 'El código de formulario es demasiado largo.' })
  @IsOptional()
  formulario?: string;
}

// ─────────────────────────── Respuesta ───────────────────────────

/**
 * Los colores viajan en la respuesta. FASE5 §10.2: el frontend **no** los define ni los
 * interpreta, son dato institucional del Excel aprobado.
 */
export interface FormularioDelOperativoDto {
  codigo: string;
  nombre: string;
  numero: number;
  colorFondo: string;
  colorAcento: string;
  colorNombre: string;
  esPatrulla: boolean;
  condicionanteNoct: boolean;
  /**
   * RN-41 y RN-42. Viaja desde el 2026-08-24, y sirve para que la fila **diga** lo que
   * hasta entonces callaba.
   *
   * Un operativo de formulario `NO_APLICA` no lleva conductor ni placa por definición, y
   * la celda de conductor quedaba en blanco: `alertasDeTransporte` no emite ninguna
   * alerta para esos formularios —correctamente, porque nadie podría resolverla—, así
   * que no había nada que pintar, y un guion es indistinguible de «todavía no asignado».
   */
  politicaVehiculo: PoliticaVehiculo;
  /**
   * RN-61. Si este formulario admite operativos adicionales. Desde el 2026-08-24.
   *
   * **No es una regla escrita en código: la dice el dato.** Un formulario los admite si
   * y solo si tiene un prefijo marcado con `fpre_es_adicional`, y hoy lo tiene uno solo:
   * `OCAPMO`, del formulario 2 · PMO. Las «A» de `ICA`, `OCA`, `IGA` e `ITA` son
   * ordinarias. Cambiarlo es un `UPDATE`, no un despliegue.
   */
  admiteAdicionales: boolean;
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * QUIÉN MANDA SOBRE ESTE OPERATIVO Y QUIÉN SOLO APORTA. Desde el 2026-08-25.
   *
   * Hasta hoy la pantalla no necesitaba distinguirlo, y no era casualidad: el único
   * formulario compartido era el 6, y su rol compartido —el DMIT— **no veía ningún
   * operativo suyo en P-02**. Al abrir el formulario 4 al DMIT eso deja de ser cierto:
   * la patrulla ECU aparece en «Mis operativos» de un departamento que **no puede
   * editarla**, y sin estos dos campos la pantalla ofrecería «Editar» y «Retirar» para
   * que el servidor los rechazara con un 403, con el trabajo ya capturado.
   *
   * SON LOS DOS ROLES, NO UN «PUEDE EDITAR» YA RESUELTO. El veredicto depende de quién
   * mire, y `user.rolCodes` es plural desde el 19-AGO: la misma respuesta sirve a quien
   * es dueño y a quien solo aporta. Devolverlo masticado ataría la respuesta al
   * solicitante.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  rolDueno: string;
  /**
   * Qué puede hacer cada departamento en este formulario.
   *
   * SIN EL CUPO: la pantalla no lo usa —el tope lo aplica el servidor al asignar, y su
   * mensaje llega redactado— y publicarlo invitaría a que alguien lo comprobara en el
   * navegador, que es donde no debe comprobarse.
   */
  roles: { rol: string; acceso: string }[];
}

/**
 * Persona asignada, tal como la muestra la fila del cuadro.
 *
 * **Sin cédula.** El cuadro necesita nombre, área y teléfono; la cédula es un dato
 * personal que ninguna pantalla de este módulo usa, y M-10 ya estableció que no se
 * expone donde no hace falta. El teléfono sí, y sale del maestro (RN-34).
 */
export interface PersonaAsignadaDto {
  funcionarioId: number;
  nombre: string;
  area: string;
  telefono: string | null;
  esResponsable: boolean;
  /** RF-063. Qué departamento la asignó, para el cupo compartido. */
  asignadoPorRol: string;
  /**
   * Ventana horaria EFECTIVA de la persona (2026-09-08): su ventana propia si la tiene, o
   * la del operativo. Así la matriz, la orden y la pantalla la leen sin recalcular.
   */
  horaInicio: string;
  horaFin: string;
}

/**
 * De qué operativo nació un adicional. `null` en un operativo ordinario.
 *
 * VIAJA EL IDENTIFICADOR Y NO SOLO EL NÚMERO DE FILA. La pantalla escribe «adicional de
 * OCPMO-004», y con el `id` a secas tendría que pedir el padre entero para poder
 * nombrarlo: una consulta por fila del cuadro para pintar cinco caracteres.
 */
export interface OrigenDelOperativoDto {
  id: number;
  identificador: string;
}

/**
 * Una nota del operativo (bitácora append-only, 2026-09-09): su texto y quién la escribió y
 * cuándo. `creadoPorRol` es el departamento, no la persona: es lo que el módulo conoce sin
 * cruzar con el maestro de usuarios, y basta para la constancia.
 */
export interface ObservacionDto {
  texto: string;
  creadoPorRol: string;
  creadoEn: string;
}

export interface OperativoResponseDto {
  id: number;
  identificador: string;
  secuencial: number;
  /** Lote del registro-patrulla (Form 5/6): agrupa los N en las listas. Nulo en el resto. */
  grupoRegistro: string | null;
  cuadroFecha: string;
  /**
   * RN-20 no tiene nada que ver con esto: aquí «adicional» es la salida extraordinaria
   * del 2026-08-20, no la captura libre de un punto o un tipo de control.
   */
  esAdicional: boolean;
  origen: OrigenDelOperativoDto | null;
  /** Cuántos adicionales nacieron de este operativo. Cero en la inmensa mayoría. */
  adicionales: number;
  formulario: FormularioDelOperativoDto;
  horaInicio: string;
  horaFin: string;
  horario: string;
  duracionHoras: number;
  esNocturno: boolean;
  cruzaMedianoche: boolean;
  zonales: { id: number; codigo: string; nombre: string }[];
  puntoEncuentro: { id: number; nombre: string; zonalNombre: string } | null;
  puntoLibre: string | null;
  tipoControl: { id: number; nombre: string } | null;
  /** Varios tipos, SOLO en el formulario que lo admite (form 8). Vacío en el resto. */
  tiposControl: { id: number; nombre: string }[];
  tipoLibre: string | null;
  instituciones: { id: number; sigla: string; nombre: string }[];
  personal: PersonaAsignadaDto[];
  /** RN-31 y RN-32. Se informa, no bloquea. Ver PV-29. */
  composicion: {
    esPatrulla: boolean;
    completa: boolean;
    areasPendientes: string[];
  };
  estadoTransporte: string;
  alertaActiva: boolean;
  /** POL-06. Derivadas por el servidor: el frontend no las calcula, las pinta. */
  alertas: Alerta[];
  /** Notas del operativo (bitácora append-only, 2026-09-09), en el orden en que se escribieron. */
  observaciones: ObservacionDto[];
  creadoPorRol: string;
  creadoPor: number;
  modificadoPorRol: string;
  modificadoPor: number;
  version: number;
  creadoEn: string;
}

export function aOperativoResponse(
  operativo: OperativoCompleto,
): OperativoResponseDto {
  return {
    id: operativo.id,
    identificador: operativo.identificador,
    secuencial: operativo.secuencial,
    grupoRegistro: operativo.grupoRegistro,
    cuadroFecha: operativo.cuadro.fecha.toISOString().slice(0, 10),
    // Se deriva de `origenId` y no de `origen`, que es la relación cargada: los dos dicen
    // lo mismo, pero la columna es la fuente y la relación su reflejo.
    esAdicional: operativo.origenId !== null,
    origen: operativo.origen
      ? {
          id: operativo.origen.id,
          identificador: operativo.origen.identificador,
        }
      : null,
    adicionales: operativo._count.adicionales,
    formulario: {
      codigo: operativo.formulario.codigo,
      nombre: operativo.formulario.nombre,
      numero: operativo.formulario.numero,
      colorFondo: operativo.formulario.colorFondo,
      colorAcento: operativo.formulario.colorAcento,
      colorNombre: operativo.formulario.colorNombre,
      esPatrulla: operativo.formulario.esPatrulla,
      condicionanteNoct: operativo.formulario.condicionanteNoct,
      politicaVehiculo: operativo.formulario.politicaVehiculo,
      admiteAdicionales: operativo.formulario.prefijos.some(
        (prefijo) => prefijo.esAdicional,
      ),
      rolDueno: operativo.formulario.rolDueno,
      roles: operativo.formulario.roles.map((fila) => ({
        rol: fila.rol,
        acceso: fila.acceso,
      })),
    },
    horaInicio: operativo.horaInicio,
    horaFin: operativo.horaFin,
    horario: `${operativo.horaInicio.replace(':', 'H')} A ${operativo.horaFin.replace(':', 'H')}`,
    duracionHoras: Number(operativo.duracionHoras),
    esNocturno: operativo.esNocturno,
    cruzaMedianoche: operativo.cruzaMedianoche,
    zonales: operativo.zonales.map((fila) => ({
      id: fila.zonal.id,
      codigo: fila.zonal.codigo,
      nombre: fila.zonal.nombre,
    })),
    puntoEncuentro: operativo.puntoEncuentro
      ? {
          id: operativo.puntoEncuentro.id,
          nombre: operativo.puntoEncuentro.nombre,
          zonalNombre: operativo.puntoEncuentro.zonal.nombre,
        }
      : null,
    puntoLibre: operativo.puntoLibre,
    tipoControl: operativo.tipoControl
      ? { id: operativo.tipoControl.id, nombre: operativo.tipoControl.nombre }
      : null,
    tiposControl: operativo.tiposControl.map((fila) => ({
      id: fila.tipo.id,
      nombre: fila.tipo.nombre,
    })),
    tipoLibre: operativo.tipoLibre,
    instituciones: operativo.instituciones.map((fila) => ({
      id: fila.institucion.id,
      sigla: fila.institucion.sigla,
      nombre: fila.institucion.nombre,
    })),
    personal: operativo.personal.map((fila) => ({
      funcionarioId: fila.funcionarioId,
      nombre: `${fila.funcionario.apellidos} ${fila.funcionario.nombres}`,
      area: fila.funcionario.area,
      // RN-34. Del maestro, siempre. Nunca de la petición.
      telefono: fila.funcionario.telefono,
      esResponsable: fila.esResponsable,
      asignadoPorRol: fila.asignadoPorRol,
      // Ventana efectiva: la propia si la tiene, o la del operativo (2026-09-08).
      horaInicio: fila.horaInicio ?? operativo.horaInicio,
      horaFin: fila.horaFin ?? operativo.horaFin,
    })),
    composicion: composicionDe(operativo),
    estadoTransporte: operativo.estadoTransporte,
    alertaActiva: operativo.alertaActiva,
    alertas: (operativo.alertas as Alerta[] | null) ?? [],
    observaciones: operativo.observaciones.map((nota) => ({
      texto: nota.texto,
      creadoPorRol: nota.creadoPorRol,
      creadoEn: nota.creadoEn.toISOString(),
    })),
    creadoPorRol: operativo.creadoPorRol,
    creadoPor: operativo.creadoPor,
    modificadoPorRol: operativo.modificadoPorRol,
    modificadoPor: operativo.modificadoPor,
    version: operativo.version,
    creadoEn: operativo.creadoEn.toISOString(),
  };
}

/** RN-31 y RN-32. Qué áreas le faltan al operativo, sin impedir nada. */
function composicionDe(
  operativo: OperativoCompleto,
): OperativoResponseDto['composicion'] {
  const estado = estadoDeComposicion(
    {
      nombre: operativo.formulario.nombre,
      rolDueno: operativo.formulario.rolDueno,
      roles: operativo.formulario.roles.map((fila) => ({
        rol: fila.rol,
        acceso: fila.acceso,
        cupo: fila.cupo,
      })),
      esPatrulla: operativo.formulario.esPatrulla,
      areas: operativo.formulario.areas.map((fila) => ({
        area: fila.area,
        esCompartida: fila.esCompartida,
      })),
    },
    operativo.personal.map((fila) => ({
      funcionarioId: fila.funcionarioId,
      area: fila.funcionario.area,
      asignadoPorRol: fila.asignadoPorRol,
    })),
  );

  return {
    esPatrulla: estado.esPatrulla,
    completa: estado.completa,
    areasPendientes: estado.areasPendientes,
  };
}
