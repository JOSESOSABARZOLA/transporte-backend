/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos · Trámites de Inspección
 * Archivo: tramites-inspeccion.service.spec.ts
 * Responsabilidad: Fijar el cruce por cédula, el filtro de inspectores y la doble actitud ante fallos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 */

import { AreaPersonal, RolDepartamental } from '@prisma/client';

import { ReglaNegocioError } from '../../../common/errors/errores-dominio';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import type { FuncionariosService } from '../../talento-operativo/application/funcionarios.service';
import type { PersonalElegibleService } from '../../talento-operativo/application/personal-elegible.service';
import {
  InspeccionNoDisponibleError,
  type AsignacionesDeInspector,
  type InspeccionTramitesClient,
} from '../infrastructure/inspeccion-tramites.client';
import { TramitesInspeccionService } from './tramites-inspeccion.service';

const tramite = (codigoTramite: string) => ({
  codigoTramite,
  nroSitra: null,
  predio: null,
  zonal: 'Los Chillos',
  materia: 'Espacio público',
  tipoTramite: 'DENUNCIA',
  estado: 'ASIGNADO',
});

const REGISTRO: AsignacionesDeInspector[] = [
  {
    cedula: '1700000004',
    inspector: 'Vizcaino Trujillo Mayra Rocio',
    tramites: [tramite('DENUNCIA-26-3415'), tramite('DENUNCIA-26-3413')],
  },
];

/** Fichas: 4 es inspectora General, 9 es de Unidad de Operativos. */
const FICHAS = {
  4: {
    id: 4,
    cedula: '1700000004',
    area: AreaPersonal.GENERAL,
    apellidos: 'VIZCAINO',
    nombres: 'MAYRA',
  },
  9: {
    id: 9,
    cedula: '1700000009',
    area: AreaPersonal.OPERATIVOS,
    apellidos: 'PEREZ',
    nombres: 'JUAN',
  },
} as const;

const TODAS_LAS_AREAS = Object.values(AreaPersonal);

const armar = (
  consultar = jest.fn().mockResolvedValue(REGISTRO),
  areasAsignables = jest.fn().mockResolvedValue(TODAS_LAS_AREAS),
) => {
  const obtenerVarios = jest
    .fn()
    .mockImplementation((ids: number[]) =>
      Promise.resolve(
        ids.flatMap((id) => (id in FICHAS ? [FICHAS[id as 4 | 9]] : [])),
      ),
    );
  const servicio = new TramitesInspeccionService(
    { consultar } as unknown as InspeccionTramitesClient,
    { obtenerVarios } as unknown as FuncionariosService,
    { areasAsignables } as unknown as PersonalElegibleService,
  );
  return { servicio, consultar, obtenerVarios, areasAsignables };
};

describe('TramitesInspeccionService · consultar', () => {
  it('cruza por cédula y solo ofrece trámites a los inspectores', async () => {
    const { servicio } = armar();

    const consulta = await servicio.consultar('2026-09-29', [4, 9], 'tok');

    expect(consulta.disponible).toBe(true);
    expect(consulta.personas).toEqual([
      {
        funcionarioId: 4,
        esInspector: true,
        tramites: [tramite('DENUNCIA-26-3415'), tramite('DENUNCIA-26-3413')],
      },
      { funcionarioId: 9, esInspector: false, tramites: [] },
    ]);
  });

  it('sin inspectores no pregunta a Inspección', async () => {
    const { servicio, consultar } = armar();

    const consulta = await servicio.consultar('2026-09-29', [9], 'tok');

    expect(consultar).not.toHaveBeenCalled();
    expect(consulta.disponible).toBe(true);
  });

  it('si Inspección no está, NO lanza: responde disponible=false con el motivo', async () => {
    const { servicio } = armar(
      jest
        .fn()
        .mockRejectedValue(
          new InspeccionNoDisponibleError(
            'El sistema de Inspección no respondió.',
          ),
        ),
    );

    const consulta = await servicio.consultar('2026-09-29', [4], 'tok');

    expect(consulta).toEqual({
      disponible: false,
      motivo: 'El sistema de Inspección no respondió.',
      personas: [{ funcionarioId: 4, esInspector: true, tramites: [] }],
    });
  });

  it('sin token de Auth en la sesión, lo dice sin llamar a Inspección', async () => {
    const { servicio, consultar } = armar();

    const consulta = await servicio.consultar('2026-09-29', [4], null);

    expect(consultar).not.toHaveBeenCalled();
    expect(consulta.disponible).toBe(false);
    expect(consulta.motivo).toContain('token de Auth central');
  });
});

