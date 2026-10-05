/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: reglas-formulario.spec.ts
 * Responsabilidad: Verificar qué acceso tiene cada rol sobre cada formulario.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import { RolDepartamental } from '@prisma/client';

import {
  accesoDe,
  leCorresponde,
  type PropiedadFormulario,
} from './reglas-formulario';

/** Formulario 1. Un solo departamento, y registra. */
const FIJOS: PropiedadFormulario = {
  roles: [{ rol: RolDepartamental.DMIP_OPERATIVOS, acceso: 'ESCRITURA' }],
};

/** Formulario 6. Inspecciones registra; Instrucción tiene un cupo de una persona. */
const REACCION_NOCTURNA: PropiedadFormulario = {
  roles: [
    { rol: RolDepartamental.DMIP_INSPECCIONES, acceso: 'ESCRITURA' },
    { rol: RolDepartamental.DMIT_INSTRUCTOR, acceso: 'APORTA' },
  ],
};

/**
 * Formulario 4, desde el 2026-08-25. **DOS departamentos que registran**, que es lo que
 * el modelo anterior no podía expresar y el motivo de que `PropiedadFormulario` dejara de
 * ser dos campos.
 */
const PATRULLA_ECU: PropiedadFormulario = {
  roles: [
    { rol: RolDepartamental.DMIP_OPERATIVOS, acceso: 'ESCRITURA' },
    { rol: RolDepartamental.DMIT_INSTRUCTOR, acceso: 'ESCRITURA' },
  ],
};

describe('accesoDe', () => {
  it('da ESCRITURA al rol dueño', () => {
    expect(accesoDe(FIJOS, RolDepartamental.DMIP_OPERATIVOS)).toBe('ESCRITURA');
  });

  it('da COMPARTIDO al rol con cupo, no ESCRITURA', () => {
    expect(accesoDe(REACCION_NOCTURNA, RolDepartamental.DMIT_INSTRUCTOR)).toBe(
      'COMPARTIDO',
    );
  });

  it('da LECTURA a un departamento ajeno', () => {
    expect(accesoDe(FIJOS, RolDepartamental.DMIT_INSTRUCTOR)).toBe('LECTURA');
  });

  it('da LECTURA a la DAF: escribe transporte, no la planificación', () => {
    expect(accesoDe(FIJOS, RolDepartamental.DAF)).toBe('LECTURA');
  });

  it('da LECTURA al Director', () => {
    expect(accesoDe(FIJOS, RolDepartamental.DIRECTOR)).toBe('LECTURA');
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * DOS DEPARTAMENTOS CON ESCRITURA EN EL MISMO FORMULARIO. 2026-08-25.
   *
   * Es lo que el modelo de dos columnas no podía expresar, y el motivo de que
   * `t_formulario_rol` exista. Sin esta prueba, el día que alguien volviera a un único
   * dueño la patrulla ECU perdería a uno de los dos en silencio.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  it('da ESCRITURA a los DOS departamentos que registran en el mismo formulario', () => {
    expect(accesoDe(PATRULLA_ECU, RolDepartamental.DMIP_OPERATIVOS)).toBe(
      'ESCRITURA',
    );
    expect(accesoDe(PATRULLA_ECU, RolDepartamental.DMIT_INSTRUCTOR)).toBe(
      'ESCRITURA',
    );
  });

  it('y sigue dando LECTURA a un tercero', () => {
    expect(accesoDe(PATRULLA_ECU, RolDepartamental.DMIP_INSPECCIONES)).toBe(
      'LECTURA',
    );
  });

  /** Un formulario sin ninguna fila no es de nadie: no se ofrece por descuido. */
  it('sin participaciones declaradas, nadie escribe', () => {
    expect(accesoDe({ roles: [] }, RolDepartamental.DMIP_OPERATIVOS)).toBe(
      'LECTURA',
    );
  });
});

describe('leCorresponde', () => {
  it('ofrece al departamento solo sus formularios', () => {
    expect(leCorresponde(FIJOS, RolDepartamental.DMIP_OPERATIVOS)).toBe(true);
    expect(leCorresponde(FIJOS, RolDepartamental.DMIP_INSPECCIONES)).toBe(
      false,
    );
    expect(leCorresponde(FIJOS, RolDepartamental.DMIT_INSTRUCTOR)).toBe(false);
  });

  it('ofrece el formulario compartido a quien tiene el cupo', () => {
    expect(
      leCorresponde(REACCION_NOCTURNA, RolDepartamental.DMIT_INSTRUCTOR),
    ).toBe(true);
  });

  it('ofrece los nueve a los roles transversales', () => {
    for (const rol of [
      RolDepartamental.DAF,
      RolDepartamental.DIRECTOR,
      RolDepartamental.ADMINISTRADOR_DMIP,
    ]) {
      expect(leCorresponde(FIJOS, rol)).toBe(true);
      expect(leCorresponde(REACCION_NOCTURNA, rol)).toBe(true);
    }
  });
});
