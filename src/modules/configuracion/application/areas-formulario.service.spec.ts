/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: areas-formulario.service.spec.ts
 * Responsabilidad: Verificar las dos puertas del cambio de áreas admitidas.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-27
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LO QUE ESTE ARCHIVO PROTEGE SON DOS RECHAZOS, NO UNA ESCRITURA.
 *
 * Escribir el conjunto de áreas es trivial. Lo que no lo es son los dos estados que hay
 * que impedir, y los dos comparten la misma propiedad: **no parecen un fallo**.
 *
 *   · Un formulario sin áreas devuelve un selector de personal vacío y ningún mensaje.
 *   · Un área retirada con gente ya asignada deja esas asignaciones en pie, amparadas por
 *     una regla que acaba de dejar de existir.
 *
 * Y una tercera cosa que se prueba porque se perdería en silencio: `farea_es_compartida`
 * **se conserva** en las áreas que siguen. Borrar todo y recrear habría sido más corto y
 * habría dejado al DMIT sin poder aportar en REACN.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { AreaPersonal } from '@prisma/client';

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import type { LoggerService } from '../../../common/logger/logger.service';
import type {
  AsignacionQueEstorba,
  FormularioConAreas,
  FormulariosRepository,
} from '../infrastructure/formularios.repository';
import { AreasFormularioService } from './areas-formulario.service';

const USUARIO = 7;

const formulario = (
  areas: { area: AreaPersonal; esCompartida: boolean }[],
): FormularioConAreas =>
  ({
    id: 244,
    codigo: 'REACN',
    nombre: 'PATRULLA REACCIÓN NOCTURNA',
    areas: areas.map((fila) => ({ formularioId: 244, ...fila })),
    roles: [],
  }) as unknown as FormularioConAreas;

const LAS_TRES = [
  { area: AreaPersonal.GENERAL, esCompartida: false },
  { area: AreaPersonal.TECNICO, esCompartida: false },
  { area: AreaPersonal.INSTRUCCION, esCompartida: true },
];

const armar = (
  opciones: {
    actual?: FormularioConAreas | null;
    estorban?: AsignacionQueEstorba[];
  } = {},
) => {
  const { actual = formulario(LAS_TRES), estorban = [] } = opciones;

  const buscarPorCodigo = jest.fn().mockResolvedValue(actual);
  const asignacionesEnAreas = jest.fn().mockResolvedValue(estorban);
  const igualarAreas = jest.fn().mockResolvedValue(undefined);
  const ejecutarEnTransaccion = jest
    .fn()
    .mockImplementation((operacion: (c: unknown) => Promise<unknown>) =>
      operacion({}),
    );
  const registrar = jest.fn();
  const log = jest.fn();

  const servicio = new AreasFormularioService(
    {
      buscarPorCodigo,
      asignacionesEnAreas,
      igualarAreas,
      ejecutarEnTransaccion,
    } as unknown as FormulariosRepository,
    { registrar } as unknown as AuditoriaService,
    { log } as unknown as LoggerService,
  );

  return {
    servicio,
    buscarPorCodigo,
    asignacionesEnAreas,
    igualarAreas,
    registrar,
  };
};

const capturar = async (promesa: Promise<unknown>): Promise<unknown> => {
  try {
    await promesa;
    return null;
  } catch (fallo) {
    return fallo;
  }
};

describe('AreasFormularioService · un formulario no se queda sin áreas', () => {
  it('la lista vacía se rechaza explicando la consecuencia', async () => {
    const { servicio, igualarAreas } = armar();

    const fallo = await capturar(servicio.reemplazar('REACN', [], USUARIO));

    expect(fallo).toBeInstanceOf(ValidacionError);
    // El mensaje tiene que decir QUÉ pasa, no solo que no se puede: es el estado que no
    // parece un fallo.
    expect((fallo as ValidacionError).message).toContain(
      'selector de personal',
    );
    expect(igualarAreas).not.toHaveBeenCalled();
  });
});

