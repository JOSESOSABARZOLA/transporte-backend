/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Parámetros de política
 * Archivo: parametro-politica.service.spec.ts
 * Responsabilidad: Verificar la caché, la validación al guardar y la auditoría
 *                  dentro de la transacción.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import {
  AccionAuditoria,
  TipoParametro,
  type ParametroPolitica,
} from '@prisma/client';

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import type { LoggerService } from '../../../common/logger/logger.service';
import type { ParametroPoliticaRepository } from '../infrastructure/parametro-politica.repository';
import { ParametroPoliticaService } from './parametro-politica.service';

const JORNADA: ParametroPolitica = {
  id: 1,
  clave: 'JORNADA_MAXIMA_HORAS',
  valor: '12',
  tipo: TipoParametro.DECIMAL,
  descripcion: 'Límite de jornada',
  unidad: 'horas',
  minimo: '8',
  maximo: '16',
  modificadoPor: null,
  modificadoEn: new Date(),
} as ParametroPolitica;

const PERIODO: ParametroPolitica = {
  ...JORNADA,
  id: 2,
  clave: 'PERIODO_COMPUTO_SALIDAS',
  valor: 'MENSUAL',
  tipo: TipoParametro.TEXTO,
  unidad: null,
  minimo: null,
  maximo: null,
} as ParametroPolitica;

const CLIENTE_TRANSACCION = { marca: 'transaccion' };

describe('ParametroPoliticaService', () => {
  /**
   * Doble de la base: `actualizarValor` modifica el arreglo, de modo que una lectura
   * posterior solo ve el valor nuevo si la caché se invalidó de verdad.
   */
  const armar = (parametros: ParametroPolitica[] = [JORNADA, PERIODO]) => {
    const filas = [...parametros];

    const listar = jest
      .fn()
      .mockImplementation(() => Promise.resolve([...filas]));
    const buscarPorClave = jest
      .fn()
      .mockImplementation((clave: string) =>
        Promise.resolve(filas.find((fila) => fila.clave === clave) ?? null),
      );
    const actualizarValor = jest
      .fn()
      .mockImplementation((clave: string, valor: string) => {
        const indice = filas.findIndex((fila) => fila.clave === clave);
        filas[indice] = { ...filas[indice], valor };
        return Promise.resolve(filas[indice]);
      });
    const ejecutarEnTransaccion = jest
      .fn()
      .mockImplementation((operacion: (c: unknown) => Promise<unknown>) =>
        operacion(CLIENTE_TRANSACCION),
      );

    const registrar = jest.fn().mockResolvedValue(undefined);
    const log = jest.fn();

    const servicio = new ParametroPoliticaService(
      {
        listar,
        buscarPorClave,
        actualizarValor,
        ejecutarEnTransaccion,
      } as unknown as ParametroPoliticaRepository,
      { registrar } as unknown as AuditoriaService,
      { log } as unknown as LoggerService,
    );

    return { servicio, listar, actualizarValor, registrar };
  };

  describe('caché', () => {
    it('consulta la base una sola vez para varias lecturas', async () => {
      const { servicio, listar } = armar();

      await servicio.obtenerDecimal('JORNADA_MAXIMA_HORAS');
      await servicio.obtenerTexto('PERIODO_COMPUTO_SALIDAS');
      await servicio.obtenerDecimal('JORNADA_MAXIMA_HORAS');

      expect(listar).toHaveBeenCalledTimes(1);
    });

    it('vuelve a la base tras invalidarla', async () => {
      const { servicio, listar } = armar();

      await servicio.obtenerDecimal('JORNADA_MAXIMA_HORAS');
      servicio.invalidarCache();
      await servicio.obtenerDecimal('JORNADA_MAXIMA_HORAS');

      expect(listar).toHaveBeenCalledTimes(2);
    });

    it('la modificación invalida la caché: la siguiente lectura ve el valor nuevo', async () => {
      const { servicio, listar } = armar();

      expect(await servicio.obtenerDecimal('JORNADA_MAXIMA_HORAS')).toBe(12);

      await servicio.actualizar('JORNADA_MAXIMA_HORAS', '8', 6);

      // Caso 5 del plan: sin reiniciar el servicio.
      expect(await servicio.obtenerDecimal('JORNADA_MAXIMA_HORAS')).toBe(8);
      expect(listar).toHaveBeenCalledTimes(2);
    });
  });

  describe('lectura tipada', () => {
    it('devuelve el decimal', async () => {
      const { servicio } = armar();
      expect(await servicio.obtenerDecimal('JORNADA_MAXIMA_HORAS')).toBe(12);
    });

    it('falla si el parámetro no está configurado, en lugar de suponer un valor', async () => {
      const { servicio } = armar();
      await expect(servicio.obtenerTexto('NO_EXISTE')).rejects.toBeInstanceOf(
        ValidacionError,
      );
    });

    it('falla si se pide como entero un valor que no lo es', async () => {
      const { servicio } = armar([{ ...JORNADA, valor: '12.5' }]);
      await expect(
        servicio.obtenerEntero('JORNADA_MAXIMA_HORAS'),
      ).rejects.toBeInstanceOf(ValidacionError);
    });
  });

  describe('modificación', () => {
    it('rechaza un valor fuera de rango, con el límite en el mensaje', async () => {
      const { servicio, actualizarValor } = armar();

      const fallo: unknown = await servicio
        .actualizar('JORNADA_MAXIMA_HORAS', '30', 6)
        .catch((error: unknown) => error);

      expect(fallo).toBeInstanceOf(ValidacionError);
      const rechazo = fallo as ValidacionError;
      expect(rechazo.statusCode).toBe(400);
      // El funcionario debe leer cuál es el límite, no solo que se equivocó.
      expect(rechazo.message).toContain('16');
      expect(actualizarValor).not.toHaveBeenCalled();
    });

    it('rechaza una clave inexistente con 404, no con 400', async () => {
      const { servicio } = armar();
      await expect(
        servicio.actualizar('NO_EXISTE', '1', 6),
      ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
    });

    it('audita el cambio DENTRO de la transacción', async () => {
      const { servicio, registrar } = armar();

      await servicio.actualizar('JORNADA_MAXIMA_HORAS', '10', 6);

      expect(registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          entidad: 't_parametro_politica',
          entidadId: 1,
          accion: AccionAuditoria.ACTUALIZAR,
          usuario: 6,
          cambios: [
            {
              campo: 'para_valor',
              valorAnterior: '12',
              valorNuevo: '10',
            },
          ],
        }),
        CLIENTE_TRANSACCION,
      );
    });

    it('no escribe ni audita si el valor no cambia', async () => {
      const { servicio, actualizarValor, registrar } = armar();

      await servicio.actualizar('JORNADA_MAXIMA_HORAS', '12', 6);

      expect(actualizarValor).not.toHaveBeenCalled();
      expect(registrar).not.toHaveBeenCalled();
    });

    it('recorta los espacios del valor recibido', async () => {
      const { servicio, actualizarValor } = armar();
      await servicio.actualizar('JORNADA_MAXIMA_HORAS', '  10  ', 6);
      expect(actualizarValor).toHaveBeenCalledWith(
        'JORNADA_MAXIMA_HORAS',
        '10',
        6,
        CLIENTE_TRANSACCION,
      );
    });
  });
});
