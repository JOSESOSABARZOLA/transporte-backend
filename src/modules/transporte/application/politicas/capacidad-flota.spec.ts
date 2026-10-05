/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Capacidad de flota
 * Archivo: capacidad-flota.spec.ts
 * Responsabilidad: Verificar POL-07, RN-46 y VAL-24.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import { verificarCapacidad } from './capacidad-flota';

const declarada = (vehiculosHabiles: number, conductoresHabiles = 20) => ({
  vehiculosHabiles,
  conductoresHabiles,
});

const demanda = (vehiculosRequeridos: number, conductoresRequeridos = 0) => ({
  vehiculosRequeridos,
  conductoresRequeridos,
});

describe('POL-07 · la capacidad alcanza', () => {
  it('caso 2 del plan · con 15 declarados y 12 requeridos no hay advertencia', () => {
    const veredicto = verificarCapacidad(declarada(15), demanda(12));

    expect(veredicto.hayAdvertencia).toBe(false);
    expect(veredicto.advertencia).toBeNull();
    expect(veredicto.vehiculos.excedente).toBe(3);
    expect(veredicto.vehiculos.suficiente).toBe(true);
  });

  it('justo en el límite tampoco advierte', () => {
    const veredicto = verificarCapacidad(declarada(12), demanda(12));

    expect(veredicto.hayAdvertencia).toBe(false);
    expect(veredicto.vehiculos.excedente).toBe(0);
  });

  it('una jornada sin operativos no produce advertencia', () => {
    expect(verificarCapacidad(declarada(0, 0), demanda(0)).hayAdvertencia).toBe(
      false,
    );
  });
});

describe('VAL-24 · la demanda supera la capacidad', () => {
  it('caso 1 del plan · con 15 declarados y 18 requeridos advierte', () => {
    const veredicto = verificarCapacidad(declarada(15), demanda(18));

    expect(veredicto.hayAdvertencia).toBe(true);
    expect(veredicto.vehiculos.excedente).toBe(-3);
    expect(veredicto.vehiculos.suficiente).toBe(false);
    expect(veredicto.advertencia).toContain('3 vehículos');
  });

  it('RN-46 · la función NO lanza: devuelve la comparación', () => {
    // Es la garantía estructural de «advierte sin bloquear»: no hay forma de que esta
    // política impida una asignación, porque no puede interrumpir a quien la llama.
    expect(() =>
      verificarCapacidad(declarada(0, 0), demanda(50, 50)),
    ).not.toThrow();
  });

  it('el mensaje dice que la asignación sigue permitida', () => {
    const veredicto = verificarCapacidad(declarada(15), demanda(18));

    expect(veredicto.advertencia).toContain('sigue permitida');
  });

  it('un solo vehículo de más se redacta en singular', () => {
    const veredicto = verificarCapacidad(declarada(15), demanda(16));

    expect(veredicto.advertencia).toContain('1 vehículo ');
    expect(veredicto.advertencia).not.toContain('1 vehículos');
  });

  it('advierte también por conductores, aunque los vehículos alcancen', () => {
    const veredicto = verificarCapacidad(declarada(20, 5), demanda(10, 10));

    expect(veredicto.vehiculos.suficiente).toBe(true);
    expect(veredicto.conductores.suficiente).toBe(false);
    expect(veredicto.hayAdvertencia).toBe(true);
    expect(veredicto.advertencia).toContain('5 conductores');
  });

  it('cuando faltan los dos, el mensaje los enumera', () => {
    const veredicto = verificarCapacidad(declarada(10, 8), demanda(12, 12));

    expect(veredicto.advertencia).toContain('2 vehículos');
    expect(veredicto.advertencia).toContain('4 conductores');
    expect(veredicto.advertencia).toContain(' y ');
  });

  it('un conductor de más también se redacta en singular', () => {
    const veredicto = verificarCapacidad(declarada(20, 9), demanda(0, 10));

    expect(veredicto.advertencia).toContain('1 conductor ');
  });
});
