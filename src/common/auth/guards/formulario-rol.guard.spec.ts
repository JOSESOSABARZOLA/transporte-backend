/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: formulario-rol.guard.spec.ts
 * Responsabilidad: Verificar PER-01, incluida la petición manipulada.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import { Reflector } from '@nestjs/core';
import { RolDepartamental } from '@prisma/client';

import { AutorizacionError } from '../../errors/errores-dominio';
import { FormularioRolGuard } from './formulario-rol.guard';
import type {
  AutorizacionFormulario,
  FormularioAutorizacionRepository,
} from '../infrastructure/formulario-autorizacion.repository';

const FIJOS: AutorizacionFormulario = {
  codigo: 'FIJOS',
  nombre: 'OPERATIVOS DE CONTROL FIJOS',
  rolDueno: RolDepartamental.DMIP_OPERATIVOS,
  roles: [
    { rol: RolDepartamental.DMIP_OPERATIVOS, acceso: 'ESCRITURA', cupo: null },
  ],
  activo: true,
};

const REACCION_NOCTURNA: AutorizacionFormulario = {
  codigo: 'REACN',
  nombre: 'PATRULLA REACCIÓN NOCTURNA',
  rolDueno: RolDepartamental.DMIP_INSPECCIONES,
  roles: [
    {
      rol: RolDepartamental.DMIP_INSPECCIONES,
      acceso: 'ESCRITURA',
      cupo: null,
    },
    { rol: RolDepartamental.DMIT_INSTRUCTOR, acceso: 'APORTA', cupo: 1 },
  ],
  activo: true,
};

/** Formulario 4 desde el 2026-08-25: **dos departamentos que registran**. */
const PATRULLA_ECU: AutorizacionFormulario = {
  codigo: 'ECU',
  nombre: 'PATRULLA ECU DIURNA',
  rolDueno: RolDepartamental.DMIP_OPERATIVOS,
  roles: [
    { rol: RolDepartamental.DMIP_OPERATIVOS, acceso: 'ESCRITURA', cupo: null },
    { rol: RolDepartamental.DMIT_INSTRUCTOR, acceso: 'ESCRITURA', cupo: null },
  ],
  activo: true,
};

