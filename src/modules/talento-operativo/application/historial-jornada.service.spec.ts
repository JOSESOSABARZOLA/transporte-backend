/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Historial de jornada
 * Archivo: historial-jornada.service.spec.ts
 * Responsabilidad: Verificar la consolidación idempotente y las consultas de M-12.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import type { HistorialJornada } from '@prisma/client';

import type { LoggerService } from '../../../common/logger/logger.service';
import type { HistorialJornadaRepository } from '../infrastructure/historial-jornada.repository';
import { HistorialJornadaService } from './historial-jornada.service';
import type { AporteOperativo } from './reglas-historial';
import { aFechaUtc } from './reglas-personal';

const CLIENTE = { marca: 'transaccion' };
const dia = (texto: string): Date => aFechaUtc(texto) as Date;

const aporte = (parcial: Partial<AporteOperativo> = {}): AporteOperativo => ({
  funcionarioId: 1,
  horas: 8,
  esPatrulla: false,
  esNocturno: false,
  ...parcial,
});

const fila = (parcial: Partial<HistorialJornada> = {}): HistorialJornada =>
  ({
    id: 1,
    funcionarioId: 1,
    fecha: dia('2026-08-05'),
    fuePatrulla: false,
    fueNocturna: false,
    fueFinSemana: false,
    horasJornada: 8,
    operativos: 1,
    consolidadoEn: new Date(),
    ...parcial,
  }) as unknown as HistorialJornada;

const armar = (
  opciones: {
    aportes?: AporteOperativo[];
    ultimaPatrulla?: HistorialJornada | null;
    salidas?: number;
    delDia?: HistorialJornada | null;
    filas?: HistorialJornada[];
  } = {},
) => {
  const {
    aportes = [],
    ultimaPatrulla = null,
    salidas = 0,
    delDia = null,
    filas = [],
  } = opciones;

  const guardar = jest.fn().mockResolvedValue(undefined);
  const retirarAusentes = jest.fn().mockResolvedValue(0);
  const log = jest.fn();

  const servicio = new HistorialJornadaService(
    {
      aportesDeLaJornada: jest.fn().mockResolvedValue(aportes),
      guardar,
      retirarAusentes,
      ultimaPatrulla: jest.fn().mockResolvedValue(ultimaPatrulla),
      contarSalidasPesadas: jest.fn().mockResolvedValue(salidas),
      buscarDelDia: jest.fn().mockResolvedValue(delDia),
      listarDeFecha: jest.fn().mockResolvedValue(filas),
      ejecutarEnTransaccion: jest
        .fn()
        .mockImplementation((operacion: (c: unknown) => Promise<unknown>) =>
          operacion(CLIENTE),
        ),
    } as unknown as HistorialJornadaRepository,
    { log } as unknown as LoggerService,
  );

  return { servicio, guardar, retirarAusentes, log };
};

describe('HistorialJornadaService · consolidación', () => {
  it('guarda una fila por persona, dentro de la transacción', async () => {
    const { servicio, guardar } = armar({
      aportes: [
        aporte({ funcionarioId: 1, horas: 4 }),
        aporte({ funcionarioId: 1, horas: 4 }),
        aporte({ funcionarioId: 2, horas: 6 }),
      ],
    });

    const resultado = await servicio.consolidarJornada(dia('2026-08-05'));

    expect(resultado.personas).toBe(2);
    expect(resultado.operativos).toBe(3);
    expect(guardar).toHaveBeenCalledTimes(2);
    expect(guardar).toHaveBeenCalledWith(
      dia('2026-08-05'),
      expect.objectContaining({ funcionarioId: 1, horasJornada: 8 }),
      CLIENTE,
    );
  });

  it('caso 4 del plan · volver a consolidar la misma fecha no duplica', async () => {
    // El repositorio hace `upsert` por persona y fecha; el servicio no lleva cuenta de
    // si es la primera vez ni necesita saberlo.
    const { servicio, guardar } = armar({ aportes: [aporte()] });

    await servicio.consolidarJornada(dia('2026-08-05'));
    await servicio.consolidarJornada(dia('2026-08-05'));

    expect(guardar).toHaveBeenCalledTimes(2);
    for (const llamada of guardar.mock.calls) {
      const [, jornada] = llamada as [Date, unknown];
      expect(jornada).toMatchObject({ funcionarioId: 1, operativos: 1 });
    }
  });

  it('retira de esa fecha a quien ya no figura en el cuadro', async () => {
    const { servicio, retirarAusentes } = armar({
      aportes: [aporte({ funcionarioId: 3 })],
    });

    await servicio.consolidarJornada(dia('2026-08-05'));

    expect(retirarAusentes).toHaveBeenCalledWith(
      dia('2026-08-05'),
      [3],
      CLIENTE,
    );
  });

  it('una jornada sin operativos limpia la fecha entera', async () => {
    const { servicio, guardar, retirarAusentes } = armar({ aportes: [] });

    const resultado = await servicio.consolidarJornada(dia('2026-08-05'));

    expect(resultado.personas).toBe(0);
    expect(guardar).not.toHaveBeenCalled();
    expect(retirarAusentes).toHaveBeenCalledWith(
      dia('2026-08-05'),
      [],
      CLIENTE,
    );
  });

  it('deja constancia en el registro, sin datos personales', async () => {
    const { servicio, log } = armar({ aportes: [aporte()] });

    await servicio.consolidarJornada(dia('2026-08-05'));

    const [mensaje, datos] = log.mock.calls[0] as [string, unknown];
    expect(mensaje).toContain('consolidado');
    expect(JSON.stringify(datos)).not.toContain('cedula');
  });
});

describe('HistorialJornadaService · consultas de las políticas', () => {
  it('RN-24 · devuelve la fecha de la última patrulla', async () => {
    const { servicio } = armar({
      ultimaPatrulla: fila({ fecha: dia('2026-08-04'), fuePatrulla: true }),
    });

    expect(await servicio.obtenerUltimaPatrulla(1)).toEqual(dia('2026-08-04'));
  });

  it('RN-24 · null si la persona nunca salió en patrulla', async () => {
    const { servicio } = armar();
    expect(await servicio.obtenerUltimaPatrulla(1)).toBeNull();
  });

  it('RN-25 · cuenta las salidas pesadas del período', async () => {
    const { servicio } = armar({ salidas: 3 });

    expect(
      await servicio.contarSalidasPesadas(1, {
        desde: dia('2026-08-01'),
        hasta: dia('2026-08-31'),
      }),
    ).toBe(3);
  });

  it('RN-36 · devuelve las horas ya comprometidas del día', async () => {
    const { servicio } = armar({ delDia: fila({ horasJornada: 6.5 }) });

    expect(await servicio.obtenerHorasDelDia(1, dia('2026-08-05'))).toBe(6.5);
  });

  it('RN-36 · sin historial devuelve cero, que es exacto y no una suposición', async () => {
    const { servicio } = armar({ delDia: null });

    expect(await servicio.obtenerHorasDelDia(1, dia('2026-08-05'))).toBe(0);
  });

  it('convierte el decimal de la base a número', async () => {
    // Prisma devuelve `Decimal`; las políticas comparan con números.
    const { servicio } = armar({
      filas: [fila({ horasJornada: 8.5 as unknown as never })],
    });

    const [jornada] = await servicio.obtenerJornadaDe(dia('2026-08-05'));
    expect(typeof jornada.horasJornada).toBe('number');
    expect(jornada.horasJornada).toBe(8.5);
  });
});
