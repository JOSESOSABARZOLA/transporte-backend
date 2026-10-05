/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Trazabilidad
 * Archivo: correlacion.middleware.spec.ts
 * Responsabilidad: Verificar que el identificador de correlación llega saneado.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import type { NextFunction, Request, Response } from 'express';

import { obtenerContexto } from '../contexto/contexto-peticion';
import {
  CABECERA_CORRELACION,
  correlacionMiddleware,
} from './correlacion.middleware';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('correlacionMiddleware', () => {
  const ejecutar = (cabecera?: string | string[]) => {
    const peticion = {
      headers:
        cabecera === undefined ? {} : { [CABECERA_CORRELACION]: cabecera },
      method: 'GET',
      originalUrl: '/api/v1/zonales',
    } as unknown as Request;

    const setHeader = jest.fn();
    const respuesta = { setHeader } as unknown as Response;

    let dentro: string | undefined;
    const siguiente: NextFunction = () => {
      dentro = obtenerContexto()?.correlacionId;
    };

    correlacionMiddleware(peticion, respuesta, siguiente);

    return { setHeader, correlacionId: dentro };
  };

  it('conserva el identificador que envía el frontend', () => {
    const enviado = 'b7c1b1f0-0f2a-4a1e-9c4a-2f0d4f6b8a11';
    const { correlacionId, setHeader } = ejecutar(enviado);

    expect(correlacionId).toBe(enviado);
    expect(setHeader).toHaveBeenCalledWith(CABECERA_CORRELACION, enviado);
  });

  it('genera uno cuando la petición no lo trae', () => {
    const { correlacionId } = ejecutar();
    expect(correlacionId).toMatch(UUID);
  });

  describe('cabeceras que no se admiten tal cual', () => {
    it('descarta la que excede los 60 caracteres de audi_correlacion', () => {
      const { correlacionId } = ejecutar('a'.repeat(200));
      expect(correlacionId).toMatch(UUID);
    });

    it('descarta la que trae caracteres de control, que romperían la respuesta', () => {
      const { correlacionId } = ejecutar('abc\r\nSet-Cookie: x=1');
      expect(correlacionId).toMatch(UUID);
    });

    it('descarta la que trae espacios o caracteres fuera del alfabeto', () => {
      expect(ejecutar('id con espacios').correlacionId).toMatch(UUID);
      expect(ejecutar('<script>alert(1)</script>').correlacionId).toMatch(UUID);
    });

    it('descarta la demasiado corta para ser un identificador', () => {
      expect(ejecutar('abc').correlacionId).toMatch(UUID);
    });

    it('toma el primer valor cuando la cabecera llega repetida', () => {
      const primero = 'b7c1b1f0-0f2a-4a1e-9c4a-2f0d4f6b8a11';
      expect(ejecutar([primero, 'otro']).correlacionId).toBe(primero);
    });
  });

  it('devuelve siempre el identificador en la respuesta', () => {
    const { setHeader, correlacionId } = ejecutar();
    expect(setHeader).toHaveBeenCalledWith(CABECERA_CORRELACION, correlacionId);
  });
});
