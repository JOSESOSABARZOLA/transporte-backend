/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · fin del día
 * Archivo: guarda-final.spec.ts
 * Responsabilidad: Verificar la sugerencia de guarda final, la hoja de ruta y los estados de taller.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 */

import {
  MONTOS_VALE,
  montoValeValido,
  puedeTransitar,
} from './estado-mantenimiento';
import {
  garajeMasCercano,
  sugerirGuarda,
  type Garaje,
  type ParametrosGuarda,
  type VehiculoAlCierre,
} from './guarda-final';
import { ordenarHojaRuta } from './hoja-ruta';
import { minutoDeJornada } from './linea-de-tiempo';

const INICIO = '05:00';
const GARAJES: Garaje[] = [
  {
    ubicacionId: 1,
    nombre: 'Garaje Norte',
    lugar: { zonalId: 1, sector: 'NORTE' },
  },
  {
    ubicacionId: 2,
    nombre: 'Garaje Sur',
    lugar: { zonalId: 4, sector: 'SUR' },
  },
];
const PARAMETROS: ParametrosGuarda = {
  horaTarde: minutoDeJornada('20:00', INICIO),
  tabla: new Map(),
  traslado: { mismaZona: 15, mismoSector: 30, otroSector: 60 },
};

const vehiculo = (
  fin: string,
  cambios: Partial<VehiculoAlCierre> = {},
): VehiculoAlCierre => ({
  vehiculoId: 10,
  placa: 'PMA1234',
  ultimoFin: minutoDeJornada(fin, INICIO),
  ultimoPunto: { zonalId: 1, sector: 'NORTE' },
  conductor: { id: 3, nombre: 'PÉREZ JUAN', sector: 'SUR', actaVigente: false },
  conductorTrabajaManana: false,
  ...cambios,
});

describe('guarda final · puntos 17 y 18', () => {
  it('termina tarde con acta vigente: igual sugiere el garaje más cercano a su último punto (2026-10-08)', () => {
    const g = sugerirGuarda(
      vehiculo('22:00', {
        conductor: {
          id: 3,
          nombre: 'PÉREZ JUAN',
          sector: 'SUR',
          actaVigente: true,
        },
      }),
      GARAJES,
      PARAMETROS,
    );

    expect(g.tipo).toBe('GARAJE');
    expect(g.ubicacionId).toBe(1);
    expect(g.conductorId).toBe(3);
    expect(g.tarde).toBe(true);
    expect(g.motivo).toBe(
      'Garaje autorizado más cercano a su último operativo.',
    );
  });

  it('termina tarde sin acta: el garaje más cercano a su último punto, no a su domicilio', () => {
    const g = sugerirGuarda(vehiculo('22:00'), GARAJES, PARAMETROS);

    expect(g.tipo).toBe('GARAJE');
    expect(g.ubicacionId).toBe(1);
  });

  it('el garaje sugerido sigue a la zona del último operativo', () => {
    const g = sugerirGuarda(
      vehiculo('15:00', { ultimoPunto: { zonalId: 4, sector: 'SUR' } }),
      GARAJES,
      PARAMETROS,
    );

    expect(g.ubicacionId).toBe(2);
    expect(g.ubicacion).toBe('Garaje Sur');
  });

  it('termina temprano: el garaje más cercano a su último punto', () => {
    const g = sugerirGuarda(vehiculo('15:00'), GARAJES, PARAMETROS);

    expect(g.tarde).toBe(false);
    expect(g.ubicacionId).toBe(1);
    expect(g.continuidad).toBe('Mañana lo toma un conductor del sector NORTE.');
  });

  it('un cierre después de medianoche cuenta como tarde', () => {
    expect(sugerirGuarda(vehiculo('01:00'), GARAJES, PARAMETROS).tarde).toBe(
      true,
    );
  });

  it('sin garajes registrados lo dice', () => {
    const g = sugerirGuarda(vehiculo('15:00'), [], PARAMETROS);
    expect(g.ubicacionId).toBeNull();
    expect(garajeMasCercano(null, [], PARAMETROS)).toBeNull();
  });
});

describe('hoja de ruta', () => {
  it('ordena por la línea de tiempo 05H00→05H00 (la madrugada va al final) y numera', () => {
    const filas = ordenarHojaRuta(
      [
        {
          id: 1,
          tipo: 'COMPLETO',
          horaInicio: '01:00',
          horaFin: '02:00',
          identificador: 'IG-3',
          descripcion: null,
          conductor: 'A',
          origen: 'Norte',
          destino: 'Norte',
        },
        {
          id: 2,
          tipo: 'DEJAR',
          horaInicio: '07:00',
          horaFin: '07:30',
          identificador: 'IG-1',
          descripcion: null,
          conductor: 'A',
          origen: 'Sur',
          destino: 'Centro',
        },
        {
          id: 3,
          tipo: 'TAREA',
          horaInicio: '20:00',
          horaFin: '21:00',
          identificador: null,
          descripcion: 'Llevar a taller',
          conductor: 'A',
          origen: null,
          destino: 'Taller',
        },
      ],
      INICIO,
    );

    expect(filas.map((f) => f.id)).toEqual([2, 3, 1]);
    expect(filas.map((f) => f.orden)).toEqual([1, 2, 3]);
  });
});

describe('estado de la cita y vales', () => {
  it('PROGRAMADO → EN_TALLER → LISTO; LISTO es final', () => {
    expect(puedeTransitar('PROGRAMADO', 'EN_TALLER')).toBe(true);
    expect(puedeTransitar('EN_TALLER', 'LISTO')).toBe(true);
    expect(puedeTransitar('EN_TALLER', 'PROGRAMADO')).toBe(true);
    expect(puedeTransitar('LISTO', 'PROGRAMADO')).toBe(false);
    expect(puedeTransitar('LISTO', 'EN_TALLER')).toBe(false);
  });

  it('el vale solo es de $10 o $20', () => {
    expect(MONTOS_VALE).toEqual([10, 20]);
    expect(montoValeValido(10)).toBe(true);
    expect(montoValeValido(20)).toBe(true);
    expect(montoValeValido(15)).toBe(false);
    expect(montoValeValido(0)).toBe(false);
  });
});
