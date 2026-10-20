/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · horas libres
 * Archivo: huecos-libres.spec.ts
 * Responsabilidad: Verificar la resta de intervalos, el tope de jornada, los traslados y las horas extra.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-14
 */

import type { TramoEvaluado } from './asignacion-conductor.policy';
import { huecosLibres, type EntradaHuecos } from './huecos-libres';
import { franjaDe, institucional } from './linea-de-tiempo';
import { claveTraslado, type Lugar } from './traslados';

const INICIO = '05:00';
const NORTE: Lugar = { zonalId: 1, sector: 'NORTE' };
const SUR: Lugar = { zonalId: 2, sector: 'SUR' };
const CHOCO: Lugar = { zonalId: 9, sector: 'VALLE' };

const tramo = (
  inicio: string,
  fin: string,
  lugar: Lugar = NORTE,
): TramoEvaluado => ({
  franja: franjaDe(inicio, fin, INICIO),
  origen: lugar,
  destino: lugar,
  etiqueta: `${inicio}-${fin}`,
});

const entrada = (cambios: Partial<EntradaHuecos> = {}): EntradaHuecos => ({
  ventana: franjaDe('06:00', '18:00', INICIO),
  ventanaTurno: franjaDe('06:00', '18:00', INICIO),
  ocupados: [],
  amaneceEn: null,
  traslado: { mismaZona: 15, mismoSector: 30, otroSector: 60 },
  tablaTraslados: new Map(),
  minimoMin: 60,
  maxJornadaMin: 14 * 60,
  ...cambios,
});

/** «08H30–15H30» de cada hueco, para leer las pruebas de un vistazo. */
const horarios = (huecos: ReturnType<typeof huecosLibres>): string[] =>
  huecos.map(
    (h) => `${institucional(h.franja.inicio)}–${institucional(h.franja.fin)}`,
  );

describe('huecos libres · resta de intervalos', () => {
  it('un «dejar y retirar» deja libre el intervalo medio', () => {
    const huecos = huecosLibres(
      entrada({ ocupados: [tramo('08:00', '08:30'), tramo('15:30', '16:00')] }),
    );

    expect(horarios(huecos)).toEqual([
      '06H00–08H00',
      '08H30–15H30',
      '16H00–18H00',
    ]);
    const medio = huecos[1];
    expect(medio.brutoMin).toBe(420);
    // Llega de un tramo y tiene que ir a otro: 15 min por lado en el mejor caso.
    expect(medio.utilMinimoMin).toBe(390);
    expect(medio.aprovechableMin).toBeNull();
    expect(medio.horasExtra).toBe(false);
  });

  it('fusiona los tramos que se pisan', () => {
    const huecos = huecosLibres(
      entrada({
        ventana: franjaDe('08:00', '14:00', INICIO),
        ventanaTurno: franjaDe('08:00', '14:00', INICIO),
        ocupados: [tramo('09:00', '11:00'), tramo('10:00', '12:00')],
      }),
    );

    expect(horarios(huecos)).toEqual(['12H00–14H00']);
  });

  it('descarta los huecos que no llegan al mínimo útil', () => {
    const huecos = huecosLibres(
      entrada({ ocupados: [tramo('08:00', '09:00'), tramo('10:00', '11:00')] }),
    );

    // 09H00–10H00 son 60 min brutos, 30 útiles: no llega a 60.
    expect(horarios(huecos)).not.toContain('09H00–10H00');
  });

  it('contempla el cruce de medianoche de la jornada 05H00 → 05H00', () => {
    const huecos = huecosLibres(
      entrada({
        ventana: franjaDe('18:00', '06:00', INICIO),
        ventanaTurno: franjaDe('18:00', '06:00', INICIO),
        ocupados: [tramo('22:00', '23:00'), tramo('02:00', '03:00')],
      }),
    );

    expect(horarios(huecos)).toEqual([
      '18H00–22H00',
      '23H00–02H00',
      '03H00–06H00',
    ]);
  });
});

