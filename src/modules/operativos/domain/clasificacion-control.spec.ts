/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos
 * Archivo: clasificacion-control.spec.ts
 * Responsabilidad: Verificar RN-16, RN-20 e INV-08.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import { ValidacionError } from '../../../common/errors/errores-dominio';
import { ClasificacionControl } from './clasificacion-control';

describe('ClasificacionControl · desde el catálogo', () => {
  it('acepta un tipo del catálogo y deja el texto libre vacío', () => {
    const clasificacion = ClasificacionControl.delCatalogo(7);

    expect(clasificacion.tipoId).toBe(7);
    expect(clasificacion.tipoLibre).toBeNull();
    expect(clasificacion.origen).toBe('CATALOGO');
  });

  it('rechaza un identificador que no es un entero positivo', () => {
    for (const invalido of [0, -3, 1.5, Number.NaN]) {
      expect(() => ClasificacionControl.delCatalogo(invalido)).toThrow(
        ValidacionError,
      );
    }
  });
});

describe('ClasificacionControl · captura libre (RN-20)', () => {
  it('acepta el texto cuando el formulario ofrece ADICIONALES', () => {
    const clasificacion = ClasificacionControl.capturada(
      '  Control de escombros  ',
      true,
    );

    expect(clasificacion.tipoId).toBeNull();
    expect(clasificacion.tipoLibre).toBe('Control de escombros');
    expect(clasificacion.origen).toBe('CAPTURA_LIBRE');
  });

  it('la rechaza cuando el formulario NO ofrece ADICIONALES', () => {
    const fallo = intentar(() =>
      ClasificacionControl.capturada('Control de escombros', false),
    );

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('ADICIONALES');
  });

  it('rechaza el texto vacío o solo con espacios', () => {
    expect(() => ClasificacionControl.capturada('   ', true)).toThrow(
      ValidacionError,
    );
  });

  it('rechaza un texto que no cabe en la columna', () => {
    expect(() => ClasificacionControl.capturada('C'.repeat(221), true)).toThrow(
      ValidacionError,
    );

    expect(() =>
      ClasificacionControl.capturada('C'.repeat(220), true),
    ).not.toThrow();
  });
});

describe('ClasificacionControl.de · INV-08 y ck_operativo_tipo', () => {
  it('caso 9 del plan · los dos informados se rechaza', () => {
    const fallo = intentar(() =>
      ClasificacionControl.de({
        tipoId: 3,
        tipoLibre: 'Otro',
        permiteCapturaLibre: true,
      }),
    );

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('no las dos cosas');
  });

  it('ninguno informado se rechaza', () => {
    expect(() =>
      ClasificacionControl.de({ permiteCapturaLibre: true }),
    ).toThrow(ValidacionError);
  });

  it('el texto en blanco cuenta como no informado', () => {
    expect(() =>
      ClasificacionControl.de({
        tipoLibre: '   ',
        permiteCapturaLibre: true,
      }),
    ).toThrow(ValidacionError);
  });

  it('un tipo del catálogo con el permiso desactivado sigue siendo válido', () => {
    // El permiso solo gobierna la captura libre: elegir del catálogo no depende de él.
    const clasificacion = ClasificacionControl.de({
      tipoId: 4,
      permiteCapturaLibre: false,
    });

    expect(clasificacion.origen).toBe('CATALOGO');
  });

  it('equivaleA compara por valor', () => {
    const una = ClasificacionControl.de({
      tipoId: 5,
      permiteCapturaLibre: false,
    });
    const otra = ClasificacionControl.delCatalogo(5);

    expect(una.equivaleA(otra)).toBe(true);
    expect(una.equivaleA(ClasificacionControl.delCatalogo(6))).toBe(false);
  });
});

describe('ClasificacionControl · selección múltiple (form 8)', () => {
  it('acepta varios tipos del catálogo a la vez', () => {
    const clasificacion = ClasificacionControl.de({
      tipoIds: [23, 24, 26],
      permiteCapturaLibre: true,
      permiteMultiple: true,
    });

    expect(clasificacion.tipoIds).toEqual([23, 24, 26]);
    expect(clasificacion.tipoId).toBeNull();
    expect(clasificacion.origen).toBe('CATALOGO');
  });

  it('admite el adicional JUNTO a los tipos del catálogo', () => {
    const clasificacion = ClasificacionControl.de({
      tipoIds: [23],
      tipoLibre: 'Un motivo nuevo',
      permiteCapturaLibre: true,
      permiteMultiple: true,
    });

    expect(clasificacion.tipoIds).toEqual([23]);
    expect(clasificacion.tipoLibre).toBe('Un motivo nuevo');
  });

  it('quita los identificadores repetidos', () => {
    const clasificacion = ClasificacionControl.de({
      tipoIds: [23, 23, 24],
      permiteCapturaLibre: true,
      permiteMultiple: true,
    });

    expect(clasificacion.tipoIds).toEqual([23, 24]);
  });

  it('exige al menos un tipo: ni lista ni adicional se rechaza', () => {
    const fallo = intentar(() =>
      ClasificacionControl.de({
        tipoIds: [],
        permiteCapturaLibre: true,
        permiteMultiple: true,
      }),
    );

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('al menos un tipo');
  });

  it('con solo el adicional basta', () => {
    const clasificacion = ClasificacionControl.de({
      tipoIds: [],
      tipoLibre: 'Solo un adicional',
      permiteCapturaLibre: true,
      permiteMultiple: true,
    });

    expect(clasificacion.tipoIds).toEqual([]);
    expect(clasificacion.tipoLibre).toBe('Solo un adicional');
  });
});

function intentar(operacion: () => unknown): unknown {
  try {
    operacion();
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}
