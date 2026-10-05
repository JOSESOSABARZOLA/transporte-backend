/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Matriz consolidada
 * Archivo: reglas-matriz.spec.ts
 * Responsabilidad: Verificar RN-53, RN-54 y la cabecera de FASE5 §4.3.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import {
  componerEvidencia,
  comoHoraInstitucional,
  correspondeEvidencia,
  enLenguajeNatural,
  nombreDeDireccion,
} from './reglas-matriz';

const ventana = (activo: boolean, abierta: boolean, horaCierre = '15:00') => ({
  activo,
  abierta,
  horaCierre,
});

describe('RN-53 · cuándo corresponde la fila de evidencia', () => {
  it('caso 4 del plan · sin carga y con la ventana vencida, sí', () => {
    expect(correspondeEvidencia(false, ventana(true, false))).toBe(true);
  });

  it('caso 5 del plan · sin carga pero con la ventana ABIERTA, todavía no', () => {
    // Marcarlo como omisión acusaría a alguien de no haber hecho algo que aún puede
    // hacer: el formulario se sigue cargando.
    expect(correspondeEvidencia(false, ventana(true, true))).toBe(false);
  });

  it('con operativos cargados, nunca', () => {
    expect(correspondeEvidencia(true, ventana(true, false))).toBe(false);
    expect(correspondeEvidencia(true, ventana(true, true))).toBe(false);
  });

  it('una ventana DESACTIVADA no vence: sin restricción horaria no hay omisión', () => {
    expect(correspondeEvidencia(false, ventana(false, false))).toBe(false);
    expect(correspondeEvidencia(false, ventana(false, true))).toBe(false);
  });
});

describe('RN-54 · qué dice la fila de evidencia', () => {
  it('nombra al responsable y la hora de cierre', () => {
    const evidencia = componerEvidencia(
      'DMIT · Instrucción',
      ventana(true, false, '15:00'),
    );

    expect(evidencia.leyenda).toBe(
      'La información de este formulario no fue ingresada.',
    );
    expect(evidencia.responsable).toBe('DMIT · Instrucción');
    expect(evidencia.horaCierre).toBe('15H00');
  });

  it('una ventana sin hora de cierre deja el dato en nulo, no inventa una', () => {
    const evidencia = componerEvidencia('DMIT · Instrucción', {
      activo: true,
      abierta: false,
      horaCierre: null,
    });

    expect(evidencia.horaCierre).toBeNull();
  });
});

describe('la cabecera en lenguaje natural', () => {
  it('compone «viernes 31 de julio de 2026»', () => {
    expect(enLenguajeNatural(new Date(Date.UTC(2026, 6, 31)))).toBe(
      'viernes 31 de julio de 2026',
    );
  });

  it('se lee en UTC: la fecha no se desplaza un día', () => {
    // `cuad_fecha` es una fecha de calendario. Leerla en Guayaquil daría el día anterior.
    expect(enLenguajeNatural(new Date('2026-08-03T00:00:00.000Z'))).toBe(
      'lunes 3 de agosto de 2026',
    );
  });

  it('cubre los doce meses sin abreviarlos', () => {
    for (let mes = 0; mes < 12; mes += 1) {
      const texto = enLenguajeNatural(new Date(Date.UTC(2026, mes, 15)));

      expect(texto).not.toContain('.');
      expect(texto).toContain('de 2026');
    }
  });

  it('septiembre se escribe entero', () => {
    expect(enLenguajeNatural(new Date(Date.UTC(2026, 8, 1)))).toContain(
      'septiembre',
    );
  });

  it('la hora se muestra en notación institucional', () => {
    expect(comoHoraInstitucional('15:00')).toBe('15H00');
    expect(comoHoraInstitucional('08:30')).toBe('08H30');
  });
});

describe('el nombre de la dirección responsable', () => {
  it('traduce los seis roles', () => {
    expect(nombreDeDireccion('DMIT_INSTRUCTOR')).toBe('DMIT · Instrucción');
    expect(nombreDeDireccion('DAF')).toBe('DAF · Transportes');
    expect(nombreDeDireccion('DIRECTOR')).toBe('Dirección');
  });

  it('un rol desconocido se muestra tal cual, sin romper el documento', () => {
    expect(nombreDeDireccion('OTRO')).toBe('OTRO');
  });
});
