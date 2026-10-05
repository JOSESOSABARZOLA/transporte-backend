/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Disponibilidad del personal
 * Archivo: disponibilidad.service.spec.ts
 * Responsabilidad: Verificar RN-30, INV-14 y el rango de las ausencias.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import {
  AccionAuditoria,
  EstadoDisponibilidad,
  RolDepartamental,
  type Disponibilidad,
  type Funcionario,
} from '@prisma/client';

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  AutorizacionError,
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import type { DisponibilidadRepository } from '../infrastructure/disponibilidad.repository';
import { direccionesDeLosRoles } from '../domain/areas-del-rol';
import { DisponibilidadService } from './disponibilidad.service';
import type { FuncionariosService } from './funcionarios.service';
import { aFechaUtc, seSolapan } from './reglas-personal';

const CLIENTE = { marca: 'transaccion' };
const dia = (texto: string): Date => aFechaUtc(texto) as Date;

const periodo = (parcial: Partial<Disponibilidad> = {}): Disponibilidad =>
  ({
    id: 1,
    funcionarioId: 1,
    conductorId: null,
    vehiculoId: null,
    estado: EstadoDisponibilidad.VACACIONES,
    desde: dia('2026-08-01'),
    hasta: dia('2026-08-15'),
    motivo: 'Vacaciones programadas',
    registradoPor: 6,
    creadoEn: new Date(),
    ...parcial,
  }) as Disponibilidad;

/**
 * EL REPARTO DE t_rol_direccion, tal como lo siembra la migracion del 2026-09-01.
 *
 * Se copia aqui y no se inventa: si la tabla y esta constante se separaran, las pruebas
 * seguirian en verde describiendo un reparto que no existe. La suite de integracion es la
 * que comprueba que la base dice esto mismo.
 */
const REPARTO: Partial<Record<RolDepartamental, RolDepartamental[]>> = {
  [RolDepartamental.ADMINISTRADOR_DMIP]: [
    RolDepartamental.DMIP_OPERATIVOS,
    RolDepartamental.DMIP_INSPECCIONES,
  ],
  [RolDepartamental.ADMINISTRADOR_DMIT]: [RolDepartamental.DMIT_INSTRUCTOR],
  [RolDepartamental.ADMINISTRADOR_DAF]: [RolDepartamental.DAF],
};

const administradasPor = (roles: readonly RolDepartamental[]) => [
  ...new Set(roles.flatMap((rol) => REPARTO[rol] ?? [])),
];

/**
 * El alcance se calcula con la MISMA funcion que usa el servicio, no con una copia.
 * Un doble que decidiera por su cuenta probaria su propio criterio.
 */
const alcanceDeLosRoles = {
  direccionesAlAlcance: jest
    .fn()
    .mockImplementation((roles: readonly RolDepartamental[]) =>
      Promise.resolve(direccionesDeLosRoles(roles, administradasPor(roles))),
    ),
  direccionesQueAdministra: jest
    .fn()
    .mockImplementation((roles: readonly RolDepartamental[]) =>
      Promise.resolve(administradasPor(roles)),
    ),
};

