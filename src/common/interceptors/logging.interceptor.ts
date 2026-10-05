/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Trazabilidad
 * Archivo: logging.interceptor.ts
 * Responsabilidad: Registrar el inicio y el fin de cada petición con su duración.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * NO se registra el cuerpo de la petición. La guía §12.4 prohíbe los cuerpos
 * completos con datos personales: se registra el identificador, nunca el contenido.
 */

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { type Observable, tap } from 'rxjs';

import { LoggerService } from '../logger/logger.service';

/**
 * Devuelve el patrón de la ruta —`/operativos/:id`— en lugar del camino concreto.
 * Agrupa las peticiones por operación y evita registrar identificadores.
 * Express tipa `route` como `any`, de ahí la comprobación explícita.
 */
function patronDeRuta(peticion: Request): string | undefined {
  const ruta: unknown = (peticion as { route?: unknown }).route;
  if (typeof ruta !== 'object' || ruta === null || !('path' in ruta)) {
    return undefined;
  }
  const camino: unknown = (ruta as { path: unknown }).path;
  return typeof camino === 'string' ? camino : undefined;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(
    contexto: ExecutionContext,
    siguiente: CallHandler,
  ): Observable<unknown> {
    const http = contexto.switchToHttp();
    const peticion = http.getRequest<Request>();
    const inicio = Date.now();
    const operacion = `${peticion.method} ${patronDeRuta(peticion) ?? peticion.originalUrl}`;

    return siguiente.handle().pipe(
      tap({
        next: () => {
          const respuesta = http.getResponse<Response>();
          this.logger.log('Petición atendida', {
            operacion,
            estado: respuesta.statusCode,
            duracionMs: Date.now() - inicio,
          });
        },
        error: (error: unknown) => {
          this.logger.warn('Petición rechazada', {
            operacion,
            duracionMs: Date.now() - inicio,
            error: error instanceof Error ? error.name : 'desconocido',
          });
        },
      }),
    );
  }
}
