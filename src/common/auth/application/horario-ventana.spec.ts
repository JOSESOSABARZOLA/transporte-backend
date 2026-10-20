/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: horario-ventana.spec.ts
 * Responsabilidad: Verificar el horario calculado de las ventanas.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 */

import type { RolDepartamental } from '@prisma/client';

import {
  horarioDeVentana,
  mensajeDeVentanaCerrada,
  ultimoCierreDeRegistro,
  type VentanaHoraria,
} from './horario-ventana';

const v = (
  rol: string,
  horaApertura: string | null,
  horaCierre: string | null,
  activo = true,
): VentanaHoraria => ({
  rol: rol as RolDepartamental,
  horaApertura,
  horaCierre,
  diaApertura: null,
  diaCierre: null,
  activo,
});

/** La configuración real de dev del 2026-10-06: registro hasta 18H25, DAF 18H25–18H28. */
const ACTUALES = [
  v('DMIP_OPERATIVOS', null, '18:25'),
  v('DMIP_INSPECCIONES', null, '18:25'),
  v('DMIT_INSTRUCTOR', null, '18:25'),
  v('DAF', '18:25', '18:28'),
];
const DAF = ACTUALES[3];

describe('horarioDeVentana', () => {
  it('DAF tras el registro: un solo horario con su motivo', () => {
    expect(horarioDeVentana(DAF, ACTUALES)).toEqual({
      texto:
        'La ventana de asignación de transporte abre a las 18H25, cuando cierra el registro de operativos, y cierra a las 18H28.',
      motivoApertura: 'cuando cierra el registro de operativos',
    });
  });

  it('DAF que abre DESPUÉS del registro: sin motivo', () => {
    const daf = v('DAF', '19:00', '20:30');
    expect(horarioDeVentana(daf, [...ACTUALES.slice(0, 3), daf])).toEqual({
      texto:
        'La ventana de asignación de transporte abre a las 19H00 y cierra a las 20H30.',
      motivoApertura: null,
    });
  });

  it('departamento: solo su cierre', () => {
    expect(horarioDeVentana(ACTUALES[0], ACTUALES).texto).toBe(
      'La ventana de carga de su departamento cierra a las 18H25.',
    );
  });

  it('sin ventana, inactiva o sin horas: sin restricción', () => {
    expect(horarioDeVentana(null, ACTUALES).texto).toBe(
      'Sin restricción horaria.',
    );
    expect(
      horarioDeVentana(v('DIRECTOR', null, null, false), ACTUALES).texto,
    ).toBe('Sin restricción horaria.');
    expect(horarioDeVentana(v('DIRECTOR', null, null), ACTUALES).texto).toBe(
      'Sin restricción horaria.',
    );
  });

  it('nunca menciona horas que no estén en la ventana (el bug del «15H00»)', () => {
    const textos = ACTUALES.map((ventana) =>
      horarioDeVentana(ventana, ACTUALES),
    ).map((horario) => horario.texto);
    for (const texto of textos) expect(texto).not.toContain('15H00');
  });
});

describe('mensajeDeVentanaCerrada', () => {
  it('DAF antes de abrir (17H00): cuándo abre y por qué', () => {
    expect(mensajeDeVentanaCerrada(DAF, ACTUALES, 17 * 60, 'viejo')).toBe(
      'La ventana de asignación de transporte abre a las 18H25, cuando cierra el registro de operativos, y cierra a las 18H28.',
    );
  });

  it('DAF después de cerrar (19H00): cerró y cuándo vuelve', () => {
    expect(mensajeDeVentanaCerrada(DAF, ACTUALES, 19 * 60, 'viejo')).toBe(
      'La ventana de asignación de transporte cerró a las 18H28. Vuelve a abrirse mañana a las 18H25, cuando cierra el registro de operativos.',
    );
  });

  it('departamento después de cerrar', () => {
    expect(
      mensajeDeVentanaCerrada(ACTUALES[0], ACTUALES, 19 * 60, 'viejo'),
    ).toBe(
      'La ventana de carga de su departamento cerró a las 18H25. Vuelve a abrirse mañana.',
    );
  });

  it('una ventana semanal (por días) conserva el texto del administrador', () => {
    const semanal = { ...ACTUALES[0], diaApertura: 1, diaCierre: 5 };
    expect(mensajeDeVentanaCerrada(semanal, ACTUALES, 600, 'texto admin')).toBe(
      'texto admin',
    );
  });
});

describe('ultimoCierreDeRegistro', () => {
  it('es el cierre más tardío de los departamentos activos (explica la apertura de la DAF)', () => {
    expect(ultimoCierreDeRegistro(ACTUALES)).toBe('18:25');
    expect(
      ultimoCierreDeRegistro([
        v('DMIP_OPERATIVOS', null, '12:55'),
        v('DMIP_INSPECCIONES', null, '14:00'),
        v('DMIT_INSTRUCTOR', null, '20:00', false),
        v('DAF', '11:44', '16:30'),
      ]),
    ).toBe('14:00');
  });
});
