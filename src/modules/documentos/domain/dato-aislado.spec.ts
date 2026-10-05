/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: dato-aislado.spec.ts
 * Responsabilidad: Verificar INV-24: la orden expone solo los cuatro datos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import { ValidacionError } from '../../../common/errors/errores-dominio';
import {
  construirDatoAislado,
  esDatoAisladoValido,
  type DatoAislado,
} from './dato-aislado';

const VALORES = {
  horaInicio: '18:00',
  horaFin: '23:30',
  nombreFuncionario: 'BENAVIDES FERNANDO',
  nombreConductor: 'VIVANCO JORGE',
  telefonoConductor: '0978631797',
  placa: 'PMA7892',
};

describe('INV-24 · el dato aislado tiene EXACTAMENTE cuatro campos', () => {
  it('caso 2 del plan · ni uno más', () => {
    const dato = construirDatoAislado(VALORES);

    expect(Object.keys(dato).sort()).toEqual([
      'conductor',
      'funcionario',
      'horario',
      'placa',
    ]);
  });

  it('no hay forma de colar un quinto campo: el objeto está congelado', () => {
    const dato = construirDatoAislado(VALORES) as DatoAislado &
      Record<string, unknown>;

    // En modo estricto esto lanzaría; en modo laxo se ignora. En los dos casos, el
    // campo no acaba en el documento, que es lo que INV-24 garantiza.
    try {
      dato.puntoEncuentro = 'El Tejar';
    } catch {
      // Se ignora a propósito: lo que se afirma es el resultado, no la excepción.
    }

    expect(Object.keys(dato)).toHaveLength(4);
    expect(dato.puntoEncuentro).toBeUndefined();
  });

  it('el constructor NO acepta un operativo: solo valores sueltos', () => {
    // Es la garantía estructural. Este objeto no tiene de dónde sacar el punto de
    // encuentro, el tipo de control ni el resto del personal: no los recibe.
    const dato = construirDatoAislado(VALORES);

    expect(JSON.stringify(dato)).not.toContain('Tejar');
    expect(JSON.stringify(dato)).not.toContain('operativo');
  });
});

describe('el contenido de la orden', () => {
  it('compone el horario en notación institucional', () => {
    expect(construirDatoAislado(VALORES).horario).toBe('18H00 A 23H30');
  });

  it('lleva el nombre del destinatario, recortado', () => {
    const dato = construirDatoAislado({
      ...VALORES,
      nombreFuncionario: '  BENAVIDES FERNANDO  ',
    });

    expect(dato.funcionario).toBe('BENAVIDES FERNANDO');
  });

  it('FASE5 §9.6 · el conductor viaja con su teléfono, para poder llamarlo', () => {
    const dato = construirDatoAislado(VALORES);

    expect(dato.conductor).toEqual({
      nombre: 'VIVANCO JORGE',
      telefono: '0978631797',
    });
    expect(dato.placa).toBe('PMA7892');
  });

  it('sin conductor asignado, el campo queda nulo y no se inventa nada', () => {
    const dato = construirDatoAislado({
      horaInicio: '08:00',
      horaFin: '12:00',
      nombreFuncionario: 'SEGOVIA MARIA',
    });

    expect(dato.conductor).toBeNull();
    expect(dato.placa).toBeNull();
    expect(Object.keys(dato)).toHaveLength(4);
  });

  it('un conductor sin teléfono registrado se acepta igual', () => {
    const dato = construirDatoAislado({
      ...VALORES,
      telefonoConductor: null,
    });

    expect(dato.conductor?.telefono).toBeNull();
  });
});

describe('lo que el constructor rechaza', () => {
  it('un horario mal formado', () => {
    expect(() =>
      construirDatoAislado({ ...VALORES, horaInicio: '25:00' }),
    ).toThrow(ValidacionError);
  });

  it('un destinatario sin nombre', () => {
    const fallo = intentar(() =>
      construirDatoAislado({ ...VALORES, nombreFuncionario: '   ' }),
    );

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('funcionario');
  });
});

/** Devuelve el error en lugar de propagarlo, para poder afirmar sobre su mensaje. */
function intentar(operacion: () => unknown): unknown {
  try {
    operacion();
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

describe('esDatoAisladoValido · lo que se lee de la base', () => {
  it('acepta un dato con los cuatro campos', () => {
    expect(esDatoAisladoValido(construirDatoAislado(VALORES))).toBe(true);
  });

  it('rechaza uno con un campo de más', () => {
    expect(
      esDatoAisladoValido({
        horario: '18H00 A 23H30',
        funcionario: 'X',
        conductor: null,
        placa: null,
        puntoEncuentro: 'El Tejar',
      }),
    ).toBe(false);
  });

  it('rechaza uno incompleto, nulo o que no es un objeto', () => {
    expect(esDatoAisladoValido({ horario: '18H00' })).toBe(false);
    expect(esDatoAisladoValido(null)).toBe(false);
    expect(esDatoAisladoValido('texto')).toBe(false);
  });
});
