/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: eliminacion-catalogo.spec.ts
 * Responsabilidad: Verificar cuándo un valor de catálogo se puede borrar y con qué motivo no.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-12
 */

import {
  MOTIVO_CON_PUNTOS,
  MOTIVO_USADO,
  puedeEliminar,
} from './eliminacion-catalogo';

describe('puedeEliminar', () => {
  it('un valor que nunca se usó se puede borrar', () => {
    expect(puedeEliminar({ usos: 0 })).toEqual({
      puedeEliminar: true,
      motivoNoEliminar: null,
    });
  });

  it('un valor usado en cuadros solo se desactiva', () => {
    expect(puedeEliminar({ usos: 4 })).toEqual({
      puedeEliminar: false,
      motivoNoEliminar: MOTIVO_USADO,
    });
  });

  it('una zonal con puntos no se borra, aunque nunca se haya usado', () => {
    expect(puedeEliminar({ usos: 0, puntos: 2 })).toEqual({
      puedeEliminar: false,
      motivoNoEliminar: MOTIVO_CON_PUNTOS,
    });
  });

  it('el uso en cuadros manda sobre los puntos: es lo que el administrador debe saber primero', () => {
    expect(puedeEliminar({ usos: 1, puntos: 2 }).motivoNoEliminar).toBe(
      MOTIVO_USADO,
    );
  });

  it('una zonal del formulario sin puntos ni usos se puede borrar (la zona de la ciudad no se toca)', () => {
    expect(puedeEliminar({ usos: 0, puntos: 0 }).puedeEliminar).toBe(true);
  });
});
