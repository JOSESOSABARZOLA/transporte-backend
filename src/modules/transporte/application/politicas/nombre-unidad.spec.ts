/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · versión consolidada
 * Archivo: nombre-unidad.spec.ts
 * Responsabilidad: Verificar que la unidad se nombra en palabras y no con el código del rol.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 */

import { NOMBRE_ROL } from '../../../../common/roles/catalogo-roles';
import { nombreDeUnidad } from './nombre-unidad';

describe('nombreDeUnidad', () => {
  it('nombra la unidad con el catálogo de roles, no con el código', () => {
    expect(nombreDeUnidad('DMIP_OPERATIVOS')).toBe(NOMBRE_ROL.DMIP_OPERATIVOS);
    expect(nombreDeUnidad('DMIP_OPERATIVOS')).not.toContain('_');
    expect(nombreDeUnidad('DMIT_INSTRUCTOR')).toBe('DMIT · Instrucción');
  });

  it('un código desconocido se devuelve tal cual y la ausencia sigue siendo null', () => {
    expect(nombreDeUnidad('OTRA_COSA')).toBe('OTRA_COSA');
    expect(nombreDeUnidad(null)).toBeNull();
    expect(nombreDeUnidad(undefined)).toBeNull();
  });
});
