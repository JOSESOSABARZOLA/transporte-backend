/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Manejo de errores
 * Archivo: http-exception.filter.ts
 * Responsabilidad: Devolver el formato uniforme de error sin filtrar detalle interno.
 * Desarrollador: Doris Villavicencio · adaptado por Jose Sosa
 * Fecha: 2026-08-05
 *
 * Formato obligatorio de docs/IMPLEMENTATION_GUIDE.md §11.2:
 *   statusCode · codigo · mensaje · detalles · correlacionId · timestamp · ruta
 *
 * El campo `mensaje` SE MUESTRA TAL CUAL al funcionario. El campo `codigo` va
 * dirigido al desarrollador y permite al frontend reaccionar de forma diferenciada
 * sin interpretar cadenas de texto.
 */

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { ApplicationError } from '../errors/application.error';
import {
  CODIGO_ERROR_INTERNO,
  CODIGO_NO_AUTENTICADO,
  CODIGO_NO_ENCONTRADO,
  CODIGO_VALIDACION,
  CODIGOS_ERROR,
} from '../errors/codigos-error';
import { obtenerContexto } from '../contexto/contexto-peticion';
import { LoggerService } from '../logger/logger.service';
import { marcaDeTiempo } from '../utilidades/marca-tiempo';

const MENSAJE_GENERICO =
  'Ocurrió un error inesperado. Informe a soporte técnico con el identificador de correlación.';

/** A partir de este estado, el fallo es del servidor y su detalle no se devuelve. */
const ESTADO_ERROR_SERVIDOR = 500;

interface RespuestaError {
  statusCode: number;
  codigo: string;
  mensaje: string;
  detalles?: unknown;
  correlacionId?: string;
  timestamp: string;
  ruta: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(excepcion: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const respuesta = ctx.getResponse<Response>();
    const peticion = ctx.getRequest<Request>();

    const cuerpo = this.componer(excepcion, peticion);

    if (cuerpo.statusCode >= ESTADO_ERROR_SERVIDOR) {
      // El detalle interno se registra en el servidor y NUNCA se devuelve: puede
      // traer cadenas de conexión, consultas o rutas del servidor.
      this.logger.error('Error no controlado', {
        ruta: cuerpo.ruta,
        traza: excepcion instanceof Error ? excepcion.stack : String(excepcion),
      });
    }

    respuesta.status(cuerpo.statusCode).json(cuerpo);
  }

  private componer(excepcion: unknown, peticion: Request): RespuestaError {
    const contexto = obtenerContexto();
    const base = {
      correlacionId: contexto?.correlacionId,
      timestamp: marcaDeTiempo(),
      ruta: peticion.originalUrl,
    };

    if (excepcion instanceof ApplicationError) {
      return {
        ...base,
        statusCode: excepcion.statusCode,
        codigo: excepcion.code,
        mensaje: excepcion.message,
        detalles: excepcion.details,
      };
    }

    if (excepcion instanceof HttpException) {
      return { ...base, ...traducirHttpException(excepcion) };
    }

    const deLaBase = traducirErrorPrisma(excepcion);
    if (deLaBase) {
      return { ...base, ...deLaBase };
    }

    return {
      ...base,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      codigo: CODIGO_ERROR_INTERNO,
      mensaje: MENSAJE_GENERICO,
    };
  }
}

/**
 * Traduce los errores de Prisma que corresponden a una situación del usuario y no a
 * una falla del servidor.
 *
 * Sin esta traducción, dos infracciones ordinarias salían como `500` con el mensaje
 * genérico: la del índice único —dos administradores creando el mismo valor de
 * catálogo a la vez— y la del registro inexistente —modificar algo que otro acaba de
 * dar de baja—. Ambas son cosas que el funcionario puede entender y resolver.
 *
 * Se reconocen por su `code`, sin importar `@prisma/client`: el filtro es transversal
 * y no debe depender de la capa de datos.
 */
function traducirErrorPrisma(excepcion: unknown):
  | {
      statusCode: number;
      codigo: string;
      mensaje: string;
    }
  | undefined {
  if (typeof excepcion !== 'object' || excepcion === null) return undefined;

  const codigo = (excepcion as { code?: unknown }).code;

  // P2002 · infracción de restricción única.
  if (codigo === 'P2002') {
    return {
      statusCode: HttpStatus.CONFLICT,
      codigo: CODIGO_VALIDACION,
      mensaje:
        'Ese valor ya está registrado. Actualice la pantalla y compruebe si otra persona acaba de crearlo.',
    };
  }

  // P2025 · el registro sobre el que se iba a operar ya no existe.
  if (codigo === 'P2025') {
    return {
      statusCode: HttpStatus.NOT_FOUND,
      codigo: CODIGO_NO_ENCONTRADO,
      mensaje:
        'El registro que intenta modificar ya no existe. Actualice la pantalla.',
    };
  }

  // P2003 · infracción de clave foránea.
  if (codigo === 'P2003') {
    return {
      statusCode: HttpStatus.CONFLICT,
      codigo: CODIGO_VALIDACION,
      mensaje:
        'El registro está en uso por otra información del cuadro y no se puede modificar así.',
    };
  }

  return undefined;
}

