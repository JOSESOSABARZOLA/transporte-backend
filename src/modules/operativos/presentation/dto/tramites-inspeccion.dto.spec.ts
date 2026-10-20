/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos · Trámites de Inspección
 * Archivo: tramites-inspeccion.dto.spec.ts
 * Responsabilidad: Fijar la validación de la consulta de trámites y del trámite elegido.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 */

import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CrearOperativoDto } from './operativo.dto';
import { ConsultarTramitesDto } from './tramites-inspeccion.dto';

const errores = async (
  clase: new () => object,
  cuerpo: Record<string, unknown>,
): Promise<string[]> => {
  const instancia = plainToInstance(clase, cuerpo);
  const fallos = await validate(instancia, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return fallos.flatMap((fallo) => [
    fallo.property,
    ...(fallo.children ?? []).map((hijo) => hijo.property),
  ]);
};

describe('ConsultarTramitesDto', () => {
  it('una fecha con formato correcto pero inexistente se rechaza', async () => {
    expect(
      await errores(ConsultarTramitesDto, {
        fecha: '2026-02-30',
        funcionarioId: '4',
      }),
    ).toContain('fecha');
    expect(
      await errores(ConsultarTramitesDto, {
        fecha: '2026-09-29',
        funcionarioId: '4',
      }),
    ).toEqual([]);
  });

  it('un solo funcionarioId (texto en la cadena de consulta) se vuelve lista', async () => {
    const dto = plainToInstance(ConsultarTramitesDto, {
      fecha: '2026-09-29',
      funcionarioId: '4',
    });
    expect(dto.funcionarioId).toEqual([4]);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('varios funcionarioId repetidos o separados por coma', () => {
    expect(
      plainToInstance(ConsultarTramitesDto, {
        fecha: '2026-09-29',
        funcionarioId: ['4', '9,12'],
      }).funcionarioId,
    ).toEqual([4, 9, 12]);
  });

  it('rechaza una fecha mal escrita y un id que no es número', async () => {
    const fallos = await errores(ConsultarTramitesDto, {
      fecha: '29/09/2026',
      funcionarioId: 'abc',
    });
    expect(fallos).toEqual(expect.arrayContaining(['fecha', 'funcionarioId']));
  });
});

describe('CrearOperativoDto · tramiteInspeccion por persona', () => {
  const BASE = {
    cuadroFecha: '2026-09-29',
    formularioCodigo: 'INSP',
    zonalesIds: [1],
    institucionesIds: [],
  };

  it('acepta el código del trámite en la persona', async () => {
    const fallos = await errores(CrearOperativoDto, {
      ...BASE,
      personal: [
        {
          funcionarioId: 4,
          horaInicio: '08:00',
          horaFin: '12:00',
          tramiteInspeccion: { codigoTramite: 'DENUNCIA-26-3415' },
        },
      ],
    });
    expect(fallos).not.toContain('personal');
  });

  it('solo viaja el código: un campo más del trámite se rechaza', async () => {
    const fallos = await errores(CrearOperativoDto, {
      ...BASE,
      personal: [
        {
          funcionarioId: 4,
          horaInicio: '08:00',
          horaFin: '12:00',
          tramiteInspeccion: { codigoTramite: 'X', nroSitra: 'inventado' },
        },
      ],
    });
    expect(fallos).toContain('personal');
  });
});
