/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: formulario-admin.spec.ts
 * Responsabilidad: Verificar las reglas puras del alta y la edición de formularios.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-13
 */

import {
  decidirCambioDePrefijo,
  mensajePrefijoRepetido,
  nombreDeFormulario,
  numeroLibreMasBajo,
  prefijoGeneral,
  prefijoMostrado,
  prefijoUsadoPorOtro,
  type PrefijoDeFormulario,
} from './formulario-admin';

const fila = (
  id: number,
  prefijo: string,
  extra: Partial<PrefijoDeFormulario> = {},
): PrefijoDeFormulario => ({
  id,
  prefijo,
  areaAplica: null,
  esPredeterminado: false,
  esAdicional: false,
  ...extra,
});

/** Formulario 7 de desarrollo: varias filas sin área, una sola predeterminada. */
const DMIT = [
  fila(80, 'OC', { esPredeterminado: true }),
  fila(81, 'IC'),
  fila(82, 'OCA'),
  fila(83, 'ICA'),
];

/** Formulario 8: numera solo por área. */
const INSP = [
  fila(84, 'IG', { areaAplica: 'GENERAL' }),
  fila(85, 'IT', { areaAplica: 'TECNICO' }),
  fila(86, 'IGA', { areaAplica: 'GENERAL', esAdicional: true }),
];

describe('nombreDeFormulario', () => {
  it('guarda en MAYÚSCULAS, con tildes y sin espacios sobrantes', () => {
    expect(nombreDeFormulario('  inspecciones   técnicas ')).toBe(
      'INSPECCIONES TÉCNICAS',
    );
  });
});

describe('numeroLibreMasBajo', () => {
  it('sugiere el siguiente cuando no hay huecos', () => {
    expect(numeroLibreMasBajo([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(11);
  });

  it('ocupa el primer hueco', () => {
    expect(numeroLibreMasBajo([1, 2, 4])).toBe(3);
  });

  it('devuelve null si los 99 están ocupados', () => {
    expect(
      numeroLibreMasBajo(Array.from({ length: 99 }, (_, i) => i + 1)),
    ).toBeNull();
  });
});

describe('prefijo general y mostrado', () => {
  it('es el predeterminado sin área aunque haya otras filas sin área', () => {
    expect(prefijoGeneral(DMIT)?.prefijo).toBe('OC');
  });

  it('es la única fila ordinaria aunque no esté marcada como predeterminada', () => {
    expect(prefijoGeneral([fila(70, 'OCF')])?.prefijo).toBe('OCF');
  });

  it('no existe en un formulario que numera solo por área; se muestra el primero', () => {
    expect(prefijoGeneral(INSP)).toBeNull();
    expect(prefijoMostrado(INSP)).toBe('IG');
  });
});

describe('prefijoUsadoPorOtro', () => {
  const enUso = [
    { formularioId: 1, prefijo: 'OCF' },
    { formularioId: 3, prefijo: 'OCL' },
  ];

  it('detecta el de otro formulario sin importar mayúsculas', () => {
    expect(prefijoUsadoPorOtro(' ocl ', 1, enUso)).toBe(true);
    expect(prefijoUsadoPorOtro('OCF', null, enUso)).toBe(true);
  });

  it('no cuenta el del propio formulario', () => {
    expect(prefijoUsadoPorOtro('OCF', 1, enUso)).toBe(false);
  });

  it('el mensaje explica el riesgo', () => {
    expect(mensajePrefijoRepetido('ocf')).toBe(
      'El prefijo OCF ya lo usa otro formulario: los identificadores se confundirían.',
    );
  });
});

describe('decidirCambioDePrefijo', () => {
  it('sin prefijo en el cuerpo no hace nada', () => {
    expect(decidirCambioDePrefijo(DMIT, undefined)).toEqual({
      accion: 'ninguna',
    });
  });

  it('el mismo prefijo (con otras mayúsculas) no escribe', () => {
    expect(decidirCambioDePrefijo(DMIT, ' oc ')).toEqual({ accion: 'ninguna' });
  });

  it('un prefijo nuevo actualiza la fila general, no otra', () => {
    expect(decidirCambioDePrefijo(DMIT, 'ocd')).toEqual({
      accion: 'actualizar',
      id: 80,
      prefijo: 'OCD',
    });
  });

  it('un formulario por área acepta el mostrado y rechaza otro', () => {
    expect(decidirCambioDePrefijo(INSP, 'IG')).toEqual({ accion: 'ninguna' });
    const decision = decidirCambioDePrefijo(INSP, 'XX');
    expect(decision.accion).toBe('rechazar');
    expect(decision).toMatchObject({
      mensaje: expect.stringContaining('numera por área') as string,
    });
  });
});
