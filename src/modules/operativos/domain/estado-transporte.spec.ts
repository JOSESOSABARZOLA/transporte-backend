/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Objetos de valor del dominio
 * Archivo: estado-transporte.spec.ts
 * Responsabilidad: Verificar los tres estados, sus transiciones y la alerta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import { ValidacionError } from '../../../common/errors/errores-dominio';
import { EstadoTransporte } from './estado-transporte';

describe('EstadoTransporte · estado inicial', () => {
  it('RN-40 · todo operativo nace pendiente, con la alerta activa', () => {
    const inicial = EstadoTransporte.inicial();

    expect(inicial.valor).toBe('PENDIENTE');
    expect(inicial.requiereAtencion).toBe(true);
    expect(inicial.admiteConductor).toBe(false);
  });
});

describe('EstadoTransporte · transiciones', () => {
  it('la DAF asigna conductor y vehículo', () => {
    const asignado = EstadoTransporte.inicial().transitarA('ASIGNADO');

    expect(asignado.valor).toBe('ASIGNADO');
    expect(asignado.admiteConductor).toBe(true);
  });

  it('RN-41 y RN-42 · la DAF determina que va por propios medios', () => {
    const propios = EstadoTransporte.inicial().transitarA('PROPIOS_MEDIOS');

    expect(propios.valor).toBe('PROPIOS_MEDIOS');
    expect(propios.admiteConductor).toBe(false);
  });

  it('caso 11 del plan · de ASIGNADO a PENDIENTE se rechaza', () => {
    const asignado = EstadoTransporte.de('ASIGNADO');

    expect(asignado.puedeTransitarA('PENDIENTE')).toBe(false);
    expect(() => asignado.transitarA('PENDIENTE')).toThrow(ValidacionError);
  });

  it('de PROPIOS_MEDIOS a PENDIENTE también se rechaza', () => {
    expect(() =>
      EstadoTransporte.de('PROPIOS_MEDIOS').transitarA('PENDIENTE'),
    ).toThrow(ValidacionError);
  });

  it('la DAF puede corregirse entre las dos formas de haber decidido', () => {
    expect(
      EstadoTransporte.de('ASIGNADO').transitarA('PROPIOS_MEDIOS').valor,
    ).toBe('PROPIOS_MEDIOS');
    expect(
      EstadoTransporte.de('PROPIOS_MEDIOS').transitarA('ASIGNADO').valor,
    ).toBe('ASIGNADO');
  });

  it('permanecer en el mismo estado no es una transición', () => {
    for (const valor of ['PENDIENTE', 'ASIGNADO', 'PROPIOS_MEDIOS'] as const) {
      expect(EstadoTransporte.de(valor).transitarA(valor).valor).toBe(valor);
    }
  });

  it('el mensaje del rechazo explica qué hacer, no solo que no se puede', () => {
    try {
      EstadoTransporte.de('ASIGNADO').transitarA('PENDIENTE');
      fail('debió rechazarlo');
    } catch (error) {
      expect((error as ValidacionError).message).toContain('corríjala');
    }
  });
});

describe('EstadoTransporte · alerta derivada (RN-52 a RN-55)', () => {
  it('la alerta existe si y solo si el estado es PENDIENTE', () => {
    expect(EstadoTransporte.de('PENDIENTE').requiereAtencion).toBe(true);
    expect(EstadoTransporte.de('ASIGNADO').requiereAtencion).toBe(false);
    expect(EstadoTransporte.de('PROPIOS_MEDIOS').requiereAtencion).toBe(false);
  });

  it('RN-55 · la alerta se retira sola al completar la asignación', () => {
    const inicial = EstadoTransporte.inicial();
    expect(inicial.requiereAtencion).toBe(true);

    expect(inicial.transitarA('ASIGNADO').requiereAtencion).toBe(false);
  });

  it('el estado anterior no cambia: el objeto es inmutable', () => {
    const inicial = EstadoTransporte.inicial();
    inicial.transitarA('ASIGNADO');

    expect(inicial.valor).toBe('PENDIENTE');
  });
});

describe('EstadoTransporte · construcción desde texto', () => {
  it('admite los tres valores del enumerado de la base', () => {
    for (const valor of ['PENDIENTE', 'ASIGNADO', 'PROPIOS_MEDIOS']) {
      expect(EstadoTransporte.de(valor).valor).toBe(valor);
    }
  });

  it('rechaza cualquier otro, enumerando los admitidos', () => {
    try {
      EstadoTransporte.de('EN_CAMINO');
      fail('debió rechazarlo');
    } catch (error) {
      expect((error as ValidacionError).message).toContain('PROPIOS_MEDIOS');
    }
  });

  it('compara por valor', () => {
    expect(
      EstadoTransporte.de('ASIGNADO').equivaleA(
        EstadoTransporte.de('ASIGNADO'),
      ),
    ).toBe(true);
  });
});
