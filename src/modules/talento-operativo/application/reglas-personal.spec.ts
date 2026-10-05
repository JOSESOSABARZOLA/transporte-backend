/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Maestro de personal
 * Archivo: reglas-personal.spec.ts
 * Responsabilidad: Verificar la cédula, el teléfono, los estados y los períodos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import { EstadoDisponibilidad } from '@prisma/client';

import {
  aFechaUtc,
  cubre,
  esCedulaValida,
  esCorreoValido,
  esTelefonoValido,
  excluyeDelOperativo,
  seSolapan,
} from './reglas-personal';

const dia = (texto: string): Date => aFechaUtc(texto) as Date;

describe('esCedulaValida', () => {
  it('admite cédulas ecuatorianas con dígito verificador correcto', () => {
    // Valores compuestos con el algoritmo de módulo 10, no tomados de personas
    // reales: el maestro está vacío y este módulo no inventa datos de nadie.
    for (const cedula of [
      '1710034065',
      '0926687856',
      '1104537897',
      '0102030400',
    ]) {
      expect(esCedulaValida(cedula)).toBe(true);
    }
  });

  it('rechaza un dígito verificador que no corresponde', () => {
    expect(esCedulaValida('1710034066')).toBe(false);
    expect(esCedulaValida('0926687857')).toBe(false);
  });

  it('rechaza una provincia que no existe', () => {
    expect(esCedulaValida('2510034065')).toBe(false);
    expect(esCedulaValida('0010034065')).toBe(false);
  });

  it('rechaza lo que no tiene diez dígitos', () => {
    expect(esCedulaValida('171003406')).toBe(false);
    expect(esCedulaValida('17100340651')).toBe(false);
    expect(esCedulaValida('17-1003406')).toBe(false);
    expect(esCedulaValida('')).toBe(false);
  });
});

