/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: orden-servicio.dto.spec.ts
 * Responsabilidad: Verificar el estado derivado, los faltantes, el número y el firmante de la orden.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-01 · estado único y numeración el 2026-10-02
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * UNA SOLA FUENTE DE VERDAD (A). El estado (VIGENTE/BORRADOR/REEMPLAZADA), el número oficial AMC-OS
 * y el firmante congelado se derivan en `application/estado-orden` y el DTO solo los expone. Los
 * FALTANTES los calcula `resolverTokens` (ver `resolver-tokens.spec.ts`), de modo que `estadoDeOrden`
 * los recibe ya resueltos. `numeroOrden` NO es un faltante: se asigna solo al quedar Vigente (D14/G14).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  estadoDeOrden,
  firmanteDeOrden,
  formatearNumeroOrden,
  versionDeCodigo,
} from '../../application/estado-orden';
import type { OrdenConOperativo } from '../../infrastructure/orden-servicio.repository';
import { aOrdenServicioResponse } from './orden-servicio.dto';

const FIRMANTE_OK = {
  nombre: 'PÉREZ JUAN',
  cargo: 'DIRECTOR',
  dependencia: 'AMC',
};

describe('estadoDeOrden', () => {
  it('no vigente → REEMPLAZADA, aunque esté completa', () => {
    expect(estadoDeOrden(false, [], true)).toBe('REEMPLAZADA');
  });

  it('vigente con faltantes → BORRADOR (aunque conserve un número reservado)', () => {
    const faltantes = [
      {
        token: 'elaboradoPor',
        etiqueta: 'Elaborado por',
        origen: 'plantilla' as const,
      },
    ];
    expect(estadoDeOrden(true, faltantes, false)).toBe('BORRADOR');
    expect(estadoDeOrden(true, faltantes, true)).toBe('BORRADOR');
  });

  it('vigente, sin faltantes y CON número → VIGENTE', () => {
    expect(estadoDeOrden(true, [], true)).toBe('VIGENTE');
  });

  it('vigente sin faltantes pero SIN número → BORRADOR (aún no se numeró)', () => {
    expect(estadoDeOrden(true, [], false)).toBe('BORRADOR');
  });
});

describe('aOrdenServicioResponse (plantilla por Director, 2026-10-05)', () => {
  const ordenBase = (parcial: Record<string, unknown>) =>
    ({
      codigo: 'OS-OCF-001-02-OCT-2026-193-2',
      emitidaEn: new Date('2026-10-02T18:00:00Z'),
      vigente: true,
      numeroAnio: 2026,
      numeroSecuencial: 5575,
      firmante: FIRMANTE_OK,
      directorId: 14,
      plantillaVersion: 3,
      datoAislado: {
        horario: '08H00 A 16H00',
        funcionario: 'YUNDA JESSICA',
        conductor: null,
        placa: null,
      },
      operativo: { cuadro: { fecha: new Date('2026-10-02T00:00:00Z') } },
      ...parcial,
    }) as unknown as OrdenConOperativo;
  const contexto = {
    usuarioId: 14,
    nombresDirectores: new Map([[14, 'De La Guerra Portugal Lider Franklin']]),
  };

  it('un BORRADOR nunca expone número, aunque tenga uno reservado (H36)', () => {
    const dto = aOrdenServicioResponse(
      ordenBase({}),
      [
        {
          token: 'elaboradoPor',
          etiqueta: 'Elaborado por',
          origen: 'plantilla',
        },
      ],
      contexto,
    );
    expect(dto.estado).toBe('BORRADOR');
    expect(dto.numeroOrden).toBeNull();
  });

  it('una VIGENTE completa expone su número AMC-OS', () => {
    const dto = aOrdenServicioResponse(ordenBase({}), [], contexto);
    expect(dto.estado).toBe('VIGENTE');
    expect(dto.numeroOrden).toBe('AMC-OS-00005575-2026');
  });

  it('dice quién la generó, si es propia y con qué versión de plantilla', () => {
    const propia = aOrdenServicioResponse(ordenBase({}), [], contexto);
    expect(propia.directorId).toBe(14);
    expect(propia.directorNombre).toBe('De La Guerra Portugal Lider Franklin');
    expect(propia.esPropia).toBe(true);
    expect(propia.plantillaVersion).toBe(3);

    const ajena = aOrdenServicioResponse(ordenBase({}), [], {
      ...contexto,
      usuarioId: 99,
    });
    expect(ajena.esPropia).toBe(false);
  });
});

describe('formatearNumeroOrden', () => {
  it('compone AMC-OS-<8 dígitos>-<año>', () => {
    expect(formatearNumeroOrden(2026, 5572)).toBe('AMC-OS-00005572-2026');
  });

  it('sin número asignado (borrador), devuelve null', () => {
    expect(formatearNumeroOrden(null, null)).toBeNull();
    expect(formatearNumeroOrden(2026, null)).toBeNull();
  });
});

describe('versionDeCodigo', () => {
  it('lee el número de emisión del sufijo del código interno', () => {
    expect(versionDeCodigo('OS-ICNECU-001-31-JUL-2026-101-1')).toBe(1);
    expect(versionDeCodigo('OS-ICNECU-001-31-JUL-2026-101-2')).toBe(2);
  });

  it('un sufijo no numérico cae a la versión 1', () => {
    expect(versionDeCodigo('OS-SIN-SUFIJO-X')).toBe(1);
  });
});

describe('firmanteDeOrden', () => {
  it('devuelve los tres textos del firmante persistido', () => {
    expect(firmanteDeOrden(FIRMANTE_OK)).toEqual({
      nombre: 'PÉREZ JUAN',
      cargo: 'DIRECTOR',
      dependencia: 'AMC',
    });
  });

  it('sin firmante guardado, devuelve null', () => {
    expect(firmanteDeOrden(null)).toBeNull();
  });
});
