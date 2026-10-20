/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · compartir unidad
 * Archivo: compatibilidad-compartir.service.spec.ts
 * Responsabilidad: Fijar cómo responde `transporte` a la pregunta del registro: ¿van juntos?
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-19
 */

import { TipoTransporte } from '@prisma/client';

import {
  RegistroCompatibilidadCompartir,
  type OperativoParaCompartir,
} from '../../operativos/application/compartir-transporte.puerto';
import type { PlanificacionTransporteRepository } from '../infrastructure/planificacion-transporte.repository';
import { CompatibilidadCompartirService } from './compatibilidad-compartir.service';
import type { ParametrosTransporteService } from './parametros-transporte.service';

const armar = () => {
  const registro = new RegistroCompatibilidadCompartir();
  const sectoresDeZonales = jest.fn().mockResolvedValue(
    new Map<number, string | null>([
      [1, 'NORTE'],
      [2, 'NORTE'],
      [3, 'SUR'],
    ]),
  );
  const servicio = new CompatibilidadCompartirService(
    registro,
    {
      leerCompartir: jest.fn().mockResolvedValue({
        duracionTramo: { dejar: 30, retirar: 30 },
        ventanaMin: 30,
        inicioJornada: '05:00',
      }),
    } as unknown as ParametrosTransporteService,
    { sectoresDeZonales } as unknown as PlanificacionTransporteRepository,
  );
  return { servicio, registro, sectoresDeZonales };
};

const operativo = (
  parcial: Partial<OperativoParaCompartir> = {},
): OperativoParaCompartir => ({
  horaInicio: '08:00',
  horaFin: '14:00',
  tipoTransporte: TipoTransporte.SOLO_INICIO,
  zonalId: 1,
  esMacrooperativo: false,
  identificador: 'OPE-001',
  ...parcial,
});

