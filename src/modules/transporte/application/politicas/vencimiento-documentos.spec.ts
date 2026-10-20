/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · versión consolidada
 * Archivo: vencimiento-documentos.spec.ts
 * Responsabilidad: Verificar las alertas de SOAT y matrícula con el día local de Quito.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 */

import {
  alertasDeVencimiento,
  estadoDocumentos,
  hoyEnGuayaquil,
} from './vencimiento-documentos';

const dia = (texto: string) => new Date(`${texto}T00:00:00.000Z`);

describe('alertasDeVencimiento', () => {
  it('VENCIDO si ya pasó, POR_VENCER dentro del aviso, nada si falta más', () => {
    expect(
      alertasDeVencimiento(
        {
          soatVencimiento: dia('2026-10-01'),
          matriculaVencimiento: dia('2026-10-20'),
        },
        '2026-10-07',
        30,
      ),
    ).toEqual([
      { documento: 'SOAT', vence: '2026-10-01', dias: -6, estado: 'VENCIDO' },
      {
        documento: 'MATRICULA',
        vence: '2026-10-20',
        dias: 13,
        estado: 'POR_VENCER',
      },
    ]);
    expect(
      alertasDeVencimiento(
        { soatVencimiento: dia('2026-12-31'), matriculaVencimiento: null },
        '2026-10-07',
        30,
      ),
    ).toEqual([]);
  });

  it('vence HOY es POR_VENCER con 0 días; el límite del aviso entra, el siguiente no', () => {
    const r = (vence: string) =>
      alertasDeVencimiento(
        { soatVencimiento: dia(vence), matriculaVencimiento: null },
        '2026-10-07',
        30,
      );
    expect(r('2026-10-07')).toEqual([
      { documento: 'SOAT', vence: '2026-10-07', dias: 0, estado: 'POR_VENCER' },
    ]);
    expect(r('2026-11-06')[0]?.dias).toBe(30);
    expect(r('2026-11-07')).toEqual([]);
  });

  it('la anticipación es el parámetro: con 5 días, a 13 no avisa', () => {
    expect(
      alertasDeVencimiento(
        { soatVencimiento: null, matriculaVencimiento: dia('2026-10-20') },
        '2026-10-07',
        5,
      ),
    ).toEqual([]);
  });
});

describe('hoyEnGuayaquil', () => {
  it('a las 20H00 de Quito (01H00 UTC del día siguiente) sigue siendo el día de Quito', () => {
    expect(hoyEnGuayaquil(new Date('2026-10-08T01:00:00.000Z'))).toBe(
      '2026-10-07',
    );
    expect(hoyEnGuayaquil(new Date('2026-10-08T05:00:00.000Z'))).toBe(
      '2026-10-08',
    );
  });

  it('un SOAT que vence hoy en Quito no sale VENCIDO a las 20H00', () => {
    const hoy = hoyEnGuayaquil(new Date('2026-10-08T01:00:00.000Z'));
    expect(
      alertasDeVencimiento(
        { soatVencimiento: dia('2026-10-07'), matriculaVencimiento: null },
        hoy,
        30,
      )[0].estado,
    ).toBe('POR_VENCER');
  });
});

describe('estadoDocumentos (Flota y garajes, 2026-10-14)', () => {
  const HOY = '2026-10-14';

  it('un documento VENCIDO gana a uno POR_VENCER', () => {
    expect(
      estadoDocumentos(dia('2026-09-30'), dia('2026-10-20'), HOY, 30),
    ).toEqual({
      estado: 'VENCIDO',
      documento: 'MATRICULA',
      vence: '2026-09-30',
      dias: -14,
    });
  });

  it('POR_VENCER con el documento que vence primero', () => {
    expect(
      estadoDocumentos(dia('2026-11-05'), dia('2026-11-02'), HOY, 30),
    ).toEqual({
      estado: 'POR_VENCER',
      documento: 'SOAT',
      vence: '2026-11-02',
      dias: 19,
    });
  });

  it('vence hoy cuenta como POR_VENCER con 0 días', () => {
    expect(estadoDocumentos(dia(HOY), null, HOY, 30)).toMatchObject({
      estado: 'POR_VENCER',
      dias: 0,
    });
  });

  it('AL_DIA con las dos fechas y ninguna alerta', () => {
    expect(
      estadoDocumentos(dia('2027-06-01'), dia('2027-06-01'), HOY, 30),
    ).toEqual({
      estado: 'AL_DIA',
      documento: null,
      vence: null,
      dias: null,
    });
  });

  it('SIN_FECHAS sin matrícula ni SOAT', () => {
    expect(estadoDocumentos(null, null, HOY, 30).estado).toBe('SIN_FECHAS');
  });

  it('el aviso es el parámetro: con 10 días, a 19 días está AL_DIA', () => {
    expect(
      estadoDocumentos(dia('2027-06-01'), dia('2026-11-02'), HOY, 10).estado,
    ).toBe('AL_DIA');
  });

  it('INCOMPLETO con el documento que falta: «Falta SOAT»', () => {
    expect(estadoDocumentos(dia('2027-06-01'), null, HOY, 30)).toEqual({
      estado: 'INCOMPLETO',
      documento: 'SOAT',
      vence: null,
      dias: null,
    });
  });

  it('INCOMPLETO con el documento que falta: «Falta matrícula»', () => {
    expect(estadoDocumentos(null, dia('2027-06-01'), HOY, 30)).toMatchObject({
      estado: 'INCOMPLETO',
      documento: 'MATRICULA',
    });
  });

  it('la alerta de la fecha que sí está gana a la que falta', () => {
    expect(estadoDocumentos(null, dia('2026-10-01'), HOY, 30)).toMatchObject({
      estado: 'VENCIDO',
      documento: 'SOAT',
    });
    expect(estadoDocumentos(dia('2026-11-02'), null, HOY, 30)).toMatchObject({
      estado: 'POR_VENCER',
      documento: 'MATRICULA',
    });
  });
});
