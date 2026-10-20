/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte · traslados entre zonales
 * Archivo: traslados.spec.ts
 * Responsabilidad: Verificar la regla de traslado de los lugares SIN sector (garaje «Matriz», DMQ).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 */

import { describirZonal, esTodoElDistrito } from '../traslados.service';
import { garajeMasCercano, type Garaje } from './guarda-final';
import { minutosTraslado, paresSinTiempo, type Lugar } from './traslados';

const REGLA = { mismaZona: 15, mismoSector: 30, otroSector: 60 };
const NORTE: Lugar = { zonalId: 1, sector: 'NORTE' };
const NORTE_OTRA: Lugar = { zonalId: 2, sector: 'NORTE' };
/** «DMQ»: todo el distrito, una zonal SIN sector. */
const DMQ: Lugar = { zonalId: 11, sector: null };
/** El garaje «Matriz»: lugar conocido sin zonal ni sector. */
const MATRIZ: Lugar = { zonalId: null, sector: null, sinSector: true };

describe('minutosTraslado · lugares sin sector (2026-10-06)', () => {
  it('una zonal sin sector (DMQ) usa la regla de OTRO sector', () => {
    expect(minutosTraslado(NORTE, DMQ, new Map(), REGLA)).toBe(60);
    expect(minutosTraslado(DMQ, NORTE, new Map(), REGLA)).toBe(60);
  });

  it('un garaje sin zonal (Matriz) usa la regla de OTRO sector, no 0', () => {
    expect(minutosTraslado(NORTE, MATRIZ, new Map(), REGLA)).toBe(60);
    expect(minutosTraslado(MATRIZ, NORTE, new Map(), REGLA)).toBe(60);
  });

  it('un lugar DESCONOCIDO (sin marca) sigue sin inventar traslado', () => {
    expect(
      minutosTraslado(NORTE, { zonalId: null, sector: null }, new Map(), REGLA),
    ).toBe(0);
  });

  it('las reglas de siempre no cambian', () => {
    expect(minutosTraslado(NORTE, NORTE, new Map(), REGLA)).toBe(15);
    expect(minutosTraslado(NORTE, NORTE_OTRA, new Map(), REGLA)).toBe(30);
  });

  it('la guarda prefiere el garaje del mismo sector antes que Matriz (sin zonal)', () => {
    const garajes: Garaje[] = [
      { ubicacionId: 1, nombre: 'Matriz', lugar: MATRIZ },
      { ubicacionId: 2, nombre: 'Calderón', lugar: NORTE_OTRA },
    ];
    expect(
      garajeMasCercano(NORTE, garajes, {
        horaTarde: 0,
        tabla: new Map(),
        traslado: REGLA,
      })?.nombre,
    ).toBe('Calderón');
  });
});

describe('describirZonal', () => {
  it('DMQ es todo el distrito y usa la regla de otro sector', () => {
    expect(describirZonal('DMQ', null)).toBe(
      'Todo el distrito de Quito (sin sector: los traslados usan la regla de otro sector)',
    );
  });
  it('otra zonal sin sector lo dice; con sector, nada', () => {
    expect(describirZonal('CAJA DEL SEGURO', null)).toBe('Sin sector asignado');
    expect(describirZonal('Zonal Calderón', 'NORTE')).toBeNull();
  });
});

describe('esTodoElDistrito (2026-10-06)', () => {
  it('solo DMQ sin sector representa todo el distrito', () => {
    expect(esTodoElDistrito('DMQ', null)).toBe(true);
    expect(esTodoElDistrito(' dmq ', null)).toBe(true);
    expect(esTodoElDistrito('DMQ', 'NORTE')).toBe(false);
    expect(esTodoElDistrito('CAJA DEL SEGURO', null)).toBe(false);
  });

  it('la marca esDmq basta aunque se haya renombrado (2026-10-13)', () => {
    expect(esTodoElDistrito('Distrito Metropolitano', null, true)).toBe(true);
    expect(describirZonal('Distrito Metropolitano', null, true)).toBe(
      'Todo el distrito de Quito (sin sector: los traslados usan la regla de otro sector)',
    );
  });
});

describe('paresSinTiempo (G7, 2026-10-15)', () => {
  it('cuenta los pares dirigidos sin fila; ignora el mismo par, repetidos y zonales ajenas', () => {
    expect(
      paresSinTiempo(
        [1, 2, 3],
        [
          { zonalOrigenId: 1, zonalDestinoId: 2 },
          { zonalOrigenId: 1, zonalDestinoId: 2 },
          { zonalOrigenId: 2, zonalDestinoId: 1 },
          { zonalOrigenId: 1, zonalDestinoId: 1 },
          { zonalOrigenId: 1, zonalDestinoId: 9 },
        ],
      ),
    ).toEqual({ posibles: 6, sinTiempo: 4 });
  });

  it('con una sola zonal, o ninguna, no hay pares', () => {
    expect(paresSinTiempo([1], [])).toEqual({ posibles: 0, sinTiempo: 0 });
    expect(paresSinTiempo([], [])).toEqual({ posibles: 0, sinTiempo: 0 });
  });
});