/**
 * Mensajes por omisión de NestJS. Están en inglés y describen el mecanismo, no la
 * situación: nunca deben llegar al funcionario. Cuando aparecen se reemplazan por el
 * texto operativo del módulo.
 */
const MENSAJES_DE_NEST = new Set([
  'Unauthorized',
  'Forbidden resource',
  'Forbidden',
  'Not Found',
  'Internal Server Error',
]);

/** Devuelve el mensaje de la excepción solo si fue escrito para el funcionario. */
function mensajeOperativo(mensajes: string[], respaldo: string): string {
  const primero = mensajes[0];
  return primero && !MENSAJES_DE_NEST.has(primero) ? primero : respaldo;
}

/**
 * Traduce las excepciones de NestJS al formato del módulo.
 *
 * El caso importante es el 400 del ValidationPipe con `forbidNonWhitelisted`: es el
 * que rechaza los campos que la DAF no puede escribir, y debe salir con el código
 * CAMPOS_NO_PERMITIDOS y la lista de campos rechazados. Ver §16.2 de la guía.
 *
 * El mensaje NOMBRA los campos rechazados en lugar de describir el caso de la DAF.
 * `forbidNonWhitelisted` protege a todos los contratos del módulo, no solo al de
 * transporte: un texto fijo sobre conductor y vehículo desorientaba al administrador
 * que edita un parámetro. Detectado al probar M-06.
 */
function traducirHttpException(excepcion: HttpException): {
  statusCode: number;
  codigo: string;
  mensaje: string;
  detalles?: unknown;
} {
  const estado: HttpStatus = excepcion.getStatus();
  const respuesta = excepcion.getResponse();
  const mensajes = extraerMensajes(respuesta);

  if (estado === HttpStatus.BAD_REQUEST) {
    const camposRechazados = mensajes
      .map((mensaje) => /^property (.+) should not exist$/.exec(mensaje)?.[1])
      .filter((campo): campo is string => campo !== undefined);

    if (camposRechazados.length > 0) {
      const enumerados = camposRechazados.join(', ');
      return {
        statusCode: estado,
        codigo: CODIGOS_ERROR.CAMPOS_NO_PERMITIDOS,
        mensaje: `Esta operación no permite modificar ${enumerados}. Retire ${camposRechazados.length === 1 ? 'ese campo' : 'esos campos'} y vuelva a enviar.`,
        detalles: { camposRechazados },
      };
    }

    return {
      statusCode: estado,
      codigo: CODIGO_VALIDACION,
      mensaje: mensajes[0] ?? 'La información enviada no está completa.',
      detalles: mensajes.length > 1 ? { motivos: mensajes } : undefined,
    };
  }

  if (estado === HttpStatus.UNAUTHORIZED) {
    return {
      statusCode: estado,
      codigo: CODIGO_NO_AUTENTICADO,
      mensaje: mensajeOperativo(
        mensajes,
        'No se pudo identificar al usuario de la petición. Vuelva a iniciar sesión.',
      ),
    };
  }

  // PER-05. El 403 sin código propio proviene del RolesGuard, que solo decide si el
  // rol figura entre los autorizados. Los 403 con motivo —formulario ajeno, cupo
  // compartido— viajan como AutorizacionError y no llegan hasta aquí.
  if (estado === HttpStatus.FORBIDDEN) {
    return {
      statusCode: estado,
      codigo: CODIGOS_ERROR.ROL_NO_AUTORIZADO,
      mensaje: mensajeOperativo(
        mensajes,
        'Su rol no tiene permiso para realizar esta operación.',
      ),
    };
  }

  if (estado === HttpStatus.NOT_FOUND) {
    return {
      statusCode: estado,
      codigo: CODIGO_NO_ENCONTRADO,
      mensaje: 'El recurso solicitado no existe.',
    };
  }

  // El estado se compara como número: `HttpStatus` no declara un miembro por cada
  // código posible y el umbral es un rango, no un valor del enumerado.
  const numerico: number = estado;

  return {
    statusCode: estado,
    codigo: CODIGO_ERROR_INTERNO,
    mensaje:
      numerico >= ESTADO_ERROR_SERVIDOR
        ? MENSAJE_GENERICO
        : mensajeOperativo(mensajes, MENSAJE_GENERICO),
  };
}

/** Extrae los mensajes de la respuesta de una HttpException, sea cual sea su forma. */
function extraerMensajes(respuesta: string | object): string[] {
  if (typeof respuesta === 'string') return [respuesta];

  const contenido = (respuesta as { message?: unknown }).message;
  if (typeof contenido === 'string') return [contenido];
  if (Array.isArray(contenido)) {
    return contenido.filter((item): item is string => typeof item === 'string');
  }
  return [];
}
