/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Administración · carga inicial
 * Archivo: carga-inicial.spec.ts
 * Responsabilidad: Verificar las filas válidas e inválidas de cada tipo de carga inicial.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 */

import type { ValorCelda } from './importar-horario';
import {
  fechaDeCelda,
  previsualizarCarga,
  validarDatos,
} from './carga-inicial';

const CONTEXTO = { zonales: [{ id: 3, nombre: 'Calderón' }] };

describe('fechaDeCelda', () => {
  it('admite fecha de Excel, AAAA-MM-DD y DD/MM/AAAA; vacía es ""; otra cosa, null', () => {
    expect(fechaDeCelda(new Date('2026-12-31T00:00:00.000Z'))).toBe(
      '2026-12-31',
    );
    expect(fechaDeCelda('2026-1-5')).toBe('2026-01-05');
    expect(fechaDeCelda('05/01/2026')).toBe('2026-01-05');
    expect(fechaDeCelda(null)).toBe('');
    expect(fechaDeCelda('31/02/2026')).toBeNull();
    expect(fechaDeCelda('mañana')).toBeNull();
  });
});

describe('carga inicial · conductores', () => {
  const hoja: ValorCelda[][] = [
    ['Carga de conductores'],
    [
      'CÉDULA',
      'Nombres',
      'Teléfono',
      'Sector',
      'Contrato',
      'Parqueadero',
      'Acta',
      'Acta desde',
      'Acta hasta',
      'Patrón',
    ],
    [
      1712345678,
      'Pérez Juan',
      '0991234567',
      'norte',
      'ocasional',
      'SI',
      'A-1',
      '01/01/2026',
      new Date('2026-12-31T00:00:00.000Z'),
      'ddnnll',
    ],
    ['171234', '', 'abc', 'ORIENTE', 'TEMPORAL', 'QUIZÁ', '', '', '', 'XYZ'],
    [null, null, null],
    ['1712345678', 'OTRO', '', '', '', 'NO', 'A-2', '', '', ''],
    [912345678, 'Cero Inicial', '', '', '', '', '', '', '', ''],
  ];
  const previa = previsualizarCarga('conductores', hoja, CONTEXTO);

  it('una fila completa es válida y se normaliza', () => {
    expect(previa.filas[0]).toEqual({
      fila: 3,
      valido: true,
      errores: [],
      datos: {
        cedula: '1712345678',
        nombreCompleto: 'PÉREZ JUAN',
        telefono: '0991234567',
        sector: 'NORTE',
        tipoContrato: 'OCASIONAL',
        parqueaderoAutorizado: true,
        actaParqueaderoNumero: 'A-1',
        actaParqueaderoDesde: '2026-01-01',
        actaParqueaderoHasta: '2026-12-31',
        patronRotacion: 'DDNNLL',
      },
    });
  });

  it('una fila mala lista TODOS sus errores', () => {
    const mala = previa.filas[1];
    expect(mala.valido).toBe(false);
    expect(mala.errores).toEqual(
      expect.arrayContaining([
        'La cédula debe tener diez dígitos.',
        'Falta el nombre del conductor.',
        'El teléfono no tiene un formato válido.',
        expect.stringMatching(/sector admite/),
        expect.stringMatching(/contrato admite/),
        'PARQUEADERO admite SI o NO.',
        expect.stringMatching(/patrón lleva/),
      ]),
    );
  });

  it('las filas vacías se saltan; un acta sin parqueadero y una cédula repetida son errores', () => {
    expect(previa.filas.map((f) => f.fila)).toEqual([3, 4, 6, 7]);
    const repetida = previa.filas[2];
    expect(repetida.valido).toBe(false);
    expect(repetida.errores).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/parqueadero autorizado/),
        'Repetido en el archivo: ya aparece en la fila 3.',
      ]),
    );
  });

  it('repone el 0 inicial que Excel quita a la cédula', () => {
    expect(previa.filas[3].datos.cedula).toBe('0912345678');
    expect(previa.filas[3].valido).toBe(true);
    expect(previa.resumen).toEqual({ validas: 2, invalidas: 2 });
  });

  it('sin la cabecera esperada lo dice con el formato', () => {
    const r = previsualizarCarga('conductores', [['algo', 'otro']], CONTEXTO);
    expect(r.resumen).toEqual({ validas: 0, invalidas: 1 });
    expect(r.filas[0].errores[0]).toMatch(/CEDULA, NOMBRES, TELEFONO/);
    expect(r.formatoEsperado).toContain('PATRON');
  });
});