describe('AreasFormularioService · no se retira un área con gente asignada', () => {
  it('rechaza NOMBRANDO los operativos afectados', async () => {
    const { servicio, igualarAreas } = armar({
      estorban: [
        {
          identificador: 'ICNECU-001-27-AGO-2026',
          area: AreaPersonal.TECNICO,
          persona: 'SEGOVIA MARIA',
        },
        {
          identificador: 'ICNECU-002-27-AGO-2026',
          area: AreaPersonal.TECNICO,
          persona: 'BENAVIDES FERNANDO',
        },
      ],
    });

    const fallo = await capturar(
      servicio.reemplazar(
        'REACN',
        [AreaPersonal.GENERAL, AreaPersonal.INSTRUCCION],
        USUARIO,
      ),
    );

    expect(fallo).toBeInstanceOf(ValidacionError);
    // Nombrarlos es la mitad útil del rechazo: sin ellos hay que buscarlos a mano.
    expect((fallo as ValidacionError).message).toContain(
      'ICNECU-001-27-AGO-2026',
    );
    expect((fallo as ValidacionError).message).toContain(
      'ICNECU-002-27-AGO-2026',
    );
    expect((fallo as ValidacionError).message).toContain('TECNICO');
    expect(igualarAreas).not.toHaveBeenCalled();
  });

  it('solo se pregunta por las áreas que de verdad se retiran', async () => {
    // Es la que discrimina: preguntar por todas devolvería siempre a alguien y bloquearía
    // hasta un cambio que no quita nada.
    const { servicio, asignacionesEnAreas } = armar();

    await servicio.reemplazar(
      'REACN',
      [AreaPersonal.GENERAL, AreaPersonal.INSTRUCCION],
      USUARIO,
    );

    expect(asignacionesEnAreas).toHaveBeenCalledWith(244, [
      AreaPersonal.TECNICO,
    ]);
  });

  it('agregar un área no consulta a nadie, porque no descuelga a nadie', async () => {
    const { servicio, asignacionesEnAreas, igualarAreas } = armar();

    await servicio.reemplazar(
      'REACN',
      [
        AreaPersonal.GENERAL,
        AreaPersonal.TECNICO,
        AreaPersonal.INSTRUCCION,
        AreaPersonal.OPERATIVOS,
      ],
      USUARIO,
    );

    expect(asignacionesEnAreas).not.toHaveBeenCalled();
    expect(igualarAreas).toHaveBeenCalled();
  });

  it('el histórico no estorba: solo se mira la jornada viva', async () => {
    // La consulta la acota el repositorio a los cuadros que no están CERRADOS. Aquí se
    // afirma el contrato: sin asignaciones vivas, el cambio pasa.
    const { servicio, igualarAreas } = armar({ estorban: [] });

    await servicio.reemplazar(
      'REACN',
      [AreaPersonal.GENERAL, AreaPersonal.INSTRUCCION],
      USUARIO,
    );

    expect(igualarAreas).toHaveBeenCalledWith(
      244,
      [AreaPersonal.GENERAL, AreaPersonal.INSTRUCCION],
      expect.anything(),
    );
  });
});

describe('AreasFormularioService · lo que se escribe y lo que queda', () => {
  it('los repetidos del cliente no llegan a la base', async () => {
    const { servicio, igualarAreas } = armar();

    await servicio.reemplazar(
      'REACN',
      [
        AreaPersonal.GENERAL,
        AreaPersonal.GENERAL,
        AreaPersonal.TECNICO,
        AreaPersonal.INSTRUCCION,
      ],
      USUARIO,
    );

    expect(igualarAreas).toHaveBeenCalledWith(
      244,
      [AreaPersonal.GENERAL, AreaPersonal.TECNICO, AreaPersonal.INSTRUCCION],
      expect.anything(),
    );
  });

  it('el cambio queda en la traza, con lo que había y lo que quedó', async () => {
    const { servicio, registrar } = armar();

    await servicio.reemplazar(
      'REACN',
      [AreaPersonal.GENERAL, AreaPersonal.INSTRUCCION],
      USUARIO,
    );

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_formulario_area',
        entidadId: 244,
        usuario: USUARIO,
        cambios: [
          expect.objectContaining({
            valorAnterior: 'GENERAL, INSTRUCCION, TECNICO',
            valorNuevo: 'GENERAL, INSTRUCCION',
          }),
        ],
      }),
      expect.anything(),
    );
  });

  it('un formulario que no existe se dice, no se crea', async () => {
    const { servicio } = armar({ actual: null });

    const fallo = await capturar(
      servicio.reemplazar('NOEXISTE', [AreaPersonal.GENERAL], USUARIO),
    );

    expect(fallo).toBeInstanceOf(RecursoNoEncontradoError);
  });
});
