/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos
 * Archivo: notas-operativo.dto.spec.ts
 * Responsabilidad: Fijar las notas de la celda «Observaciones» y quién pidió compartir unidad.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-19
 *
 * Plan «acciones-icono-notas» (N1–N3): cada nota de la bitácora es una NOTA con su autor; la
 * solicitud de compartir unidad es una COMPARTIDA armada de la intención (no una fila de la
 * bitácora). La más reciente primero. `observaciones` no cambia.
 */

import { RolDepartamental } from '@prisma/client';

import { NOMBRE_ROL } from '../../../../common/roles/catalogo-roles';
import { solicitudDeCompartir } from '../../application/operativos.service';
import type { OperativoCompleto } from '../../infrastructure/operativos.repository';
import { notasDelOperativo } from './operativo.dto';

const operativo = (parcial: Partial<OperativoCompleto>): OperativoCompleto =>
  ({
    id: 57,
    creadoPor: 14,
    creadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
    creadoEn: new Date('2026-10-19T14:00:00.000Z'),
    compartirConId: null,
    compartirCon: null,
    compartirSolicitadoPor: null,
    compartirSolicitadoEn: null,
    observaciones: [],
    ...parcial,
  }) as OperativoCompleto;

const nota = (id: number, texto: string, creadoEn: string, creadoPor = 14) => ({
  id,
  operativoId: 57,
  texto,
  creadoPor,
  creadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
  creadoEn: new Date(creadoEn),
});

describe('notasDelOperativo (2026-10-19)', () => {
  it('cada nota de la bitácora es una NOTA con el nombre de su autor, la más reciente primero', () => {
    const notas = notasDelOperativo(
      operativo({
        observaciones: [
          nota(1, 'Pruebas técnicas', '2026-10-19T14:00:00.000Z'),
          nota(2, 'Pruebas técnicas 3', '2026-10-19T15:00:00.000Z'),
        ],
        autores: { 14: 'DE LA GUERRA PORTUGAL LIDER FRANKLIN' },
      }),
    );

    expect(notas).toEqual([
      {
        id: 'nota-2',
        tipo: 'NOTA',
        texto: 'Pruebas técnicas 3',
        autor: 'DE LA GUERRA PORTUGAL LIDER FRANKLIN',
        fecha: '2026-10-19T15:00:00.000Z',
        operativoRelacionadoId: null,
      },
      expect.objectContaining({ id: 'nota-1', tipo: 'NOTA' }),
    ]);
  });

  it('sin el nombre del usuario, el autor es el rol en palabras', () => {
    const [unica] = notasDelOperativo(
      operativo({
        observaciones: [nota(1, 'Sin cuenta', '2026-10-19T14:00:00.000Z', 99)],
      }),
    );

    expect(unica.autor).toBe(NOMBRE_ROL[RolDepartamental.DMIP_OPERATIVOS]);
  });

  it('la solicitud de compartir es una COMPARTIDA con quien la pidió, cuándo y el anfitrión', () => {
    const notas = notasDelOperativo(
      operativo({
        compartirConId: 56,
        compartirCon: { id: 56, identificador: 'OCPMO-001-20-OCT-2026' },
        compartirSolicitadoPor: 15,
        compartirSolicitadoEn: new Date('2026-10-19T16:00:00.000Z'),
        observaciones: [
          nota(1, 'Pruebas técnicas 3', '2026-10-19T15:00:00.000Z'),
        ],
        autores: { 14: 'ANA', 15: 'LUIS' },
      }),
    );

    expect(notas[0]).toEqual({
      id: 'compartida-57',
      tipo: 'COMPARTIDA',
      texto: 'Comparte con OCPMO-001-20-OCT-2026',
      autor: 'LUIS',
      fecha: '2026-10-19T16:00:00.000Z',
      operativoRelacionadoId: 56,
    });
    expect(notas[1]).toEqual(expect.objectContaining({ tipo: 'NOTA' }));
  });

  it('sin solicitante ni fecha guardados, la compartida toma al creador y la fecha del operativo', () => {
    const [compartida] = notasDelOperativo(
      operativo({
        compartirConId: 56,
        compartirCon: { id: 56, identificador: 'OCPMO-001-20-OCT-2026' },
        autores: { 14: 'ANA' },
      }),
    );

    expect(compartida.autor).toBe('ANA');
    expect(compartida.fecha).toBe('2026-10-19T14:00:00.000Z');
  });

  it('a igual fecha, la compartida va delante de la nota', () => {
    const notas = notasDelOperativo(
      operativo({
        compartirConId: 56,
        compartirCon: { id: 56, identificador: 'OCPMO-001-20-OCT-2026' },
        observaciones: [nota(1, 'Mismo minuto', '2026-10-19T14:00:00.000Z')],
      }),
    );

    expect(notas.map((n) => n.tipo)).toEqual(['COMPARTIDA', 'NOTA']);
  });

  it('sin notas ni solicitud, la lista va vacía', () => {
    expect(notasDelOperativo(operativo({}))).toEqual([]);
  });
});

describe('solicitudDeCompartir (2026-10-19)', () => {
  const AHORA = new Date('2026-10-19T17:00:00.000Z');

  it('si la intención no viaja o no cambia, no toca nada', () => {
    expect(
      solicitudDeCompartir({ compartirConId: 56 }, undefined, 14, AHORA),
    ).toBeNull();
    expect(
      solicitudDeCompartir({ compartirConId: 56 }, 56, 14, AHORA),
    ).toBeNull();
    expect(
      solicitudDeCompartir({ compartirConId: null }, null, 14, AHORA),
    ).toBeNull();
  });

  it('al pedirla o cambiar de anfitrión, quien edita y ahora', () => {
    expect(
      solicitudDeCompartir({ compartirConId: null }, 56, 14, AHORA),
    ).toEqual({ compartirSolicitadoPor: 14, compartirSolicitadoEn: AHORA });
    expect(solicitudDeCompartir({ compartirConId: 56 }, 60, 15, AHORA)).toEqual(
      { compartirSolicitadoPor: 15, compartirSolicitadoEn: AHORA },
    );
  });

  it('al retirarla se vacían los dos', () => {
    expect(
      solicitudDeCompartir({ compartirConId: 56 }, null, 14, AHORA),
    ).toEqual({ compartirSolicitadoPor: null, compartirSolicitadoEn: null });
  });
});
