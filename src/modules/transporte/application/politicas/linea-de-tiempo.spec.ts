/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · línea de tiempo por conductor
 * Archivo: linea-de-tiempo.spec.ts
 * Responsabilidad: Verificar el paso de la escala interna a la escala de la línea (desde el inicio de la jornada).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 */

import { aEscalaDeLinea, franjaDe } from './linea-de-tiempo';

const INICIO = '05:00';
const enLinea = (desde: string, hasta: string) =>
  aEscalaDeLinea(franjaDe(desde, hasta, INICIO), INICIO);

describe('aEscalaDeLinea', () => {
  it('turno DIA 06:00–17:00 con inicio 05:00 → {60,720}', () => {
    expect(enLinea('06:00', '17:00')).toEqual({ inicio: 60, fin: 720 });
  });

  it('tramo que cruza la medianoche 22:00–01:00 → {1020,1200}', () => {
    expect(enLinea('22:00', '01:00')).toEqual({ inicio: 1020, fin: 1200 });
  });

  it('nombramiento 08:00–16:30 → {180,690}', () => {
    expect(enLinea('08:00', '16:30')).toEqual({ inicio: 180, fin: 690 });
  });

  it('turno DIA 06:00–18:00 → {60,780} (el valor vigente en desarrollo)', () => {
    expect(enLinea('06:00', '18:00')).toEqual({ inicio: 60, fin: 780 });
  });

  it('una hora anterior al inicio cae al final de la línea (02:00–04:00 → {1260,1380})', () => {
    expect(enLinea('02:00', '04:00')).toEqual({ inicio: 1260, fin: 1380 });
  });
});