describe('CompatibilidadCompartirService', () => {
  it('se inscribe en el registro de operativos al iniciar el módulo', async () => {
    const { servicio, registro } = armar();
    servicio.onModuleInit();

    const [veredicto] = await registro.evaluar(operativo(), [
      operativo({ zonalId: 3 }),
    ]);

    expect(veredicto.compatible).toBe(false);
  });

  it('dos «solo dejar» a la misma hora y zonal van juntos', async () => {
    const { servicio } = armar();

    expect(await servicio.evaluar(operativo(), [operativo()])).toEqual([
      {
        compatible: true,
        comparte: ['dejar'],
        propios: [],
        comparteCon: [{ tipo: 'dejar', con: 'OPE-001' }],
      },
    ]);
  });

  it('«la misma unidad»: un «dejar y retirar» comparte el dejar con un «solo dejar»; el retiro queda propio', async () => {
    const { servicio } = armar();

    const [veredicto] = await servicio.evaluar(
      operativo({ tipoTransporte: TipoTransporte.INICIO_Y_FIN }),
      [operativo()],
    );

    expect(veredicto).toEqual({
      compatible: true,
      comparte: ['dejar'],
      propios: ['retirar'],
      comparteCon: [{ tipo: 'dejar', con: 'OPE-001' }],
    });
  });

  it('otra zonal del mismo sector, sí; de otro sector, no (con su motivo)', async () => {
    const { servicio } = armar();

    const [mismoSector, otroSector] = await servicio.evaluar(operativo(), [
      operativo({ zonalId: 2 }),
      operativo({ zonalId: 3 }),
    ]);

    expect(mismoSector.compatible).toBe(true);
    expect(otroSector).toEqual({
      compatible: false,
      motivo: expect.stringContaining('sector') as string,
    });
  });

  /*
   * CAMBIÓ el 2026-10-19 («retirar es otro estado»): antes era incompatible. El «solo dejar» de las
   * 08:00 no viaja con el «solo retirar» de las 13:30, pero tampoco se cruzan: la misma unidad lo
   * hace después (secuencial).
   */
  it('un «solo dejar» y un «solo retirar» que no se cruzan van en la misma unidad, uno después del otro', async () => {
    const { servicio } = armar();

    const [veredicto] = await servicio.evaluar(operativo(), [
      operativo({ tipoTransporte: TipoTransporte.SOLO_FIN }),
    ]);

    expect(veredicto).toEqual({
      compatible: true,
      comparte: [],
      propios: ['dejar'],
      comparteCon: [],
    });
  });

  it('el caso del 20-oct: un «solo retirar» junto a un «solo dejar» de las 08:00 usa la misma unidad para el retiro', async () => {
    const { servicio } = armar();

    const [veredicto] = await servicio.evaluar(
      operativo({ tipoTransporte: TipoTransporte.SOLO_FIN, horaFin: '16:30' }),
      [operativo({ horaFin: '16:30' })],
    );

    expect(veredicto).toEqual({
      compatible: true,
      comparte: [],
      propios: ['retirar'],
      comparteCon: [],
    });
  });

  /*
    CAMBIO DE REGLA (2026-10-20, «completo comparte unidad»): un «completo» en el mismo sitio ABARCA el
    «dejar» de la unidad (la unidad que lo acompaña todo el día deja al otro personal sin moverse).
    En otra zonal sigue sin poder ir en ella.
  */
  it('un «completo» en el mismo sitio abarca el «dejar» de la unidad; en otra zonal, no', async () => {
    const { servicio } = armar();

    const [mismoSitio] = await servicio.evaluar(
      operativo({ tipoTransporte: TipoTransporte.COMPLETO }),
      [operativo()],
    );
    expect(mismoSitio).toEqual({
      compatible: true,
      comparte: [],
      propios: [],
      comparteCon: [],
      contiene: ['dejar'],
    });

    const [otraZonal] = await servicio.evaluar(
      operativo({ tipoTransporte: TipoTransporte.COMPLETO, zonalId: 2 }),
      [operativo()],
    );
    expect(otraZonal).toMatchObject({ compatible: false });
  });

  it('un «solo dejar» y un «solo retirar» caen en el «completo» de la unidad: contenidoEn', async () => {
    const { servicio } = armar();

    const [veredicto] = await servicio.evaluar(
      operativo({
        tipoTransporte: TipoTransporte.INICIO_Y_FIN,
        horaFin: '16:30',
      }),
      [
        operativo({
          tipoTransporte: TipoTransporte.COMPLETO,
          horaFin: '16:30',
          identificador: 'OCPMO-005',
        }),
      ],
    );
    expect(veredicto).toMatchObject({
      compatible: true,
      comparte: [],
      propios: [],
      contenidoEn: 'OCPMO-005',
    });
  });

  it('el grupo A/B/C: un «solo retirar» C viaja con el retiro de B, que ya se unió a la unidad de A', async () => {
    const { servicio } = armar();
    const a = operativo({ identificador: 'OPE-001', horaFin: '16:30' });
    const b = operativo({
      identificador: 'OPE-002',
      tipoTransporte: TipoTransporte.INICIO_Y_FIN,
      horaFin: '16:30',
    });
    const c = operativo({
      identificador: 'OPE-003',
      tipoTransporte: TipoTransporte.SOLO_FIN,
      horaFin: '16:30',
    });

    const [veredicto] = await servicio.evaluar(c, [{ ...a, miembros: [b] }]);

    expect(veredicto).toEqual({
      compatible: true,
      comparte: ['retirar'],
      propios: [],
      comparteCon: [{ tipo: 'retirar', con: 'OPE-002' }],
    });
  });

  it('sin B en el grupo, C hace su retiro después del dejar de A (secuencial)', async () => {
    const { servicio } = armar();

    const [veredicto] = await servicio.evaluar(
      operativo({ tipoTransporte: TipoTransporte.SOLO_FIN, horaFin: '16:30' }),
      [operativo({ horaFin: '16:30' })],
    );

    expect(veredicto).toMatchObject({ comparte: [], propios: ['retirar'] });
  });

  it('pide los sectores de todas las zonales en UNA consulta', async () => {
    const { servicio, sectoresDeZonales } = armar();

    await servicio.evaluar(operativo(), [
      operativo({ zonalId: 2 }),
      operativo({ zonalId: 3 }),
    ]);

    expect(sectoresDeZonales).toHaveBeenCalledTimes(1);
    expect(sectoresDeZonales).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('sin anfitriones no consulta nada', async () => {
    const { servicio, sectoresDeZonales } = armar();

    expect(await servicio.evaluar(operativo(), [])).toEqual([]);
    expect(sectoresDeZonales).not.toHaveBeenCalled();
  });
});