const armar = (existentes: Disponibilidad[] = []) => {
  const filas = [...existentes];

  const listarSolapados = jest
    .fn()
    .mockImplementation((funcionarioId: number, desde: Date, hasta: Date) =>
      Promise.resolve(
        filas.filter(
          (fila) =>
            fila.funcionarioId === funcionarioId &&
            seSolapan(
              { desde: fila.desde, hasta: fila.hasta },
              { desde, hasta },
            ),
        ),
      ),
    );

  const crear = jest
    .fn()
    .mockImplementation((datos: Partial<Disponibilidad>) =>
      Promise.resolve(periodo({ id: 50, ...datos })),
    );
  const eliminar = jest.fn().mockResolvedValue(periodo());
  const registrar = jest.fn().mockResolvedValue(undefined);

  const funcionariosAusentesEntre = jest
    .fn()
    .mockImplementation((desde: Date, hasta: Date, estados: string[]) =>
      Promise.resolve(
        new Set(
          filas
            .filter(
              (fila) =>
                estados.includes(fila.estado) &&
                seSolapan(
                  { desde: fila.desde, hasta: fila.hasta },
                  { desde, hasta },
                ),
            )
            .map((fila) => fila.funcionarioId as number),
        ),
      ),
    );

  const servicio = new DisponibilidadService(
    {
      listarDeFuncionario: jest.fn().mockResolvedValue(filas),
      listarSolapados,
      funcionariosAusentesEntre,
      buscarPorId: jest
        .fn()
        .mockImplementation((id: number) =>
          Promise.resolve(filas.find((fila) => fila.id === id) ?? null),
        ),
      crear,
      eliminar,
      ejecutarEnTransaccion: jest
        .fn()
        .mockImplementation((operacion: (c: unknown) => Promise<unknown>) =>
          operacion(CLIENTE),
        ),
    } as unknown as DisponibilidadRepository,
    {
      // La direccion dejo de ser opcional aqui el 2026-09-01: la puerta ya no tiene
      // atajo para el administrador y decide siempre por el departamento de la ficha.
      obtener: jest.fn().mockResolvedValue({
        id: 1,
        direccion: RolDepartamental.DMIP_OPERATIVOS,
      } as Funcionario),
      ...alcanceDeLosRoles,
    } as unknown as FuncionariosService,
    { registrar } as unknown as AuditoriaService,
  );

  return { servicio, crear, eliminar, registrar };
};

/**
 * Con qué roles se hacen las llamadas de estas pruebas.
 *
 * Antes del 2026-08-27 el servicio no los recibía porque solo lo llamaba el administrador.
 * Declararlo aquí hace explícito lo que entonces se daba por supuesto.
 */
const COMO_ADMIN = [RolDepartamental.ADMINISTRADOR_DMIP] as const;

const VACACIONES = {
  estado: EstadoDisponibilidad.VACACIONES,
  desde: dia('2026-08-01'),
  hasta: dia('2026-08-15'),
  motivo: 'Vacaciones programadas',
};

describe('DisponibilidadService · registro', () => {
  it('registra la ausencia y la audita dentro de la transacción', async () => {
    const { servicio, registrar } = armar();

    await servicio.registrar(1, VACACIONES, 6, COMO_ADMIN);

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_disponibilidad',
        entidadId: 50,
        accion: AccionAuditoria.CREAR,
        usuario: 6,
      }),
      CLIENTE,
    );
  });

  it('LA TRAZA NO COPIA EL MOTIVO: puede describir una condición de salud', async () => {
    const { servicio, registrar } = armar();

    await servicio.registrar(
      1,
      {
        estado: EstadoDisponibilidad.REPOSO_MEDICO,
        desde: dia('2026-08-01'),
        hasta: dia('2026-08-05'),
        motivo: 'Cirugía programada',
      },
      6,
      COMO_ADMIN,
    );

    const [datos] = registrar.mock.calls[0] as [unknown];
    const traza = JSON.stringify(datos);
    expect(traza).not.toContain('Cirugía');
    expect(traza).toContain('REPOSO_MEDICO');
  });

  it('caso 2 del plan · INV-14 · rechaza el período solapado y dice cuál choca', async () => {
    const { servicio, crear } = armar([periodo()]);

    const fallo: unknown = await servicio
      .registrar(
        1,
        {
          estado: EstadoDisponibilidad.PERMISO,
          desde: dia('2026-08-10'),
          hasta: dia('2026-08-20'),
        },
        6,
        COMO_ADMIN,
      )
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('2026-08-01');
    expect(crear).not.toHaveBeenCalled();
  });

  it('admite un período consecutivo al anterior', async () => {
    const { servicio, crear } = armar([periodo()]);

    await servicio.registrar(
      1,
      {
        estado: EstadoDisponibilidad.PERMISO,
        desde: dia('2026-08-16'),
        hasta: dia('2026-08-20'),
      },
      6,
      COMO_ADMIN,
    );

    expect(crear).toHaveBeenCalled();
  });

  it('el solapamiento se comprueba por persona, no en general', async () => {
    const { servicio, crear } = armar([periodo({ funcionarioId: 2 })]);

    await servicio.registrar(1, VACACIONES, 6, COMO_ADMIN);

    expect(crear).toHaveBeenCalled();
  });

  it('caso 6 del plan · rechaza la fecha de fin anterior al inicio', async () => {
    const { servicio } = armar();

    await expect(
      servicio.registrar(
        1,
        {
          estado: EstadoDisponibilidad.PERMISO,
          desde: dia('2026-08-15'),
          hasta: dia('2026-08-01'),
        },
        6,
        COMO_ADMIN,
      ),
    ).rejects.toBeInstanceOf(ValidacionError);
  });

  it('admite la ausencia de un solo día', async () => {
    const { servicio, crear } = armar();

    await servicio.registrar(
      1,
      {
        estado: EstadoDisponibilidad.CALAMIDAD,
        desde: dia('2026-08-05'),
        hasta: dia('2026-08-05'),
      },
      6,
      COMO_ADMIN,
    );

    expect(crear).toHaveBeenCalled();
  });

  it('rechaza MANTENIMIENTO: no es una situación de personas', async () => {
    const { servicio } = armar();

    const fallo: unknown = await servicio
      .registrar(
        1,
        {
          estado: EstadoDisponibilidad.MANTENIMIENTO,
          desde: dia('2026-08-01'),
          hasta: dia('2026-08-05'),
        },
        6,
        COMO_ADMIN,
      )
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('VACACIONES');
  });

  it('el motivo vacío se guarda como nulo', async () => {
    const { servicio, crear } = armar();

    await servicio.registrar(
      1,
      { ...VACACIONES, motivo: '   ' },
      6,
      COMO_ADMIN,
    );

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({ motivo: null }),
      CLIENTE,
    );
  });
});

