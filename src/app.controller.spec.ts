/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Estado del servicio
 * Archivo: app.controller.spec.ts
 * Responsabilidad: Verificar que el punto de comprobación distingue sano de degradado.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-04 · estado degradado agregado el 2026-08-17
 *
 * LO QUE IMPORTA AQUÍ ES EL CÓDIGO DE ESTADO, no el cuerpo. El `healthcheck` de
 * `docker-compose.yml` solo mira eso: mientras devolvió 200 con la base caída,
 * `transporte-app` figuraba «healthy» y el frontend arrancaba contra un backend que no
 * podía servir nada. La prueba del 503 es la que evita que eso vuelva.
 */

import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SaludRepository } from './common/salud/salud.repository';

describe('AppController', () => {
  let controlador: AppController;
  const baseResponde = jest.fn<Promise<boolean>, []>();

  /** Doble mínimo de la respuesta: solo se usa para fijar el código de estado. */
  const respuestaCon = (): { respuesta: Response; estado: jest.Mock } => {
    const estado = jest.fn();
    return { respuesta: { status: estado } as unknown as Response, estado };
  };

  beforeEach(async () => {
    baseResponde.mockReset();

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: SaludRepository, useValue: { baseResponde } },
      ],
    }).compile();

    controlador = app.get<AppController>(AppController);
  });

  describe('estado', () => {
    it('con la base disponible responde 200 y se declara operativo', async () => {
      baseResponde.mockResolvedValue(true);
      const { respuesta, estado } = respuestaCon();

      expect(await controlador.obtenerEstado(respuesta)).toEqual({
        servicio: 'transporte-backend',
        estado: 'operativo',
        baseDatos: 'disponible',
      });
      expect(estado).toHaveBeenCalledWith(HttpStatus.OK);
    });

    it('con la base caída responde 503, para que el contenedor se declare enfermo', async () => {
      baseResponde.mockResolvedValue(false);
      const { respuesta, estado } = respuestaCon();

      expect(await controlador.obtenerEstado(respuesta)).toEqual({
        servicio: 'transporte-backend',
        estado: 'degradado',
        baseDatos: 'no disponible',
      });
      expect(estado).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    });

    /**
     * El cuerpo lo lee quien diagnostica, no el funcionario, pero tampoco debe filtrar
     * interioridades: ni cadena de conexión, ni host, ni traza.
     */
    it('el cuerpo no revela nada del servidor', async () => {
      baseResponde.mockResolvedValue(false);
      const { respuesta } = respuestaCon();

      const cuerpo = JSON.stringify(await controlador.obtenerEstado(respuesta));
      for (const filtracion of ['postgres', 'localhost', '5432', 'password']) {
        expect(cuerpo).not.toContain(filtracion);
      }
    });
  });
});
