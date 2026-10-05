/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Trazabilidad
 * Archivo: marca-tiempo.spec.ts
 * Responsabilidad: Verificar que la marca de tiempo lleva el desfase de la zona
 *                  institucional y no la del proceso.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import { marcaDeTiempo } from './marca-tiempo';

describe('marcaDeTiempo', () => {
  const instante = new Date('2026-08-05T14:14:22.000Z');

  it('devuelve el formato ISO 8601 con desfase, no en UTC', () => {
    const resultado = marcaDeTiempo(instante, 'America/Guayaquil');
    expect(resultado).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/,
    );
  });

  it('aplica el desfase de Guayaquil, que son cinco horas menos que UTC', () => {
    const resultado = marcaDeTiempo(instante, 'America/Guayaquil');
    expect(resultado).toBe('2026-08-05T09:14:22.000-05:00');
  });

  it('no depende de la zona horaria del proceso', () => {
    // La misma instancia formateada en dos zonas distintas debe diferir.
    const guayaquil = marcaDeTiempo(instante, 'America/Guayaquil');
    const madrid = marcaDeTiempo(instante, 'Europe/Madrid');
    expect(guayaquil).not.toBe(madrid);
    expect(madrid).toBe('2026-08-05T16:14:22.000+02:00');
  });

  it('usa Z cuando la zona coincide con UTC', () => {
    expect(marcaDeTiempo(instante, 'UTC')).toBe('2026-08-05T14:14:22.000Z');
  });
});