describe('carga inicial · vehículos', () => {
  it('valida placa, enteros y fechas', () => {
    const r = previsualizarCarga(
      'vehiculos',
      [
        [
          'PLACA',
          'TIPO',
          'ASIENTOS',
          'KILOMETRAJE',
          'MATRÍCULA VENCE',
          'SOAT VENCE',
        ],
        ['pma 1234', 'camioneta', 4, 120500, '2027-03-01', '15/11/2026'],
        ['', 'BUS', 0, -5, 'nunca', ''],
      ],
      CONTEXTO,
    );
    expect(r.filas[0]).toEqual({
      fila: 2,
      valido: true,
      errores: [],
      datos: {
        placa: 'PMA-1234',
        tipo: 'CAMIONETA',
        asientos: 4,
        kilometraje: 120500,
        matriculaVencimiento: '2027-03-01',
        soatVencimiento: '2026-11-15',
      },
    });
    expect(r.filas[1].valido).toBe(false);
    expect(r.filas[1].errores).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/no es una fecha válida/),
        'Falta la placa.',
        'ASIENTOS debe ser un entero entre 1 y 60.',
        'KILOMETRAJE debe ser un entero entre 0 y 9999999.',
      ]),
    );
  });
});

describe('carga inicial · placa normalizada (A1, 2026-10-15)', () => {
  it('«PMA1234» y «pma-1234» son la misma placa: la segunda es repetida', () => {
    const r = previsualizarCarga(
      'vehiculos',
      [['PLACA'], ['PMA1234'], ['pma - 1234'], ['gye233']],
      CONTEXTO,
    );
    expect(r.filas.map((f) => f.datos.placa)).toEqual([
      'PMA-1234',
      'PMA-1234',
      'GYE-233',
    ]);
    expect(r.filas[1].valido).toBe(false);
    expect(r.filas[1].errores).toContain(
      'Repetido en el archivo: ya aparece en la fila 2.',
    );
    expect(r.filas[2].valido).toBe(true);
  });
});

describe('carga inicial · garajes', () => {
  it('un garaje sin zonal es válido (la Matriz); una zonal desconocida no', () => {
    const r = previsualizarCarga(
      'garajes',
      [
        ['NOMBRE', 'ZONAL'],
        ['Matriz', ''],
        ['Garaje Norte', 'CALDERON'],
        ['Garaje Sur', 'Atlántida'],
      ],
      CONTEXTO,
    );
    expect(r.filas.map((f) => [f.valido, f.datos.zonalId])).toEqual([
      [true, null],
      [true, 3],
      [false, null],
    ]);
    expect(r.filas[0].errores).toEqual([]);
    expect(r.filas[2].errores[0]).toMatch(/no existe en el catálogo/);
  });
});

describe('validarDatos (lo que vuelve en «aplicar» se revalida)', () => {
  it('rechaza datos manipulados aunque la vista previa los diera por buenos', () => {
    expect(
      validarDatos(
        'conductores',
        { cedula: '12', nombreCompleto: 'X', parqueaderoAutorizado: false },
        CONTEXTO,
      ).errores,
    ).toContain('La cédula debe tener diez dígitos.');
    expect(
      validarDatos(
        'vehiculos',
        { placa: 'ABC1234', matriculaVencimiento: '2026-02-30' },
        CONTEXTO,
      ).errores,
    ).toEqual([expect.stringMatching(/MATRICULA_VENCE/)]);
  });

  it('acepta los datos ya normalizados de la vista previa', () => {
    expect(
      validarDatos(
        'conductores',
        {
          cedula: '1712345678',
          nombreCompleto: 'PÉREZ JUAN',
          parqueaderoAutorizado: true,
          actaParqueaderoNumero: 'A-1',
          actaParqueaderoDesde: '2026-01-01',
          actaParqueaderoHasta: '2026-12-31',
        },
        CONTEXTO,
      ).errores,
    ).toEqual([]);
  });
});