describe('TramitesInspeccionService · copiasParaGuardar', () => {
  const solicitud = (
    codigoTramite: string,
    ficha: (typeof FICHAS)[4 | 9] = FICHAS[4],
  ) => ({
    funcionarioId: ficha.id,
    cedula: ficha.cedula,
    area: ficha.area,
    nombre: `${ficha.apellidos} ${ficha.nombres}`,
    codigoTramite,
  });

  it('devuelve la copia del trámite que de verdad es de esa persona', async () => {
    const { servicio } = armar();

    const copias = await servicio.copiasParaGuardar(
      '2026-09-29',
      [solicitud('DENUNCIA-26-3413')],
      'tok',
    );

    expect(copias.get(4)).toEqual(tramite('DENUNCIA-26-3413'));
  });

  it('un trámite que no es de esa persona se rechaza (lo que manda el navegador no se cree)', async () => {
    const { servicio } = armar();

    const fallo = await servicio
      .copiasParaGuardar('2026-09-29', [solicitud('ESCRITO-26-0489')], 'tok')
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(ReglaNegocioError);
    expect((fallo as ReglaNegocioError).code).toBe(
      CODIGOS_ERROR.TRAMITE_INSPECCION_NO_VALIDO,
    );
  });

  it('a quien no es inspector no se le guarda trámite, y ni se pregunta a Inspección', async () => {
    const { servicio, consultar } = armar();

    await expect(
      servicio.copiasParaGuardar(
        '2026-09-29',
        [solicitud('X', FICHAS[9])],
        'tok',
      ),
    ).rejects.toThrow('no es inspector');
    expect(consultar).not.toHaveBeenCalled();
  });

  it('si Inspección no está, guardar el trámite SÍ se rechaza (no se puede comprobar)', async () => {
    const { servicio } = armar(
      jest.fn().mockRejectedValue(new InspeccionNoDisponibleError('Caído.')),
    );

    const fallo = await servicio
      .copiasParaGuardar('2026-09-29', [solicitud('DENUNCIA-26-3415')], 'tok')
      .catch((error: unknown) => error);

    expect((fallo as ReglaNegocioError).code).toBe(
      CODIGOS_ERROR.INSPECCION_NO_DISPONIBLE,
    );
  });

  it('sin solicitudes no pregunta a nadie', async () => {
    const { servicio, consultar } = armar();

    const copias = await servicio.copiasParaGuardar('2026-09-29', [], 'tok');

    expect(copias.size).toBe(0);
    expect(consultar).not.toHaveBeenCalled();
  });
});

describe('TramitesInspeccionService · alcance, lote y caché', () => {
  it('busca las fichas en UNA consulta y omite los ids inexistentes (sin 404 de todo)', async () => {
    const { servicio, obtenerVarios } = armar();

    const consulta = await servicio.consultar('2026-09-29', [4, 777], 'tok');

    expect(obtenerVarios).toHaveBeenCalledTimes(1);
    expect(consulta.personas.map((p) => p.funcionarioId)).toEqual([4]);
  });

  it('omite a las personas que esos roles no pueden asignar (H-01)', async () => {
    const { servicio, areasAsignables } = armar(
      jest.fn().mockResolvedValue(REGISTRO),
      jest.fn().mockResolvedValue([AreaPersonal.OPERATIVOS]),
    );

    const consulta = await servicio.consultar('2026-09-29', [4, 9], 'tok', [
      RolDepartamental.DMIP_OPERATIVOS,
    ]);

    expect(areasAsignables).toHaveBeenCalledWith([
      RolDepartamental.DMIP_OPERATIVOS,
    ]);
    expect(consulta.personas.map((p) => p.funcionarioId)).toEqual([9]);
  });

  it('la Dirección no se acota', async () => {
    const { servicio, areasAsignables } = armar();

    const consulta = await servicio.consultar('2026-09-29', [4, 9], 'tok', [
      RolDepartamental.DIRECTOR,
    ]);

    expect(areasAsignables).not.toHaveBeenCalled();
    expect(consulta.personas).toHaveLength(2);
  });

  it('dos consultas seguidas con el mismo token y fecha llaman a Inspección UNA vez', async () => {
    const { servicio, consultar } = armar();

    await servicio.consultar('2026-09-29', [4], 'tok');
    await servicio.consultar('2026-09-29', [4, 9], 'tok');

    expect(consultar).toHaveBeenCalledTimes(1);
  });

  it('otro token u otra fecha no comparten la caché', async () => {
    const { servicio, consultar } = armar();

    await servicio.consultar('2026-09-29', [4], 'tok');
    await servicio.consultar('2026-09-29', [4], 'otro');
    await servicio.consultar('2026-09-30', [4], 'tok');

    expect(consultar).toHaveBeenCalledTimes(3);
  });

  it('la caché vence a los 60 s', async () => {
    const reloj = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { servicio, consultar } = armar();

    await servicio.consultar('2026-09-29', [4], 'tok');
    reloj.mockReturnValue(1_000_000 + 60_001);
    await servicio.consultar('2026-09-29', [4], 'tok');

    expect(consultar).toHaveBeenCalledTimes(2);
    reloj.mockRestore();
  });

  it('el GUARDADO no usa la caché: siempre vuelve a preguntar', async () => {
    const { servicio, consultar } = armar();

    await servicio.consultar('2026-09-29', [4], 'tok');
    await servicio.copiasParaGuardar(
      '2026-09-29',
      [
        {
          funcionarioId: 4,
          cedula: '1700000004',
          area: AreaPersonal.GENERAL,
          nombre: 'VIZCAINO MAYRA',
          codigoTramite: 'DENUNCIA-26-3415',
        },
      ],
      'tok',
    );

    expect(consultar).toHaveBeenCalledTimes(2);
  });

  it('cruza aunque la cédula traiga guiones o espacios, y une las filas repetidas', async () => {
    const { servicio } = armar(
      jest.fn().mockResolvedValue([
        { cedula: '17000-00004', inspector: 'X', tramites: [tramite('A-1')] },
        { cedula: '1700000004 ', inspector: 'X', tramites: [tramite('A-2')] },
      ]),
    );

    const consulta = await servicio.consultar('2026-09-29', [4], 'tok');

    expect(
      consulta.personas[0].tramites.map((fila) => fila.codigoTramite),
    ).toEqual(['A-1', 'A-2']);
  });
});