describe('esTelefonoValido', () => {
  it('admite el formato con espacios que usa el negocio', () => {
    expect(esTelefonoValido('98 514 4231')).toBe(true);
    expect(esTelefonoValido('0985144231')).toBe(true);
    expect(esTelefonoValido('+593 98 514 4231')).toBe(true);
    expect(esTelefonoValido('02-2445566')).toBe(true);
  });

  it('rechaza lo que no puede ser un teléfono', () => {
    expect(esTelefonoValido('123456')).toBe(false);
    expect(esTelefonoValido('98514423198514423')).toBe(false);
    expect(esTelefonoValido('llamar a la oficina')).toBe(false);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL CORREO DE LA FICHA. Añadido el 2026-09-01.
 *
 * LO QUE FIJA NO ES QUE VALIDE, SINO **CUÁNTO**. Es fácil «mejorar» esta comprobación
 * hacia una expresión de RFC 5322 y romper direcciones legítimas, y es igual de fácil
 * atarla al dominio institucional. Las dos pruebas de abajo dicen que ninguna de esas dos
 * cosas debe pasar: la AMC trabaja con personal de otras instituciones —los operativos
 * conjuntos son la mitad del cuadro— y quien decide si un buzón existe es el servidor de
 * correo, no este archivo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('esCorreoValido', () => {
  it('admite el correo institucional y también el de fuera', () => {
    expect(esCorreoValido('jessica.yunda@quito.gob.ec')).toBe(true);
    expect(esCorreoValido('j.perez@policia.gob.ec')).toBe(true);
    // Con guion, con más de un punto y con dígitos: nada de eso es raro.
    expect(esCorreoValido('maria-jose.campana2@amc.quito.gob.ec')).toBe(true);
  });

  it('rechaza lo que no puede ser un correo', () => {
    expect(esCorreoValido('jessica.yunda')).toBe(false);
    expect(esCorreoValido('@quito.gob.ec')).toBe(false);
    expect(esCorreoValido('jessica@quito')).toBe(false);
    expect(esCorreoValido('jessica yunda@quito.gob.ec')).toBe(false);
    // El dedazo que esta comprobación existe para atrapar: el teléfono en su campo.
    expect(esCorreoValido('0985144231')).toBe(false);
  });
});

describe('excluyeDelOperativo · RN-30', () => {
  it('excluyen las cuatro situaciones de ausencia', () => {
    expect(excluyeDelOperativo(EstadoDisponibilidad.VACACIONES)).toBe(true);
    expect(excluyeDelOperativo(EstadoDisponibilidad.REPOSO_MEDICO)).toBe(true);
    expect(excluyeDelOperativo(EstadoDisponibilidad.CALAMIDAD)).toBe(true);
    expect(excluyeDelOperativo(EstadoDisponibilidad.PERMISO)).toBe(true);
  });

  it('no excluye estar disponible', () => {
    expect(excluyeDelOperativo(EstadoDisponibilidad.DISPONIBLE)).toBe(false);
  });

  it('MANTENIMIENTO no es de personas: tampoco excluye', () => {
    expect(excluyeDelOperativo(EstadoDisponibilidad.MANTENIMIENTO)).toBe(false);
  });
});

describe('seSolapan · INV-14', () => {
  it('detecta el solapamiento parcial', () => {
    expect(
      seSolapan(
        { desde: dia('2026-08-01'), hasta: dia('2026-08-15') },
        { desde: dia('2026-08-10'), hasta: dia('2026-08-20') },
      ),
    ).toBe(true);
  });

  it('detecta la contención', () => {
    expect(
      seSolapan(
        { desde: dia('2026-08-01'), hasta: dia('2026-08-31') },
        { desde: dia('2026-08-10'), hasta: dia('2026-08-12') },
      ),
    ).toBe(true);
  });

  it('LOS EXTREMOS SON INCLUSIVOS: compartir un solo día ya es solapar', () => {
    // Al revés que en RangoHorario, donde encadenar a la misma hora es legítimo.
    // Aquí significaría estar dos veces ausente el mismo día.
    expect(
      seSolapan(
        { desde: dia('2026-08-01'), hasta: dia('2026-08-10') },
        { desde: dia('2026-08-10'), hasta: dia('2026-08-20') },
      ),
    ).toBe(true);
  });

  it('no solapan los períodos consecutivos', () => {
    expect(
      seSolapan(
        { desde: dia('2026-08-01'), hasta: dia('2026-08-10') },
        { desde: dia('2026-08-11'), hasta: dia('2026-08-20') },
      ),
    ).toBe(false);
  });

  it('es simétrico', () => {
    const uno = { desde: dia('2026-08-01'), hasta: dia('2026-08-10') };
    const otro = { desde: dia('2026-08-05'), hasta: dia('2026-08-20') };

    expect(seSolapan(uno, otro)).toBe(seSolapan(otro, uno));
  });

  it('una ausencia de un solo día solapa consigo misma', () => {
    const dia1 = { desde: dia('2026-08-05'), hasta: dia('2026-08-05') };
    expect(seSolapan(dia1, dia1)).toBe(true);
  });
});

describe('cubre', () => {
  it('incluye los dos extremos', () => {
    const periodo = { desde: dia('2026-08-01'), hasta: dia('2026-08-10') };

    expect(cubre(periodo, dia('2026-08-01'))).toBe(true);
    expect(cubre(periodo, dia('2026-08-10'))).toBe(true);
    expect(cubre(periodo, dia('2026-08-05'))).toBe(true);
    expect(cubre(periodo, dia('2026-07-31'))).toBe(false);
    expect(cubre(periodo, dia('2026-08-11'))).toBe(false);
  });
});

describe('aFechaUtc', () => {
  it('interpreta la fecha en UTC, no en la zona del proceso', () => {
    const fecha = aFechaUtc('2026-08-05') as Date;

    expect(fecha.getUTCFullYear()).toBe(2026);
    expect(fecha.getUTCMonth()).toBe(7);
    expect(fecha.getUTCDate()).toBe(5);
    expect(fecha.toISOString()).toBe('2026-08-05T00:00:00.000Z');
  });

  it('rechaza lo que no tiene la forma AAAA-MM-DD', () => {
    expect(aFechaUtc('05/08/2026')).toBeUndefined();
    expect(aFechaUtc('2026-8-5')).toBeUndefined();
    expect(aFechaUtc('')).toBeUndefined();
  });

  it('rechaza una fecha que no existe en lugar de desbordarla', () => {
    expect(aFechaUtc('2026-02-31')).toBeUndefined();
    expect(aFechaUtc('2026-13-01')).toBeUndefined();
  });

  it('admite el 29 de febrero de un año bisiesto', () => {
    expect(aFechaUtc('2028-02-29')).toBeDefined();
    expect(aFechaUtc('2026-02-29')).toBeUndefined();
  });
});
