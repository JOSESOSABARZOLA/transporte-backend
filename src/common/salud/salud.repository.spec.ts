/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Estado del servicio
 * Archivo: salud.repository.spec.ts
 * Responsabilidad: Verificar que la comprobación distingue base caída de base colgada.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-17
 *
 * LOS DOS FALLOS DE UNA BASE NO SE PARECEN, y por eso hay dos pruebas:
 *
 *   · **Caída** · rechaza la conexión y la consulta falla enseguida.
 *   · **Colgada** · acepta la conexión y no contesta nunca. Es el caso peor, porque sin
 *     plazo deja la petición esperando y el punto de salud no responde: quien
 *     diagnostica se queda sin respuesta justo cuando más falta hace.
 */

import { PrismaService } from '../../prisma/prisma.service';
import { SaludRepository } from './salud.repository';

describe('SaludRepository', () => {
  const consultar = jest.fn<Promise<unknown>, []>();
  const prisma = { $queryRaw: consultar } as unknown as PrismaService;
  const repositorio = new SaludRepository(prisma);

  beforeEach(() => {
    consultar.mockReset();
    jest.useRealTimers();
  });

  it('con la base disponible responde que sí', async () => {
    consultar.mockResolvedValue([{ '?column?': 1 }]);
    await expect(repositorio.baseResponde()).resolves.toBe(true);
  });

  it('con la base caída responde que no, sin propagar el error', async () => {
    // El error de conexión trae el host y la cadena de conexión: NO debe escapar de
    // aquí ni convertirse en un 500 con traza. El punto de salud responde «no
    // disponible» y ya.
    consultar.mockRejectedValue(new Error('ECONNREFUSED db.local:5432'));
    await expect(repositorio.baseResponde()).resolves.toBe(false);
  });

  it('con la base colgada responde que no al vencer el plazo, en lugar de esperar', async () => {
    jest.useFakeTimers();
    consultar.mockReturnValue(new Promise(() => {})); // nunca resuelve

    const enCurso = repositorio.baseResponde();
    jest.advanceTimersByTime(2000);

    await expect(enCurso).resolves.toBe(false);
  });
});
