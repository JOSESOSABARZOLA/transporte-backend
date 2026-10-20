/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ventanas de carga
 * Archivo: mensaje-ventana.spec.ts
 * Responsabilidad: Fijar la resolución de marcadores y la detección de horas fijas.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 *
 * La copia del frontend (`utils/mensajeVentana.util.spec.ts`) repite estos mismos casos.
 */

import {
  detectarHoraInconsistente,
  resolverMensajeVentana,
} from './mensaje-ventana';

describe('resolverMensajeVentana', () => {
  it('reemplaza {cierre} y {apertura} por las horas en formato 19H25', () => {
    expect(
      resolverMensajeVentana(
        'Se carga de {apertura} a {cierre}.',
        '07:00',
        '19:25',
      ),
    ).toBe('Se carga de 07H00 a 19H25.');
  });

  it('sin marcadores devuelve el mensaje tal cual', () => {
    expect(
      resolverMensajeVentana('La ventana está cerrada.', null, '19:25'),
    ).toBe('La ventana está cerrada.');
  });

  it('sin apertura, {apertura} es 00H00', () => {
    expect(
      resolverMensajeVentana('Abre a las {apertura}.', null, '19:25'),
    ).toBe('Abre a las 00H00.');
  });

  it('reemplaza todas las apariciones', () => {
    expect(resolverMensajeVentana('{cierre} · {cierre}', null, '16:30')).toBe(
      '16H30 · 16H30',
    );
  });
});

describe('detectarHoraInconsistente', () => {
  it('18H25 frente a un cierre a las 19:25 es inconsistente', () => {
    expect(
      detectarHoraInconsistente('Cerró a las 18H25.', null, '19:25'),
    ).toEqual({ texto: '18H25', hora: '18:25' });
  });

  it('19H25 frente a un cierre a las 19:25 está bien', () => {
    expect(
      detectarHoraInconsistente('Cerró a las 19H25.', null, '19:25'),
    ).toBeNull();
  });

  it('también detecta el formato 18:25', () => {
    expect(
      detectarHoraInconsistente('Cerró a las 18:25.', null, '19:25'),
    ).toEqual({ texto: '18:25', hora: '18:25' });
  });

  it('una hora que coincide con la apertura no es inconsistente', () => {
    expect(
      detectarHoraInconsistente('Abre a las 7H00.', '07:00', '16:30'),
    ).toBeNull();
  });

  it('los marcadores no cuentan como hora fija', () => {
    expect(
      detectarHoraInconsistente('Cerró a las {cierre}.', null, '19:25'),
    ).toBeNull();
  });
});