describe('huecos libres · jornada máxima (D8)', () => {
  it('recorta el hueco de después del último tramo para no pasar del máximo', () => {
    const huecos = huecosLibres(
      entrada({
        ventana: franjaDe('05:00', '05:00', INICIO),
        ventanaTurno: null,
        ocupados: [tramo('07:00', '08:00'), tramo('15:00', '16:00')],
        maxJornadaMin: 12 * 60,
      }),
    );

    // Primer tramo a las 07H00: la jornada no puede pasar de las 19H00.
    expect(horarios(huecos).at(-1)).toBe('16H00–19H00');
    // El de antes del primero no puede empezar antes de 16H00 − 12 h = 04H00 (no recorta: 05H00).
    expect(horarios(huecos)[0]).toBe('05H00–07H00');
  });

  it('los huecos interiores no se recortan aunque la jornada ya sea larga', () => {
    const huecos = huecosLibres(
      entrada({
        ventana: franjaDe('05:00', '05:00', INICIO),
        ventanaTurno: null,
        ocupados: [tramo('06:00', '07:00'), tramo('19:00', '20:00')],
        maxJornadaMin: 12 * 60,
      }),
    );

    expect(horarios(huecos)).toContain('07H00–19H00');
  });
});

describe('huecos libres · traslados y destino', () => {
  it('el aprovechable usa la matriz y los valores por defecto', () => {
    const tabla = new Map([[claveTraslado(1, 9), 90]]);
    const huecos = huecosLibres(
      entrada({
        ocupados: [tramo('08:00', '08:30'), tramo('15:30', '16:00', SUR)],
        tablaTraslados: tabla,
        destino: CHOCO,
      }),
    );

    const medio = huecos.find((h) => h.brutoMin === 420);
    // Norte → Chocó, por la matriz: 90; Chocó → Sur, otro sector: 60.
    expect(medio?.aprovechableMin).toBe(420 - 90 - 60);
    expect(medio?.desde).toEqual(NORTE);
    expect(medio?.hacia).toEqual(SUR);
  });

  it('el primer hueco arranca desde donde amanece el vehículo', () => {
    const huecos = huecosLibres(
      entrada({
        ocupados: [tramo('12:00', '13:00')],
        amaneceEn: SUR,
        destino: NORTE,
      }),
    );

    expect(huecos[0].desde).toEqual(SUR);
    // Sur → Norte (otro sector) 60 + Norte → Norte (misma zonal) 15.
    expect(huecos[0].aprovechableMin).toBe(360 - 60 - 15);
  });
});

describe('huecos libres · turno y disponibilidad (D5, D9)', () => {
  it('fuera de la ventana del turno el hueco se marca horas extra', () => {
    const huecos = huecosLibres(
      entrada({
        ventana: franjaDe('05:00', '05:00', INICIO),
        ventanaTurno: franjaDe('06:00', '18:00', INICIO),
        ocupados: [tramo('10:00', '11:00')],
      }),
    );

    const extra = huecos.filter((h) => h.horasExtra);
    expect(horarios(extra)).toEqual(['05H00–06H00', '18H00–00H00']);
    expect(huecos.some((h) => !h.horasExtra)).toBe(true);
  });

  it('sin turno con horario (libre activado, administrativo, sin mes publicado) todo es horas extra', () => {
    const huecos = huecosLibres(
      entrada({
        ventana: franjaDe('05:00', '05:00', INICIO),
        ventanaTurno: null,
      }),
    );

    expect(huecos.length).toBeGreaterThan(0);
    expect(huecos.every((h) => h.horasExtra)).toBe(true);
  });

  it('sin ventana (libre sin activar, nombramiento en fin de semana) no hay huecos', () => {
    expect(huecosLibres(entrada({ ventana: null }))).toEqual([]);
  });

  it('un vehículo no tiene tope de jornada', () => {
    const huecos = huecosLibres(
      entrada({
        ventana: franjaDe('05:00', '05:00', INICIO),
        ventanaTurno: null,
        ocupados: [tramo('06:00', '07:00')],
        maxJornadaMin: null,
      }),
    );

    expect(horarios(huecos).at(-1)).toBe('07H00–05H00');
  });
});