describe('FormularioRolGuard', () => {
  const armar = (
    formulario: AutorizacionFormulario | null,
    ubicacion: unknown = { origen: 'body', propiedad: 'formularioCodigo' },
  ) => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(ubicacion),
    } as unknown as Reflector;
    // Se conserva la referencia a la función simulada aparte del objeto: pasar
    // `repositorio.buscarPorCodigo` a expect() desligaría el método de su objeto.
    const buscarPorCodigo = jest.fn().mockResolvedValue(formulario);
    const repositorio = {
      buscarPorCodigo,
    } as unknown as FormularioAutorizacionRepository;
    return {
      guarda: new FormularioRolGuard(reflector, repositorio),
      buscarPorCodigo,
    };
  };

  const contextoCon = (peticion: unknown) =>
    ({
      switchToHttp: () => ({ getRequest: () => peticion }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as never;

  it('permite al rol dueño', async () => {
    const { guarda } = armar(FIJOS);
    await expect(
      guarda.canActivate(
        contextoCon({
          body: { formularioCodigo: 'FIJOS' },
          user: {
            rol: RolDepartamental.DMIP_OPERATIVOS,
            roles: [RolDepartamental.DMIP_OPERATIVOS],
          },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('rechaza al rol que no es dueño, con FORMULARIO_NO_AUTORIZADO', async () => {
    const { guarda } = armar(FIJOS);
    await expect(
      guarda.canActivate(
        contextoCon({
          body: { formularioCodigo: 'FIJOS' },
          user: {
            rol: RolDepartamental.DMIT_INSTRUCTOR,
            roles: [RolDepartamental.DMIT_INSTRUCTOR],
          },
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORMULARIO_NO_AUTORIZADO',
    });
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * DOS DEPARTAMENTOS ESCRIBEN EN EL MISMO FORMULARIO. 2026-08-25.
   *
   * Es lo que `t_formulario_rol` vino a permitir, y lo que dos columnas no podían decir.
   * Se comprueban los dos, y se comprueba **con qué sombrero queda cada uno**: de ahí
   * salen `oper_creado_por_rol` y la ventana de carga que se le aplica. Si el
   * estrechamiento se equivocara, el DMIT registraría bajo la ventana del DMIP y su
   * propio horario dejaría de significar nada.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  it('permite a los DOS departamentos que registran la patrulla ECU', async () => {
    for (const rol of [
      RolDepartamental.DMIP_OPERATIVOS,
      RolDepartamental.DMIT_INSTRUCTOR,
    ]) {
      const { guarda } = armar(PATRULLA_ECU);
      const usuario = { rol: RolDepartamental.DAF, roles: [rol] };

      await expect(
        guarda.canActivate(
          contextoCon({ body: { formularioCodigo: 'ECU' }, user: usuario }),
        ),
      ).resolves.toBe(true);

      // El sombrero con el que se escribe es el que participa, no el de partida.
      expect(usuario.rol).toBe(rol);
    }
  });

  it('sigue rechazando a un tercero en la ECU', async () => {
    const { guarda } = armar(PATRULLA_ECU);
    await expect(
      guarda.canActivate(
        contextoCon({
          body: { formularioCodigo: 'ECU' },
          user: {
            rol: RolDepartamental.DMIP_INSPECCIONES,
            roles: [RolDepartamental.DMIP_INSPECCIONES],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORMULARIO_NO_AUTORIZADO' });
  });

  /**
   * ESCRITURA GANA A APORTA. Quien tiene los dos papeles en un formulario debe quedar con
   * el más amplio; si se tomara la primera fila, el orden de la consulta decidiría lo que
   * puede hacer.
   */
  it('con los dos papeles, se queda con el que escribe', async () => {
    const mixto: AutorizacionFormulario = {
      ...PATRULLA_ECU,
      roles: [
        { rol: RolDepartamental.DMIT_INSTRUCTOR, acceso: 'APORTA', cupo: 1 },
        {
          rol: RolDepartamental.DMIP_OPERATIVOS,
          acceso: 'ESCRITURA',
          cupo: null,
        },
      ],
    };
    const { guarda } = armar(mixto);
    const usuario = {
      rol: RolDepartamental.DAF,
      roles: [
        RolDepartamental.DMIT_INSTRUCTOR,
        RolDepartamental.DMIP_OPERATIVOS,
      ],
    };

    await guarda.canActivate(
      contextoCon({ body: { formularioCodigo: 'ECU' }, user: usuario }),
    );

    expect(usuario.rol).toBe(RolDepartamental.DMIP_OPERATIVOS);
  });

  it('permite al rol COMPARTIDO del formulario 6', async () => {
    const { guarda } = armar(REACCION_NOCTURNA);
    await expect(
      guarda.canActivate(
        contextoCon({
          body: { formularioCodigo: 'REACN' },
          user: {
            rol: RolDepartamental.DMIT_INSTRUCTOR,
            roles: [RolDepartamental.DMIT_INSTRUCTOR],
          },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('la propiedad la decide la TABLA, no el cuerpo de la petición', async () => {
    // El cuerpo declara un rol dueño falso. La guarda no lo mira: consulta la tabla,
    // que dice que FIJOS es de DMIP_OPERATIVOS.
    const { guarda, buscarPorCodigo } = armar(FIJOS);
    await expect(
      guarda.canActivate(
        contextoCon({
          body: {
            formularioCodigo: 'FIJOS',
            rolDueno: RolDepartamental.DMIT_INSTRUCTOR,
          },
          user: {
            rol: RolDepartamental.DMIT_INSTRUCTOR,
            roles: [RolDepartamental.DMIT_INSTRUCTOR],
          },
        }),
      ),
    ).rejects.toBeInstanceOf(AutorizacionError);
    expect(buscarPorCodigo).toHaveBeenCalledWith('FIJOS');
  });

  it('rechaza un formulario inexistente sin revelar que no existe', async () => {
    const { guarda } = armar(null);
    await expect(
      guarda.canActivate(
        contextoCon({
          body: { formularioCodigo: 'NOEXISTE' },
          user: {
            rol: RolDepartamental.DMIP_OPERATIVOS,
            roles: [RolDepartamental.DMIP_OPERATIVOS],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORMULARIO_NO_AUTORIZADO' });
  });

  it('rechaza un formulario dado de baja', async () => {
    const { guarda } = armar({ ...FIJOS, activo: false });
    await expect(
      guarda.canActivate(
        contextoCon({
          body: { formularioCodigo: 'FIJOS' },
          user: {
            rol: RolDepartamental.DMIP_OPERATIVOS,
            roles: [RolDepartamental.DMIP_OPERATIVOS],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORMULARIO_NO_AUTORIZADO' });
  });

  it('rechaza si no se indicó el formulario', async () => {
    const { guarda } = armar(FIJOS);
    await expect(
      guarda.canActivate(
        contextoCon({
          body: {},
          user: {
            rol: RolDepartamental.DMIP_OPERATIVOS,
            roles: [RolDepartamental.DMIP_OPERATIVOS],
          },
        }),
      ),
    ).rejects.toBeInstanceOf(AutorizacionError);
  });

  it('no interviene en endpoints que no trabajan sobre un formulario', async () => {
    // Sin decorador, el reflector no devuelve ubicación y la guarda deja pasar.
    const { guarda, buscarPorCodigo } = armar(FIJOS, null);
    await expect(
      guarda.canActivate(contextoCon({ body: {}, user: {} })),
    ).resolves.toBe(true);
    expect(buscarPorCodigo).not.toHaveBeenCalled();
  });

  it('lee el código de los parámetros de ruta cuando así se indica', async () => {
    const { guarda, buscarPorCodigo } = armar(FIJOS, {
      origen: 'params',
      propiedad: 'codigo',
    });
    await expect(
      guarda.canActivate(
        contextoCon({
          params: { codigo: 'FIJOS' },
          user: {
            rol: RolDepartamental.DMIP_OPERATIVOS,
            roles: [RolDepartamental.DMIP_OPERATIVOS],
          },
        }),
      ),
    ).resolves.toBe(true);
    expect(buscarPorCodigo).toHaveBeenCalledWith('FIJOS');
  });
});
