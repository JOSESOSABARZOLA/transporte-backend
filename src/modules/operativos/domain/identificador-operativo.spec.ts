/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Objetos de valor del dominio
 * Archivo: identificador-operativo.spec.ts
 * Responsabilidad: Verificar la composición y la lectura del código del operativo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import { ValidacionError } from '../../../common/errors/errores-dominio';
import { IdentificadorOperativo } from './identificador-operativo';

const TREINTA_Y_UNO_JULIO = new Date(2026, 6, 31);

describe('IdentificadorOperativo · composición', () => {
  it('compone el formato aprobado en los mockups', () => {
    const identificador = IdentificadorOperativo.componer(
      'ICNECU',
      1,
      TREINTA_Y_UNO_JULIO,
    );

    expect(identificador.toString()).toBe('ICNECU-001-31-JUL-2026');
  });

  it('caso 10 del plan · el secuencial empieza en 001 en cada fecha', () => {
    const julio = IdentificadorOperativo.componer(
      'OCF',
      1,
      new Date(2026, 6, 31),
    );
    const agosto = IdentificadorOperativo.componer(
      'OCF',
      1,
      new Date(2026, 7, 1),
    );

    expect(julio.toString()).toBe('OCF-001-31-JUL-2026');
    expect(agosto.toString()).toBe('OCF-001-01-AGO-2026');
    expect(julio.equivaleA(agosto)).toBe(false);
  });

  it('rellena el secuencial a tres cifras', () => {
    expect(
      IdentificadorOperativo.componer('IG', 2, TREINTA_Y_UNO_JULIO).toString(),
    ).toBe('IG-002-31-JUL-2026');
    expect(
      IdentificadorOperativo.componer(
        'IG',
        999,
        TREINTA_Y_UNO_JULIO,
      ).toString(),
    ).toBe('IG-999-31-JUL-2026');
  });

  it('rellena el día a dos cifras', () => {
    expect(
      IdentificadorOperativo.componer(
        'OCL',
        5,
        new Date(2026, 0, 3),
      ).toString(),
    ).toBe('OCL-005-03-ENE-2026');
  });

  it('escribe los doce meses en la abreviatura castellana', () => {
    const meses = Array.from(
      { length: 12 },
      (_, indice) =>
        IdentificadorOperativo.componer('OC', 1, new Date(2026, indice, 15))
          .toString()
          .split('-')[3],
    );

    expect(meses).toEqual([
      'ENE',
      'FEB',
      'MAR',
      'ABR',
      'MAY',
      'JUN',
      'JUL',
      'AGO',
      'SEP',
      'OCT',
      'NOV',
      'DIC',
    ]);
  });

  describe('rechazos', () => {
    it('rechaza un prefijo en minúsculas o con símbolos', () => {
      expect(() =>
        IdentificadorOperativo.componer('ocf', 1, TREINTA_Y_UNO_JULIO),
      ).toThrow(ValidacionError);
      expect(() =>
        IdentificadorOperativo.componer('OC-F', 1, TREINTA_Y_UNO_JULIO),
      ).toThrow(ValidacionError);
    });

    it('rechaza un prefijo más largo de lo que admite la columna', () => {
      expect(() =>
        IdentificadorOperativo.componer(
          'PREFIJODEMASIADOLARGO',
          1,
          TREINTA_Y_UNO_JULIO,
        ),
      ).toThrow(ValidacionError);
    });

    it('rechaza un secuencial fuera del rango de tres cifras', () => {
      expect(() =>
        IdentificadorOperativo.componer('OCF', 0, TREINTA_Y_UNO_JULIO),
      ).toThrow(ValidacionError);
      expect(() =>
        IdentificadorOperativo.componer('OCF', 1000, TREINTA_Y_UNO_JULIO),
      ).toThrow(ValidacionError);
      expect(() =>
        IdentificadorOperativo.componer('OCF', 1.5, TREINTA_Y_UNO_JULIO),
      ).toThrow(ValidacionError);
    });

    it('rechaza una fecha inválida', () => {
      expect(() =>
        IdentificadorOperativo.componer('OCF', 1, new Date('no es fecha')),
      ).toThrow(ValidacionError);
    });
  });
});

describe('IdentificadorOperativo · lectura', () => {
  it('vuelve del texto al objeto sin consultar la base', () => {
    const identificador = IdentificadorOperativo.desde(
      'ICNECU-001-31-JUL-2026',
    );

    expect(identificador.prefijo).toBe('ICNECU');
    expect(identificador.secuencial).toBe(1);
    expect(identificador.fechaOperativa).toEqual(new Date(2026, 6, 31));
  });

  it('lo compuesto y lo leído son el mismo valor', () => {
    const compuesto = IdentificadorOperativo.componer(
      'OCPMO',
      4,
      new Date(2026, 6, 31),
    );
    const leido = IdentificadorOperativo.desde(compuesto.toString());

    expect(leido.equivaleA(compuesto)).toBe(true);
  });

  it('rechaza un texto con otra forma', () => {
    expect(() => IdentificadorOperativo.desde('OCF-1-31-JUL-2026')).toThrow(
      ValidacionError,
    );
    expect(() => IdentificadorOperativo.desde('OCF/001/31/JUL/2026')).toThrow(
      ValidacionError,
    );
    expect(() => IdentificadorOperativo.desde('')).toThrow(ValidacionError);
  });

  it('rechaza un mes que no existe, enumerando los válidos', () => {
    try {
      IdentificadorOperativo.desde('OCF-001-31-XXX-2026');
      fail('debió rechazarlo');
    } catch (error) {
      expect((error as ValidacionError).message).toContain('ENE');
    }
  });

  it('rechaza una fecha imposible en lugar de desbordarla al mes siguiente', () => {
    expect(() => IdentificadorOperativo.desde('OCF-001-31-FEB-2026')).toThrow(
      ValidacionError,
    );
  });
});