describe('DisponibilidadService · consulta (RN-30)', () => {
  it('devuelve solo identificadores, nunca el estado de cada persona', async () => {
    const { servicio } = armar([
      periodo(),
      periodo({ id: 2, funcionarioId: 3 }),
    ]);

    const ausentes = await servicio.ausentesEntre(
      dia('2026-08-05'),
      dia('2026-08-06'),
    );

    expect(ausentes).toBeInstanceOf(Set);
    expect([...ausentes].sort()).toEqual([1, 3]);
  });

  it('no excluye a quien está registrado como DISPONIBLE', async () => {
    const { servicio } = armar([
      periodo({ estado: EstadoDisponibilidad.DISPONIBLE }),
    ]);

    const ausentes = await servicio.ausentesEntre(
      dia('2026-08-05'),
      dia('2026-08-06'),
    );

    expect(ausentes.size).toBe(0);
  });

  it('excluye si la ausencia toca el día consultado, aunque empiece antes', async () => {
    const { servicio } = armar([periodo()]);

    expect(await servicio.estaAusente(1, dia('2026-08-15'))).toBe(true);
    expect(await servicio.estaAusente(1, dia('2026-08-16'))).toBe(false);
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * LISTAR LAS AUSENCIAS SE ACOTA CON LA MISMA VARA QUE REGISTRARLAS. H-01.
   *
   * La ficha del doble es de `DMIP_OPERATIVOS`. `ADMINISTRADOR_DMIP` la alcanza y ve el
   * periodo; `ADMINISTRADOR_DAF` administra solo la DAF, así que el `motivo` —posible dato
   * de salud— no le llega: el IDOR por `:id` se cierra en el servicio, no en el endpoint.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  it('las devuelve a quien alcanza la dirección de la ficha', async () => {
    const { servicio } = armar([periodo()]);

    const periodos = await servicio.listarDe(1, COMO_ADMIN);

    expect(periodos).toHaveLength(1);
  });

  it('las niega al administrador de otra dirección', async () => {
    const { servicio } = armar([periodo()]);

    const fallo: unknown = await servicio
      .listarDe(1, [RolDepartamental.ADMINISTRADOR_DAF])
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(AutorizacionError);
  });
});

describe('DisponibilidadService · retiro', () => {
  it('elimina el período y deja constancia de que existió', async () => {
    const { servicio, eliminar, registrar } = armar([periodo()]);

    await servicio.retirar(1, 1, 6, COMO_ADMIN);

    expect(eliminar).toHaveBeenCalledWith(1, CLIENTE);
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: AccionAuditoria.ELIMINAR }),
      CLIENTE,
    );
  });

  it('un período inexistente produce 404', async () => {
    const { servicio } = armar();

    await expect(
      servicio.retirar(1, 999, 6, COMO_ADMIN),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
  });

  it('NO retira el período de otra persona, aunque el identificador exista', async () => {
    // La ruta es /personal/:id/disponibilidad/:periodoId. Sin esta comprobación, un
    // identificador equivocado borraba la ausencia de otro funcionario y la traza no
    // decía nada del error.
    const { servicio, eliminar } = armar([periodo({ funcionarioId: 7 })]);

    await expect(servicio.retirar(1, 1, 6, COMO_ADMIN)).rejects.toBeInstanceOf(
      RecursoNoEncontradoError,
    );
    expect(eliminar).not.toHaveBeenCalled();
  });

  it('no retira un período que no es de una persona', async () => {
    const { servicio } = armar([periodo({ funcionarioId: null })]);

    await expect(servicio.retirar(1, 1, 6, COMO_ADMIN)).rejects.toBeInstanceOf(
      RecursoNoEncontradoError,
    );
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CADA DEPARTAMENTO ANOTA LAS AUSENCIAS DE SU GENTE. 2026-08-27.
 *
 * P-07 dejó de ser exclusiva del administrador: los tres roles departamentales entran a
 * consultar, y lo único que escriben es la ausencia de **su** personal.
 *
 * LAS DOS PUERTAS SE PRUEBAN POR SEPARADO porque fallan distinto. Dejar pasar un
 * departamento ajeno bloquea a alguien de otra dirección para todo el cuadro; dejar
 * retirar una ausencia ajena permite que dos personas se deshagan el trabajo.
 *
 * BANCO PROPIO Y NO `armar()`: aquél recibe las ausencias existentes y fija un funcionario
 * sin dirección, que es justo el dato del que dependen estas puertas. Ampliarlo habría
 * obligado a tocar las dieciséis pruebas anteriores sin necesidad.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const armarConDireccion = (opciones: {
  direccion: RolDepartamental;
  ausencia?: Partial<Disponibilidad>;
}) => {
  const existente = periodo(opciones.ausencia ?? {});
  const crear = jest.fn().mockResolvedValue(existente);
  const eliminar = jest.fn().mockResolvedValue(existente);

  const servicio = new DisponibilidadService(
    {
      listarDeFuncionario: jest.fn().mockResolvedValue([]),
      listarSolapados: jest.fn().mockResolvedValue([]),
      funcionariosAusentesEntre: jest.fn().mockResolvedValue(new Set()),
      buscarPorId: jest.fn().mockResolvedValue(existente),
      crear,
      eliminar,
      ejecutarEnTransaccion: jest
        .fn()
        .mockImplementation((operacion: (c: unknown) => Promise<unknown>) =>
          operacion(CLIENTE),
        ),
    } as unknown as DisponibilidadRepository,
    {
      obtener: jest.fn().mockResolvedValue({
        id: 1,
        apellidos: 'SEGOVIA',
        nombres: 'MARIA',
        direccion: opciones.direccion,
      } as Funcionario),
      ...alcanceDeLosRoles,
    } as unknown as FuncionariosService,
    { registrar: jest.fn() } as unknown as AuditoriaService,
  );

  return { servicio, crear, eliminar };
};

const capturar = async (promesa: Promise<unknown>): Promise<unknown> => {
  try {
    await promesa;
    return null;
  } catch (fallo) {
    return fallo;
  }
};

describe('DisponibilidadService · de quién se anota la ausencia', () => {
  const COMO_OPERATIVOS = [RolDepartamental.DMIP_OPERATIVOS];
  const COMO_DMIT = [RolDepartamental.DMIT_INSTRUCTOR];

  it('un departamento anota la ausencia de su propia gente', async () => {
    const { servicio, crear } = armarConDireccion({
      direccion: RolDepartamental.DMIP_OPERATIVOS,
    });

    await servicio.registrar(1, VACACIONES, 6, COMO_OPERATIVOS);

    expect(crear).toHaveBeenCalled();
  });

  /**
   * ES LA QUE DISCRIMINA. La anterior pasaría con una puerta que no comprobara nada;
   * esta exige que el rechazo dependa del departamento de la persona, y que lo diga.
   */
  it('y no la de otro departamento, diciendo a cuál pertenece', async () => {
    const { servicio, crear } = armarConDireccion({
      direccion: RolDepartamental.DMIP_OPERATIVOS,
    });

    const fallo = await capturar(
      servicio.registrar(1, VACACIONES, 6, COMO_DMIT),
    );

    expect(fallo).toBeInstanceOf(AutorizacionError);
    expect((fallo as AutorizacionError).message).toContain('DMIP_OPERATIVOS');
    expect(crear).not.toHaveBeenCalled();
  });

  it('el administrador anota la de cualquiera', async () => {
    const { servicio, crear } = armarConDireccion({
      direccion: RolDepartamental.DMIP_OPERATIVOS,
    });

    await servicio.registrar(1, VACACIONES, 6, [...COMO_ADMIN]);

    expect(crear).toHaveBeenCalled();
  });

  /**
   * `RolesGuard` estrecha `usuario.rol` al PRIMERO de la lista del decorador que la
   * persona tenga, y `ADMINISTRADOR_DMIP` va el primero. Si esta puerta mirara ese campo en
   * lugar del conjunto, quien tuviera los dos roles pasaría siempre por administrador.
   * Es el defecto que se corrigió el mismo día en el filtro de personal elegible.
   */
  it('con dos roles se miran los dos, no el primero', async () => {
    const { servicio, crear } = armarConDireccion({
      direccion: RolDepartamental.DMIT_INSTRUCTOR,
    });

    await servicio.registrar(1, VACACIONES, 6, [
      RolDepartamental.DMIP_OPERATIVOS,
      RolDepartamental.DMIT_INSTRUCTOR,
    ]);

    expect(crear).toHaveBeenCalled();
  });
});

describe('DisponibilidadService · quién retira una ausencia', () => {
  const COMO_OPERATIVOS = [RolDepartamental.DMIP_OPERATIVOS];

  it('se retira la que uno mismo anotó', async () => {
    const { servicio, eliminar } = armarConDireccion({
      direccion: RolDepartamental.DMIP_OPERATIVOS,
      ausencia: { registradoPor: 6 },
    });

    await servicio.retirar(1, 1, 6, COMO_OPERATIVOS);

    expect(eliminar).toHaveBeenCalled();
  });

  it('no la que anotó otra persona, y se dice a quién pedirlo', async () => {
    const { servicio, eliminar } = armarConDireccion({
      direccion: RolDepartamental.DMIP_OPERATIVOS,
      ausencia: { registradoPor: 99 },
    });

    const fallo = await capturar(servicio.retirar(1, 1, 6, COMO_OPERATIVOS));

    expect(fallo).toBeInstanceOf(AutorizacionError);
    expect((fallo as AutorizacionError).message).toContain('quien la anotó');
    expect(eliminar).not.toHaveBeenCalled();
  });

  it('el administrador retira cualquiera', async () => {
    const { servicio, eliminar } = armarConDireccion({
      direccion: RolDepartamental.DMIP_OPERATIVOS,
      ausencia: { registradoPor: 99 },
    });

    await servicio.retirar(1, 1, 6, [...COMO_ADMIN]);

    expect(eliminar).toHaveBeenCalled();
  });
});
