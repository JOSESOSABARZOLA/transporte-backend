/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ventanas de carga
 * Archivo: reglas-ventana.spec.ts
 * Responsabilidad: Verificar qué se rechaza y qué se deja pasar de la propia ventana.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import { RolDepartamental, TipoVentana } from '@prisma/client';

import { motivoDeRechazo, type VentanaPropuesta } from './reglas-ventana';

const propuesta = (
  parcial: Partial<VentanaPropuesta> = {},
): VentanaPropuesta => ({
  rol: RolDepartamental.DMIP_OPERATIVOS,
  tipo: TipoVentana.DIARIO,
  diaApertura: null,
  horaApertura: null,
  diaCierre: null,
  horaCierre: '15:00',
  mensajeCierre: 'La ventana cerró a las 15H00. Vuelve a abrirse mañana.',
  activo: true,
  ...parcial,
});

describe('motivoDeRechazo', () => {
  it('admite la ventana departamental sembrada', () => {
    expect(motivoDeRechazo(propuesta())).toBeUndefined();
  });

  it('admite la ventana de la DAF, con apertura y cierre', () => {
    expect(
      motivoDeRechazo(
        propuesta({
          rol: RolDepartamental.DAF,
          horaApertura: '15:00',
          horaCierre: '16:30',
        }),
      ),
    ).toBeUndefined();
  });

  describe('forma de las horas y los días', () => {
    it('rechaza una hora mal escrita, diciendo cuál', () => {
      const motivo = motivoDeRechazo(propuesta({ horaCierre: '15h00' }));
      expect(motivo).toContain('cierre');
      expect(motivo).toContain('HH:MM');
    });

    it('rechaza una hora fuera del reloj de 24 horas', () => {
      expect(motivoDeRechazo(propuesta({ horaApertura: '25:00' }))).toContain(
        'HH:MM',
      );
    });

    it('rechaza un día fuera de 1 a 7', () => {
      expect(
        motivoDeRechazo(
          propuesta({
            tipo: TipoVentana.SEMANAL,
            diaApertura: 0,
            diaCierre: 2,
            horaApertura: '00:00',
          }),
        ),
      ).toContain('1 a 7');
    });

    it('admite la ventana semanal completa de la planificación zonal', () => {
      expect(
        motivoDeRechazo(
          propuesta({
            tipo: TipoVentana.SEMANAL,
            diaApertura: 5,
            horaApertura: '00:00',
            diaCierre: 2,
            horaCierre: '10:00',
          }),
        ),
      ).toBeUndefined();
    });
  });

  describe('coherencia de la propia ventana', () => {
    it('rechaza una semanal sin días: el evaluador la trataría como diaria', () => {
      expect(
        motivoDeRechazo(propuesta({ tipo: TipoVentana.SEMANAL })),
      ).toContain('DIARIO');
    });

    // 2026-10-07: una ventana que restringe necesita su cierre; para no restringir, SIN_RESTRICCION.
    it('rechaza una ventana sin hora de cierre', () => {
      expect(
        motivoDeRechazo(propuesta({ horaApertura: null, horaCierre: null })),
      ).toBe('Indique la hora de cierre.');
    });

    it('también una LABORABLE sin cierre', () => {
      expect(
        motivoDeRechazo(
          propuesta({ tipo: TipoVentana.LABORABLE, horaCierre: null }),
        ),
      ).toBe('Indique la hora de cierre.');
    });

    it('admite «sin restricción» sin horas ni mensaje: es el caso de Dirección', () => {
      expect(
        motivoDeRechazo(
          propuesta({
            rol: RolDepartamental.DIRECTOR,
            tipo: TipoVentana.SIN_RESTRICCION,
            horaApertura: null,
            horaCierre: null,
            mensajeCierre: '',
            activo: false,
          }),
        ),
      ).toBeUndefined();
    });

    it.each([
      ['16:30', '16:30'],
      ['17:00', '16:30'],
    ])(
      'rechaza apertura %s con cierre %s: el cierre va después',
      (horaApertura, horaCierre) => {
        expect(motivoDeRechazo(propuesta({ horaApertura, horaCierre }))).toBe(
          'La hora de cierre debe ser posterior a la de apertura.',
        );
      },
    );

    it('admite apertura antes del cierre', () => {
      expect(
        motivoDeRechazo(
          propuesta({ horaApertura: '07:00', horaCierre: '16:30' }),
        ),
      ).toBeUndefined();
    });

    it('exige el mensaje que verá el funcionario', () => {
      expect(motivoDeRechazo(propuesta({ mensajeCierre: '   ' }))).toContain(
        'mensaje',
      );
    });
  });
});
