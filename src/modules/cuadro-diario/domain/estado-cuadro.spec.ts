/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Cuadro diario
 * Archivo: estado-cuadro.spec.ts
 * Responsabilidad: Verificar INV-03 y RN-58.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import { EstadoCuadro } from '@prisma/client';

import {
  admiteEscritura,
  ESTADO_TRAS_REAPERTURA,
  puedeAvanzarA,
  puedeReabrirse,
  siguienteEstado,
} from './estado-cuadro';

describe('INV-03 · el avance de estados', () => {
  it('cada estado lleva al siguiente', () => {
    expect(siguienteEstado(EstadoCuadro.BORRADOR)).toBe(
      EstadoCuadro.EN_TRANSPORTE,
    );
    expect(siguienteEstado(EstadoCuadro.EN_TRANSPORTE)).toBe(
      EstadoCuadro.APROBADO,
    );
    expect(siguienteEstado(EstadoCuadro.APROBADO)).toBe(EstadoCuadro.CERRADO);
  });

  it('el cierre es el último: no lleva a ninguna parte', () => {
    expect(siguienteEstado(EstadoCuadro.CERRADO)).toBeUndefined();
  });

  it('caso 4 del plan · de BORRADOR a CERRADO directamente se rechaza', () => {
    expect(puedeAvanzarA(EstadoCuadro.BORRADOR, EstadoCuadro.CERRADO)).toBe(
      false,
    );
  });

  it('tampoco se puede saltar de BORRADOR a APROBADO', () => {
    expect(puedeAvanzarA(EstadoCuadro.BORRADOR, EstadoCuadro.APROBADO)).toBe(
      false,
    );
  });

  it('no se puede retroceder', () => {
    expect(
      puedeAvanzarA(EstadoCuadro.EN_TRANSPORTE, EstadoCuadro.BORRADOR),
    ).toBe(false);
    expect(puedeAvanzarA(EstadoCuadro.APROBADO, EstadoCuadro.BORRADOR)).toBe(
      false,
    );
  });

  it('quedarse en el mismo estado no es avanzar', () => {
    for (const estado of Object.values(EstadoCuadro)) {
      expect(puedeAvanzarA(estado, estado)).toBe(false);
    }
  });

  it('solo hay tres avances admitidos en total', () => {
    const estados = Object.values(EstadoCuadro);
    const admitidos = estados.flatMap((desde) =>
      estados.filter((hacia) => puedeAvanzarA(desde, hacia)),
    );

    expect(admitidos).toHaveLength(3);
  });
});

describe('RN-58 · el cuadro cerrado no admite modificaciones', () => {
  it('los tres estados anteriores sí admiten escritura', () => {
    expect(admiteEscritura(EstadoCuadro.BORRADOR)).toBe(true);
    expect(admiteEscritura(EstadoCuadro.EN_TRANSPORTE)).toBe(true);
    expect(admiteEscritura(EstadoCuadro.APROBADO)).toBe(true);
  });

  it('el cerrado no', () => {
    expect(admiteEscritura(EstadoCuadro.CERRADO)).toBe(false);
  });
});

describe('la reapertura', () => {
  it('solo se puede reabrir lo que está cerrado', () => {
    expect(puedeReabrirse(EstadoCuadro.CERRADO)).toBe(true);
    expect(puedeReabrirse(EstadoCuadro.APROBADO)).toBe(false);
    expect(puedeReabrirse(EstadoCuadro.BORRADOR)).toBe(false);
    expect(puedeReabrirse(EstadoCuadro.EN_TRANSPORTE)).toBe(false);
  });

  it('devuelve el cuadro al estado inmediatamente anterior al cierre', () => {
    expect(ESTADO_TRAS_REAPERTURA).toBe(EstadoCuadro.APROBADO);
  });
});
