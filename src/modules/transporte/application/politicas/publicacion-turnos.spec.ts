/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · turnos de conductores
 * Archivo: publicacion-turnos.spec.ts
 * Responsabilidad: Verificar que solo un mes publicado alimenta la planificación («publicar habilita»).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 */

import {
  estaPublicado,
  mesDe,
  mesesDelRango,
  soloPublicados,
} from './publicacion-turnos';

const dia = (t: string) => new Date(`${t}T00:00:00.000Z`);

describe('publicar habilita', () => {
  it('PUBLICADO y PUBLICADO_CON_CAMBIOS cuentan; BORRADOR o sin fila, no', () => {
    expect(estaPublicado('PUBLICADO')).toBe(true);
    expect(estaPublicado('PUBLICADO_CON_CAMBIOS')).toBe(true);
    expect(estaPublicado('BORRADOR')).toBe(false);
    expect(estaPublicado(null)).toBe(false);
  });

  it('en BORRADOR el conductor no tiene turno; al publicar, sí', () => {
    const turnos = [
      { conductorId: 1, fecha: dia('2026-10-31'), turno: 'DIA' },
      { conductorId: 1, fecha: dia('2026-11-01'), turno: 'NOCHE' },
    ];
    expect(soloPublicados(turnos, new Set())).toEqual([]);
    expect(soloPublicados(turnos, new Set(['2026-11']))).toEqual([turnos[1]]);
    expect(soloPublicados(turnos, new Set(['2026-10', '2026-11']))).toEqual(
      turnos,
    );
  });

  it('el mes de una fecha @db.Date no se corre por el huso', () => {
    expect(mesDe(dia('2026-11-01'))).toBe('2026-11');
    expect(mesDe(dia('2026-10-31'))).toBe('2026-10');
  });

  it('los meses de un rango, incluidos los intermedios', () => {
    expect(mesesDelRango(dia('2026-10-07'), dia('2026-10-07'))).toEqual([
      '2026-10',
    ]);
    expect(mesesDelRango(dia('2026-10-31'), dia('2026-12-01'))).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
  });
});
