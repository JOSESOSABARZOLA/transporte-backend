/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Parámetros de política
 * Archivo: reglas-parametro.spec.ts
 * Responsabilidad: Verificar la validación de rango, tipo y dominio.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import { TipoParametro, type ParametroPolitica } from '@prisma/client';

import { motivoDeRechazo } from './reglas-parametro';

const parametro = (parcial: Partial<ParametroPolitica>): ParametroPolitica =>
  ({
    id: 1,
    clave: 'CLAVE',
    valor: '1',
    tipo: TipoParametro.ENTERO,
    descripcion: 'x',
    unidad: null,
    minimo: null,
    maximo: null,
    modificadoPor: null,
    modificadoEn: new Date(),
    ...parcial,
  }) as ParametroPolitica;

const JORNADA = parametro({
  clave: 'JORNADA_MAXIMA_HORAS',
  tipo: TipoParametro.DECIMAL,
  unidad: 'horas',
  minimo: '8',
  maximo: '16',
});

const TOPE = parametro({
  clave: 'TOPE_SALIDAS_PESADAS',
  tipo: TipoParametro.ENTERO,
  unidad: 'salidas',
  minimo: '1',
  maximo: '6',
});

describe('motivoDeRechazo', () => {
  describe('rango de los valores numéricos', () => {
    it('acepta un valor dentro del rango', () => {
      expect(motivoDeRechazo(JORNADA, '12')).toBeUndefined();
    });

    it('acepta los extremos', () => {
      expect(motivoDeRechazo(JORNADA, '8')).toBeUndefined();
      expect(motivoDeRechazo(JORNADA, '16')).toBeUndefined();
    });

    it('rechaza por encima del máximo, nombrando el límite y su unidad', () => {
      const motivo = motivoDeRechazo(JORNADA, '30');
      expect(motivo).toBe(
        'El valor máximo admitido para JORNADA_MAXIMA_HORAS es 16 horas.',
      );
    });

    it('rechaza por debajo del mínimo', () => {
      expect(motivoDeRechazo(JORNADA, '4')).toContain('mínimo');
    });

    it('acepta decimales con coma o con punto', () => {
      expect(motivoDeRechazo(JORNADA, '10.5')).toBeUndefined();
      expect(motivoDeRechazo(JORNADA, '10,5')).toBeUndefined();
    });
  });

  describe('tipo declarado', () => {
    it('rechaza un decimal en un parámetro entero', () => {
      expect(motivoDeRechazo(TOPE, '3.5')).toContain('enteros');
    });

    it('rechaza texto en un parámetro numérico', () => {
      expect(motivoDeRechazo(TOPE, 'tres')).toContain('enteros');
    });

    it('rechaza el valor vacío', () => {
      expect(motivoDeRechazo(TOPE, '   ')).toContain('no puede quedar vacío');
    });

    it('acepta verdadero y falso en un booleano', () => {
      const bandera = parametro({ tipo: TipoParametro.BOOLEANO });
      expect(motivoDeRechazo(bandera, 'true')).toBeUndefined();
      expect(motivoDeRechazo(bandera, 'FALSE')).toBeUndefined();
      expect(motivoDeRechazo(bandera, 'quizá')).toContain('verdadero o falso');
    });
  });

  describe('dominio de los parámetros de texto', () => {
    const periodo = parametro({
      clave: 'PERIODO_COMPUTO_SALIDAS',
      tipo: TipoParametro.TEXTO,
    });

    it('acepta los tres períodos declarados', () => {
      for (const valor of ['SEMANAL', 'QUINCENAL', 'MENSUAL']) {
        expect(motivoDeRechazo(periodo, valor)).toBeUndefined();
      }
    });

    it('rechaza un período que no está en la lista', () => {
      expect(motivoDeRechazo(periodo, 'MENSUALMENTE')).toContain(
        'SEMANAL, QUINCENAL, MENSUAL',
      );
    });

    // `HORA_LIMITE_CUADRO` es hoy la única hora con dominio propio: el cierre de cada
    // ventana dejó de ser un parámetro el 2026-08-25 y vive en `t_ventana_carga`.
    const hora = parametro({
      clave: 'HORA_LIMITE_CUADRO',
      tipo: TipoParametro.TEXTO,
    });

    it('acepta una hora bien formada', () => {
      expect(motivoDeRechazo(hora, '15:00')).toBeUndefined();
      expect(motivoDeRechazo(hora, '00:00')).toBeUndefined();
      expect(motivoDeRechazo(hora, '23:59')).toBeUndefined();
    });

    it('rechaza una hora mal escrita: el evaluador de ventanas no podría leerla', () => {
      expect(motivoDeRechazo(hora, '15h00')).toContain('HH:MM');
      expect(motivoDeRechazo(hora, '25:00')).toContain('HH:MM');
      expect(motivoDeRechazo(hora, '3:00')).toContain('HH:MM');
    });

    it('no restringe un texto sin dominio declarado', () => {
      const libre = parametro({ clave: 'OTRO', tipo: TipoParametro.TEXTO });
      expect(motivoDeRechazo(libre, 'cualquier cosa')).toBeUndefined();
    });

    it('las ventanas de los turnos de la cobertura se validan como hora', () => {
      for (const clave of [
        'HORA_TURNO_DIURNO_INICIO',
        'HORA_TURNO_DIURNO_FIN',
        'HORA_TURNO_NOCTURNO_INICIO',
        'HORA_TURNO_NOCTURNO_FIN',
      ]) {
        const turno = parametro({ clave, tipo: TipoParametro.TEXTO });
        expect(motivoDeRechazo(turno, '17:30')).toBeUndefined();
        expect(motivoDeRechazo(turno, '17h30')).toContain('HH:MM');
      }
    });
  });
});

describe('motivoDeRechazo · parámetros de turnos de la DAF (2026-10-07)', () => {
  const texto = (clave: string) =>
    parametro({ clave, tipo: TipoParametro.TEXTO, valor: 'SIN_CONFIGURAR' });

  it.each(['DAF_MIN_CONDUCTORES_DIA', 'DAF_MIN_CONDUCTORES_NOCHE'])(
    '%s admite SIN_CONFIGURAR o siete enteros ≥ 0',
    (clave) => {
      expect(motivoDeRechazo(texto(clave), 'SIN_CONFIGURAR')).toBeUndefined();
      expect(motivoDeRechazo(texto(clave), '6,6,6,6,6,4,4')).toBeUndefined();
      expect(
        motivoDeRechazo(texto(clave), '0, 0, 0, 0, 0, 0, 0'),
      ).toBeUndefined();
      expect(motivoDeRechazo(texto(clave), '6,6,6,6,6,4')).toMatch(/siete/);
      expect(motivoDeRechazo(texto(clave), '6,6,6,6,6,4,-1')).toMatch(/siete/);
      expect(motivoDeRechazo(texto(clave), 'seis')).toMatch(/siete/);
    },
  );

  it('DAF_PERMITE_NOCHE_A_DIA admite SI, NO o SIN_CONFIGURAR', () => {
    const p = texto('DAF_PERMITE_NOCHE_A_DIA');
    expect(motivoDeRechazo(p, 'SI')).toBeUndefined();
    expect(motivoDeRechazo(p, 'no')).toBeUndefined();
    expect(motivoDeRechazo(p, 'SIN_CONFIGURAR')).toBeUndefined();
    expect(motivoDeRechazo(p, 'TAL VEZ')).toMatch(/SI, NO/);
  });
});
