/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Notas del operativo
 * Archivo: notas-operativo.spec.ts
 * Responsabilidad: Fijar la regla única de las notas (orden, COMPARTIDA, autor de respaldo) y el
 *                  recorte de RN-48 de la Jornada.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-19
 */

import { RolDepartamental } from '@prisma/client';

import {
  firmantesDeNotas,
  notasDeOperativo,
  ocultarCompartidaAjena,
  TEXTO_COMPARTIDA_AJENA,
  type OperativoConNotas,
} from './notas-operativo';

const operativo = (
  parcial: Partial<OperativoConNotas> = {},
): OperativoConNotas => ({
  id: 2,
  creadoPor: 14,
  creadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
  creadoEn: new Date('2026-10-20T13:00:00.000Z'),
  compartirSolicitadoPor: null,
  compartirSolicitadoEn: null,
  compartirCon: null,
  observaciones: [],
  ...parcial,
});

const nota = (id: number, iso: string, creadoPor = 14) => ({
  id,
  texto: `Nota ${id}`,
  creadoPor,
  creadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
  creadoEn: new Date(iso),
});

describe('notasDeOperativo', () => {
  it('ordena de la más reciente a la más antigua y nombra al autor', () => {
    const notas = notasDeOperativo(
      operativo({
        observaciones: [
          nota(1, '2026-10-20T13:10:00.000Z'),
          nota(2, '2026-10-20T13:40:00.000Z'),
        ],
      }),
      { 14: 'Persona Autora' },
    );

    expect(notas.map((una) => una.id)).toEqual(['nota-2', 'nota-1']);
    expect(notas[0].autor).toBe('Persona Autora');
    expect(notas[0].operativoRelacionadoId).toBeNull();
  });

  it('sin el autor en el mapa, el rol en palabras', () => {
    const [unica] = notasDeOperativo(
      operativo({ observaciones: [nota(1, '2026-10-20T13:10:00.000Z', 99)] }),
    );
    expect(unica.autor).toBe('DMIP · Unidad de Operativos');
  });

  it('la COMPARTIDA sale de la intención; a igual fecha va delante de la nota', () => {
    const notas = notasDeOperativo(
      operativo({
        compartirCon: { id: 1, identificador: 'OCPMO-001-20-OCT-2026' },
        compartirSolicitadoPor: 15,
        compartirSolicitadoEn: new Date('2026-10-20T13:40:00.000Z'),
        observaciones: [nota(3, '2026-10-20T13:40:00.000Z')],
      }),
      { 14: 'Autora', 15: 'Solicitante' },
    );

    expect(notas.map((una) => [una.tipo, una.texto, una.autor])).toEqual([
      ['COMPARTIDA', 'Comparte con OCPMO-001-20-OCT-2026', 'Solicitante'],
      ['NOTA', 'Nota 3', 'Autora'],
    ]);
    expect(notas[0]).toMatchObject({
      id: 'compartida-2',
      operativoRelacionadoId: 1,
    });
  });

  it('sin fecha ni solicitante, la COMPARTIDA toma la creación y al creador', () => {
    const [compartida] = notasDeOperativo(
      operativo({ compartirCon: { id: 1, identificador: 'OP-001' } }),
      { 14: 'Creador' },
    );
    expect(compartida.fecha).toBe('2026-10-20T13:00:00.000Z');
    expect(compartida.autor).toBe('Creador');
  });

  it('firmantesDeNotas junta a quienes firman, sin repetir', () => {
    expect(
      firmantesDeNotas([
        operativo({
          observaciones: [nota(1, '2026-10-20T13:10:00.000Z', 14)],
          compartirCon: { id: 1, identificador: 'OP-001' },
          compartirSolicitadoPor: 15,
        }),
        operativo({ observaciones: [nota(2, '2026-10-20T13:10:00.000Z', 15)] }),
      ]).sort(),
    ).toEqual([14, 15]);
  });
});

describe('ocultarCompartidaAjena (RN-48)', () => {
  const notas = notasDeOperativo(
    operativo({ compartirCon: { id: 9, identificador: 'IGECU-001' } }),
  );

  it('si el anfitrión no está a la vista, no lo nombra ni enlaza', () => {
    const [compartida] = ocultarCompartidaAjena(notas, new Set([2]));
    expect(compartida.texto).toBe(TEXTO_COMPARTIDA_AJENA);
    expect(compartida.operativoRelacionadoId).toBeNull();
  });

  it('si está a la vista, la deja igual', () => {
    expect(ocultarCompartidaAjena(notas, new Set([2, 9]))).toEqual(notas);
  });
});
