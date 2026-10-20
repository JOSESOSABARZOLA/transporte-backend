/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Manejo de errores
 * Archivo: http-exception.filter.spec.ts
 * Responsabilidad: Verificar el formato §11.2 y que ningún texto interno o en inglés
 *                  llegue al funcionario.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';

import { ReglaNegocioError } from '../errors/errores-dominio';
import { CODIGOS_ERROR } from '../errors/codigos-error';
import type { LoggerService } from '../logger/logger.service';
import { AllExceptionsFilter } from './http-exception.filter';

interface Capturado {
  statusCode: number;
  codigo: string;
  mensaje: string;
  detalles?: unknown;
  timestamp: string;
  ruta: string;
}

describe('AllExceptionsFilter', () => {
  const atrapar = (excepcion: unknown): Capturado => {
    let cuerpo: Capturado | undefined;

    const json = jest.fn((contenido: Capturado) => {
      cuerpo = contenido;
    });
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ originalUrl: '/api/v1/parametros' }),
      }),
    } as unknown as ArgumentsHost;

    const filtro = new AllExceptionsFilter({
      error: jest.fn(),
    } as unknown as LoggerService);

    filtro.catch(excepcion, host);

    if (!cuerpo) throw new Error('El filtro no respondió.');
    return cuerpo;
  };

  it('conserva el código y el mensaje de los errores del dominio', () => {
    const cuerpo = atrapar(
      new ReglaNegocioError(
        CODIGOS_ERROR.PATRULLA_CONSECUTIVA,
        'BENAVIDES FERNANDO salió en patrulla ayer.',
      ),
    );

    expect(cuerpo.statusCode).toBe(409);
    expect(cuerpo.codigo).toBe(CODIGOS_ERROR.PATRULLA_CONSECUTIVA);
    expect(cuerpo.mensaje).toContain('BENAVIDES');
  });

  it('devuelve siempre los campos del formato §11.2', () => {
    const cuerpo = atrapar(new ForbiddenException());

    expect(Object.keys(cuerpo)).toEqual(
      expect.arrayContaining([
        'statusCode',
        'codigo',
        'mensaje',
        'timestamp',
        'ruta',
      ]),
    );
  });

  describe('traducción de las excepciones de NestJS', () => {
    it('nombra los campos rechazados en lugar de describir el caso de la DAF', () => {
      const cuerpo = atrapar(
        new BadRequestException([
          'property clave should not exist',
          'property tipo should not exist',
        ]),
      );

      expect(cuerpo.statusCode).toBe(400);
      expect(cuerpo.codigo).toBe(CODIGOS_ERROR.CAMPOS_NO_PERMITIDOS);
      expect(cuerpo.mensaje).toContain('clave, tipo');
      expect(cuerpo.detalles).toEqual({ camposRechazados: ['clave', 'tipo'] });
    });

    it('traduce el 403 del RolesGuard: ni ERROR_INTERNO ni «Forbidden resource»', () => {
      const cuerpo = atrapar(new ForbiddenException());

      expect(cuerpo.statusCode).toBe(403);
      expect(cuerpo.codigo).toBe(CODIGOS_ERROR.ROL_NO_AUTORIZADO);
      expect(cuerpo.mensaje).toBe(
        'Su rol no tiene permiso para realizar esta operación.',
      );
    });

    it('respeta el mensaje del 401 cuando la guarda lo escribió en español', () => {
      const cuerpo = atrapar(
        new UnauthorizedException(
          'No se pudo identificar al usuario de la petición.',
        ),
      );

      expect(cuerpo.codigo).toBe('NO_AUTENTICADO');
      expect(cuerpo.mensaje).toBe(
        'No se pudo identificar al usuario de la petición.',
      );
    });

    it('reemplaza el «Unauthorized» por omisión de NestJS', () => {
      expect(atrapar(new UnauthorizedException()).mensaje).toContain(
        'iniciar sesión',
      );
    });

    it('no devuelve el detalle de un fallo del servidor', () => {
      const cuerpo = atrapar(
        new InternalServerErrorException('connect ECONNREFUSED db.local:5432'),
      );

      expect(cuerpo.statusCode).toBe(500);
      expect(cuerpo.mensaje).not.toContain('ECONNREFUSED');
      expect(cuerpo.mensaje).toContain('soporte técnico');
    });

    it('traduce la infracción de unicidad de Prisma a un 409 comprensible', () => {
      const cuerpo = atrapar(
        Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: ['tico_nombre'] },
        }),
      );

      expect(cuerpo.statusCode).toBe(409);
      expect(cuerpo.mensaje).toContain('ya está registrado');
      // El nombre de la columna no se le muestra al funcionario.
      expect(cuerpo.mensaje).not.toContain('tico_nombre');
    });

    it('traduce el registro inexistente de Prisma a un 404', () => {
      const cuerpo = atrapar(
        Object.assign(new Error('Record to update not found'), {
          code: 'P2025',
        }),
      );

      expect(cuerpo.statusCode).toBe(404);
      expect(cuerpo.codigo).toBe('RECURSO_NO_ENCONTRADO');
    });

    it('no devuelve el mensaje de un error no controlado', () => {
      const cuerpo = atrapar(new Error('password=admin host=transportedb'));

      expect(cuerpo.statusCode).toBe(500);
      expect(cuerpo.codigo).toBe('ERROR_INTERNO');
      expect(cuerpo.mensaje).not.toContain('password');
    });
  });
});
