/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: ventana-carga.guard.spec.ts
 * Responsabilidad: Verificar que el 423 de la guarda lleva el horario CALCULADO, no el texto libre.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 */

import type { ExecutionContext } from '@nestjs/common';
import type { VentanaCarga } from '@prisma/client';

import { VentanaCerradaError } from '../../errors/errores-dominio';
import type { VentanaCargaEvaluador } from '../application/ventana-carga.evaluador';
import type { VentanaCargaRepository } from '../infrastructure/ventana-carga.repository';
import { VentanaCargaGuard } from './ventana-carga.guard';

const fila = (
  rol: string,
  horaApertura: string | null,
  horaCierre: string | null,
  mensajeCierre: string,
): VentanaCarga =>
  ({
    id: 1,
    rol,
    tipo: 'DIARIO',
    diaApertura: null,
    horaApertura,
    diaCierre: null,
    horaCierre,
    zonaHoraria: 'America/Guayaquil',
    mensajeCierre,
    activo: true,
  }) as VentanaCarga;

const VIEJO =
  'La ventana de asignación de transporte va de 15H00 a 16H30. Fuera de ese intervalo no se puede asignar.';
const DAF = fila('DAF', '18:25', '18:28', VIEJO);
const TODAS = [
  fila('DMIP_OPERATIVOS', null, '18:25', 'cerró a las 15H00'),
  fila('DMIP_INSPECCIONES', null, '18:25', 'cerró a las 15H00'),
  fila('DMIT_INSTRUCTOR', null, '18:25', 'cerró a las 15H00'),
  DAF,
];

const contexto = (metodo: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        method: metodo,
        user: { rol: 'DAF', roles: ['DAF'] },
      }),
    }),
  }) as unknown as ExecutionContext;

const armar = (puedeEscribir: boolean) =>
  new VentanaCargaGuard(
    {
      buscarPorRol: jest.fn().mockResolvedValue(DAF),
      listar: jest.fn().mockResolvedValue(TODAS),
    } as unknown as VentanaCargaRepository,
    {
      evaluar: jest.fn().mockReturnValue({
        puedeEscribir,
        horaCierre: '18:28',
        horaApertura: '18:25',
      }),
    } as unknown as VentanaCargaEvaluador,
  );

describe('VentanaCargaGuard · 423 con el horario calculado (2026-10-06)', () => {
  it('cerrada: el mensaje sale de las horas reales y nunca del texto libre viejo', async () => {
    const guarda = armar(false);
    const intento = guarda.canActivate(contexto('POST'));

    await expect(intento).rejects.toBeInstanceOf(VentanaCerradaError);
    const error = (await intento.catch(
      (e: unknown) => e,
    )) as VentanaCerradaError;
    expect(error.message).toContain('18H25');
    expect(error.message).toContain('cuando cierra el registro de operativos');
    expect(error.message).not.toContain('15H00');
    expect(error.details).toMatchObject({
      horarioTexto:
        'La ventana de asignación de transporte abre a las 18H25, cuando cierra el registro de operativos, y cierra a las 18H28.',
      notaAdministrador: VIEJO,
    });
  });

  it('abierta o lectura: deja pasar', async () => {
    await expect(armar(true).canActivate(contexto('POST'))).resolves.toBe(true);
    await expect(armar(false).canActivate(contexto('GET'))).resolves.toBe(true);
  });
});

/** 2026-10-07: el mensaje del administrador, con sus marcadores resueltos. */
describe('VentanaCargaGuard · mensaje con marcadores (2026-10-07)', () => {
  const conMarcadores = fila(
    'DAF',
    '18:25',
    '18:28',
    'La asignación va de {apertura} a {cierre}. Fuera de ese intervalo no se asigna.',
  );
  const guarda = (finDeSemana = false) =>
    new VentanaCargaGuard(
      {
        buscarPorRol: jest.fn().mockResolvedValue(conMarcadores),
        listar: jest
          .fn()
          .mockResolvedValue([...TODAS.slice(0, 3), conMarcadores]),
      } as unknown as VentanaCargaRepository,
      {
        evaluar: jest
          .fn()
          .mockReturnValue({ puedeEscribir: false, finDeSemana }),
      } as unknown as VentanaCargaEvaluador,
    );

  it('el 423 muestra el mensaje con las horas reales en lugar de los marcadores', async () => {
    const error = (await guarda()
      .canActivate(contexto('POST'))
      .catch((e: unknown) => e)) as VentanaCerradaError;
    expect(error.message).toBe(
      'La asignación va de 18H25 a 18H28. Fuera de ese intervalo no se asigna.',
    );
  });

  it('el fin de semana de una LABORABLE lo dice', async () => {
    const error = (await guarda(true)
      .canActivate(contexto('POST'))
      .catch((e: unknown) => e)) as VentanaCerradaError;
    expect(error.message).toContain('solo abre de lunes a viernes');
  });
});
