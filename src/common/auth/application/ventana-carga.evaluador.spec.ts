/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: ventana-carga.evaluador.spec.ts
 * Responsabilidad: Verificar la evaluación horaria, incluido el cruce de medianoche
 *                  y la independencia de la zona del servidor.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import {
  RolDepartamental,
  TipoVentana,
  type VentanaCarga,
} from '@prisma/client';

import { VentanaCargaEvaluador } from './ventana-carga.evaluador';

const ventana = (parcial: Partial<VentanaCarga>): VentanaCarga =>
  ({
    id: 1,
    rol: RolDepartamental.DMIP_OPERATIVOS,
    tipo: TipoVentana.DIARIO,
    diaApertura: null,
    horaApertura: null,
    diaCierre: null,
    horaCierre: null,
    zonaHoraria: 'America/Guayaquil',
    mensajeCierre: 'La ventana de carga cerró.',
    activo: true,
    ...parcial,
  }) as VentanaCarga;

/** 14:00 en Guayaquil son las 19:00 UTC. */
const A_LAS = (horaGuayaquil: number, minutos = 0): Date =>
  new Date(Date.UTC(2026, 7, 5, horaGuayaquil + 5, minutos));

describe('VentanaCargaEvaluador', () => {
  const evaluador = new VentanaCargaEvaluador();

  it('sin ventana configurada no hay restricción', () => {
    expect(evaluador.evaluar(null).puedeEscribir).toBe(true);
  });

  it('una ventana desactivada no restringe', () => {
    const resultado = evaluador.evaluar(
      ventana({ activo: false, horaCierre: '15:00' }),
      A_LAS(20),
    );
    expect(resultado.puedeEscribir).toBe(true);
  });

  describe('ventana departamental: cierre a las 15H00, sin hora de apertura', () => {
    const departamental = ventana({
      horaApertura: null,
      horaCierre: '15:00',
      mensajeCierre:
        'La ventana de carga de su departamento cerró a las 15H00. Vuelve a abrirse mañana.',
    });

    it('permite a las 14H00', () => {
      expect(evaluador.evaluar(departamental, A_LAS(14)).puedeEscribir).toBe(
        true,
      );
    });

    it('rechaza a las 15H30, con el mensaje de la ventana', () => {
      const resultado = evaluador.evaluar(departamental, A_LAS(15, 30));
      expect(resultado.puedeEscribir).toBe(false);
      expect(resultado.motivo).toContain('15H00');
      expect(resultado.horaCierre).toBe('15:00');
    });

    it('rechaza justo a las 15H00: el cierre no es inclusivo', () => {
      expect(evaluador.evaluar(departamental, A_LAS(15)).puedeEscribir).toBe(
        false,
      );
    });
  });

  describe('ventana de la DAF: de 15H00 a 16H30', () => {
    const daf = ventana({
      rol: RolDepartamental.DAF,
      horaApertura: '15:00',
      horaCierre: '16:30',
    });

    it('rechaza a las 14H00, antes de su turno', () => {
      expect(evaluador.evaluar(daf, A_LAS(14)).puedeEscribir).toBe(false);
    });

    it('permite a las 15H30', () => {
      expect(evaluador.evaluar(daf, A_LAS(15, 30)).puedeEscribir).toBe(true);
    });

    it('rechaza a las 17H00, pasado el cierre', () => {
      expect(evaluador.evaluar(daf, A_LAS(17)).puedeEscribir).toBe(false);
    });
  });

  describe('cruce de medianoche', () => {
    // Es el mismo riesgo que RangoHorario: la hora de cierre es MENOR que la de
    // apertura, y compararlas sin contemplarlo da resultados incorrectos en silencio.
    const nocturna = ventana({ horaApertura: '20:00', horaCierre: '05:00' });

    it('permite a las 22H00', () => {
      expect(evaluador.evaluar(nocturna, A_LAS(22)).puedeEscribir).toBe(true);
    });

    it('permite a las 02H00, ya pasada la medianoche', () => {
      expect(evaluador.evaluar(nocturna, A_LAS(2)).puedeEscribir).toBe(true);
    });

    it('rechaza a las 12H00, en mitad del día', () => {
      expect(evaluador.evaluar(nocturna, A_LAS(12)).puedeEscribir).toBe(false);
    });
  });

  it('evalúa en la zona de la ventana y no en la del proceso', () => {
    // El mismo instante: 19H00 UTC son las 14H00 en Guayaquil y las 21H00 en Madrid.
    const instante = new Date('2026-08-05T19:00:00Z');
    const cierraA15 = { horaApertura: null, horaCierre: '15:00' };

    expect(
      evaluador.evaluar(
        ventana({ ...cierraA15, zonaHoraria: 'America/Guayaquil' }),
        instante,
      ).puedeEscribir,
    ).toBe(true);

    expect(
      evaluador.evaluar(
        ventana({ ...cierraA15, zonaHoraria: 'Europe/Madrid' }),
        instante,
      ).puedeEscribir,
    ).toBe(false);
  });

  describe('ventana semanal, con día de apertura y de cierre', () => {
    // La forma que describen las fuentes para la planificación zonal:
    // viernes 00H00 a martes 10H00.
    const semanal = ventana({
      tipo: TipoVentana.SEMANAL,
      diaApertura: 5,
      horaApertura: '00:00',
      diaCierre: 2,
      horaCierre: '10:00',
    });

    const EL_DIA = (diaIso: number, hora: number): Date =>
      new Date(Date.UTC(2026, 7, 2 + diaIso, hora + 5));

    it('permite el sábado', () => {
      expect(evaluador.evaluar(semanal, EL_DIA(6, 12)).puedeEscribir).toBe(
        true,
      );
    });

    it('permite el lunes', () => {
      expect(evaluador.evaluar(semanal, EL_DIA(1, 12)).puedeEscribir).toBe(
        true,
      );
    });

    it('rechaza el miércoles', () => {
      expect(evaluador.evaluar(semanal, EL_DIA(3, 12)).puedeEscribir).toBe(
        false,
      );
    });
  });
});
