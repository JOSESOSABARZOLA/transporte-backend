/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Maestro de personal
 * Archivo: funcionarios.service.spec.ts
 * Responsabilidad: Verificar el alta, la modificación, la baja lógica y la traza.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * Las cédulas de las pruebas se compusieron con el algoritmo de módulo 10. No
 * pertenecen a nadie: PV-02 sigue abierto y este módulo no inventa personal.
 */

import {
  AccionAuditoria,
  AreaPersonal,
  RolDepartamental,
  TipoContrato,
  type Funcionario,
} from '@prisma/client';

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  AutorizacionError,
  RecursoNoEncontradoError,
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import type { FuncionariosRepository } from '../infrastructure/funcionarios.repository';
import type { RolDireccionRepository } from '../infrastructure/rol-direccion.repository';
import { FuncionariosService } from './funcionarios.service';

const CLIENTE = { marca: 'transaccion' };
const CEDULA = '1710034065';
const OTRA_CEDULA = '0926687856';

const funcionario = (parcial: Partial<Funcionario> = {}): Funcionario =>
  ({
    id: 1,
    cedula: CEDULA,
    apellidos: 'BENAVIDES',
    nombres: 'FERNANDO',
    telefono: '098 514 4231',
    cargo: 'Inspector',
    area: AreaPersonal.GENERAL,
    tipoContrato: TipoContrato.NOMBRAMIENTO,
    direccion: RolDepartamental.DMIP_INSPECCIONES,
    // Personal DMIP: la zonal es opcional (2026-09-21); aquí va una válida (ver `exigirZonalVigente`).
    zonalId: 1,
    activo: true,
    creadoEn: new Date(),
    actualizadoEn: new Date(),
    ...parcial,
  }) as Funcionario;

/**
 * ROLES DE QUIEN OPERA. Casi todas las pruebas escriben sobre una ficha de
 * `DMIP_INSPECCIONES`, así que por omisión se opera como su administrador.
 */
const COMO_DMIP: RolDepartamental[] = [RolDepartamental.ADMINISTRADOR_DMIP];
const SOLO_INSTRUCCION_GLOBAL: RolDepartamental[] = [
  RolDepartamental.DMIT_INSTRUCTOR,
];

const armar = (
  opciones: {
    existentes?: Funcionario[];
    asignaciones?: number;
    /** Lo que `t_rol_direccion` devuelve para quien opera. */
    administra?: RolDepartamental[];
    /** Si la zonal enviada está vigente en el catálogo (2026-09-21). */
    zonalVigente?: boolean;
  } = {},
) => {
  const {
    existentes = [],
    asignaciones = 0,
    administra = [
      RolDepartamental.DMIP_OPERATIVOS,
      RolDepartamental.DMIP_INSPECCIONES,
    ],
    zonalVigente = true,
  } = opciones;
  const filas = [...existentes];

  const buscarPorId = jest
    .fn()
    .mockImplementation((id: number) =>
      Promise.resolve(filas.find((fila) => fila.id === id) ?? null),
    );
  const buscarPorCedula = jest
    .fn()
    .mockImplementation((cedula: string) =>
      Promise.resolve(filas.find((fila) => fila.cedula === cedula) ?? null),
    );
  const crear = jest
    .fn()
    .mockImplementation((datos: Partial<Funcionario>) =>
      Promise.resolve(funcionario({ id: 99, ...datos })),
    );
  const actualizar = jest
    .fn()
    .mockImplementation((id: number, cambios: Partial<Funcionario>) => {
      const indice = filas.findIndex((fila) => fila.id === id);
      filas[indice] = { ...filas[indice], ...cambios };
      return Promise.resolve(filas[indice]);
    });

  const registrar = jest.fn().mockResolvedValue(undefined);
  const compararCambios = jest
    .fn()
    .mockImplementation(
      (anterior: Record<string, unknown>, nuevo: Record<string, unknown>) =>
        Object.entries(nuevo)
          .filter(([campo, valor]) => String(anterior[campo]) !== String(valor))
          .map(([campo, valor]) => ({
            campo,
            valorAnterior: String(anterior[campo]),
            valorNuevo: String(valor),
          })),
    );

  const servicio = new FuncionariosService(
    {
      listar: jest.fn().mockResolvedValue(filas),
      listarPorAreas: jest.fn().mockResolvedValue(filas),
      buscarPorId,
      buscarPorCedula,
      crear,
      actualizar,
      contarAsignaciones: jest.fn().mockResolvedValue(asignaciones),
      existeZonalActiva: jest.fn().mockResolvedValue(zonalVigente),
      ejecutarEnTransaccion: jest
        .fn()
        .mockImplementation((operacion: (c: unknown) => Promise<unknown>) =>
          operacion(CLIENTE),
        ),
    } as unknown as FuncionariosRepository,
    {
      direccionesQueAdministran: jest.fn().mockResolvedValue(administra),
    } as unknown as RolDireccionRepository,
    { registrar, compararCambios } as unknown as AuditoriaService,
  );

  return { servicio, crear, actualizar, registrar };
};

const NUEVO = {
  cedula: CEDULA,
  apellidos: 'benavides',
  nombres: 'fernando',
  telefono: '098 514 4231',
  cargo: 'Inspector',
  area: AreaPersonal.GENERAL,
  tipoContrato: TipoContrato.NOMBRAMIENTO,
  // Área DMIP: la zonal es opcional (2026-09-21); aquí va una válida.
  zonalId: 1,
};

describe('FuncionariosService · alta', () => {
  it('normaliza apellidos y nombres a mayúsculas, como el cuadro', () => {
    // El cuadro real escribe «BENAVIDES FERNANDO». Normalizar en el alta evita que la
    // matriz mezcle mayúsculas y minúsculas según quien haya digitado.
    const { servicio, crear } = armar();

    return servicio.crear(NUEVO, 6, COMO_DMIP).then(() => {
      expect(crear).toHaveBeenCalledWith(
        expect.objectContaining({
          apellidos: 'BENAVIDES',
          nombres: 'FERNANDO',
        }),
        CLIENTE,
      );
    });
  });

  it('caso 1 del plan · rechaza la cédula repetida diciendo de quién es', async () => {
    const { servicio, crear } = armar({ existentes: [funcionario()] });

    const fallo: unknown = await servicio
      .crear(NUEVO, 6, COMO_DMIP)
      .catch((error: unknown) => error);

    // 409 desde el rediseño de P-07 (2026-10-08), con su código: el frontend lo lleva al campo.
    expect(fallo).toBeInstanceOf(ReglaNegocioError);
    expect((fallo as ReglaNegocioError).statusCode).toBe(409);
    expect((fallo as ReglaNegocioError).code).toBe(
      CODIGOS_ERROR.CEDULA_CON_FICHA,
    );
    expect((fallo as ReglaNegocioError).message).toContain(
      'BENAVIDES FERNANDO',
    );
    expect((fallo as ReglaNegocioError).message).toContain('reactive su ficha');
    expect(crear).not.toHaveBeenCalled();
  });

  it('acepta una cédula de diez dígitos aunque el dígito verificador no cuadre', async () => {
    // Desde el 2026-09-28 la validación del módulo 10 está desactivada por decisión del
    // negocio: basta con que sean diez dígitos. '1710034066' no cuadra el verificador y aun
    // así se acepta.
    const { servicio, crear } = armar();

    await servicio.crear({ ...NUEVO, cedula: '1710034066' }, 6, COMO_DMIP);

    expect(crear).toHaveBeenCalled();
  });

  it('rechaza una cédula que no tiene diez dígitos', async () => {
    const { servicio, crear } = armar();

    await expect(
      servicio.crear({ ...NUEVO, cedula: '17100' }, 6, COMO_DMIP),
    ).rejects.toBeInstanceOf(ValidacionError);
    expect(crear).not.toHaveBeenCalled();
  });

  it('rechaza un teléfono que no puede serlo', async () => {
    const { servicio } = armar();

    await expect(
      servicio.crear(
        { ...NUEVO, telefono: 'llamar a la oficina' },
        6,
        COMO_DMIP,
      ),
    ).rejects.toBeInstanceOf(ValidacionError);
  });

  it('el teléfono vacío se guarda como nulo, no como cadena vacía', async () => {
    const { servicio, crear } = armar();

    await servicio.crear({ ...NUEVO, telefono: '   ' }, 6, COMO_DMIP);

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({ telefono: null }),
      CLIENTE,
    );
  });

  it('normaliza y guarda los dos correos (institucional y personal) en minúsculas', async () => {
    const { servicio, crear } = armar();

    await servicio.crear(
      {
        ...NUEVO,
        correoInstitucional: '  Fernando.Benavides@QUITO.gob.ec ',
        correoPersonal: 'FER.benavides@Gmail.com',
      },
      6,
      COMO_DMIP,
    );

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({
        correoInstitucional: 'fernando.benavides@quito.gob.ec',
        correoPersonal: 'fer.benavides@gmail.com',
      }),
      CLIENTE,
    );
  });

  it('rechaza un correo personal con formato inválido, nombrándolo', async () => {
    const { servicio, crear } = armar();

    await expect(
      servicio.crear({ ...NUEVO, correoPersonal: 'sin-arroba' }, 6, COMO_DMIP),
    ).rejects.toThrow(/correo personal/i);
    expect(crear).not.toHaveBeenCalled();
  });

  it('audita el alta dentro de la transacción', async () => {
    const { servicio, registrar } = armar();

    await servicio.crear(NUEVO, 6, COMO_DMIP);

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_funcionario',
        entidadId: 99,
        accion: AccionAuditoria.CREAR,
        usuario: 6,
      }),
      CLIENTE,
    );
  });
});

describe('FuncionariosService · modificación', () => {
  it('no escribe ni audita cuando nada cambia', async () => {
    const { servicio, actualizar, registrar } = armar({
      existentes: [funcionario()],
    });

    await servicio.actualizar(1, { cargo: 'Inspector' }, 6, COMO_DMIP);

    expect(actualizar).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it('audita el cambio de cargo con su valor', async () => {
    const { servicio, registrar } = armar({ existentes: [funcionario()] });

    await servicio.actualizar(1, { cargo: 'Inspector General' }, 6, COMO_DMIP);

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        cambios: [
          {
            campo: 'func_cargo',
            valorAnterior: 'Inspector',
            valorNuevo: 'Inspector General',
          },
        ],
      }),
      CLIENTE,
    );
  });

  it('LA TRAZA NO GUARDA EL TELÉFONO NI LA CÉDULA, solo que cambiaron', async () => {
    const { servicio, registrar } = armar({ existentes: [funcionario()] });

    await servicio.actualizar(1, { telefono: '099 111 2233' }, 6, COMO_DMIP);

    const [datos] = registrar.mock.calls[0] as [{ cambios: unknown[] }];
    expect(datos.cambios).toEqual([
      {
        campo: 'func_telefono',
        valorAnterior: '[dato personal]',
        valorNuevo: '[dato personal]',
      },
    ]);
  });

  it('rechaza cambiar la cédula por la de otra ficha', async () => {
    const { servicio } = armar({
      existentes: [funcionario(), funcionario({ id: 2, cedula: OTRA_CEDULA })],
    });

    await expect(
      servicio.actualizar(1, { cedula: OTRA_CEDULA }, 6, COMO_DMIP),
    ).rejects.toBeInstanceOf(ReglaNegocioError);
  });

  /**
   * EL TELÉFONO SOLO SE COMPRUEBA SI CAMBIA (2026-10-08). El formato pasó a ser estricto y
   * hay fichas con números del formato anterior: corregir el cargo no debe exigir tocarlo.
   */
  it('editar otro campo no exige rehacer un teléfono del formato anterior', async () => {
    const { servicio } = armar({
      existentes: [funcionario({ telefono: '02-2445566' })],
    });

    await expect(
      servicio.actualizar(1, { cargo: 'Inspector General' }, 6, COMO_DMIP),
    ).resolves.toBeDefined();
  });

  it('pero un teléfono nuevo sí se exige como celular 09 de diez dígitos', async () => {
    const { servicio } = armar({ existentes: [funcionario()] });

    await expect(
      servicio.actualizar(1, { telefono: '02-2445566' }, 6, COMO_DMIP),
    ).rejects.toBeInstanceOf(ValidacionError);
  });

  it('un identificador inexistente produce 404', async () => {
    const { servicio } = armar();

    await expect(
      servicio.actualizar(999, { cargo: 'X' }, 6, COMO_DMIP),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
  });
});

describe('FuncionariosService · zonal en la ficha (2026-09-21)', () => {
  it('persiste la zonal del personal DMIP (GENERAL) cuando se envía', async () => {
    const { servicio, crear } = armar();

    await servicio.crear(
      { ...NUEVO, area: AreaPersonal.GENERAL, zonalId: 3 },
      6,
      [RolDepartamental.ADMINISTRADOR_DMIP],
    );

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({ zonalId: 3 }),
      CLIENTE,
    );
  });

  it('acepta al personal DMIP sin zonal (la zonal es opcional)', async () => {
    const { servicio, crear } = armar();

    const sinZonal = { ...NUEVO, zonalId: undefined };
    await servicio.crear({ ...sinZonal, area: AreaPersonal.OPERATIVOS }, 6, [
      RolDepartamental.ADMINISTRADOR_DMIP,
    ]);

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({
        area: AreaPersonal.OPERATIVOS,
        zonalId: undefined,
      }),
      CLIENTE,
    );
  });

  it('NO exige zonal al personal de Instrucción (la fija su matriz)', async () => {
    const { servicio, crear } = armar({
      administra: [RolDepartamental.DMIT_INSTRUCTOR],
    });

    const sinZonal = { ...NUEVO, zonalId: undefined };
    await servicio.crear(
      { ...sinZonal, area: AreaPersonal.INSTRUCCION },
      6,
      SOLO_INSTRUCCION_GLOBAL,
    );

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({ area: AreaPersonal.INSTRUCCION }),
      CLIENTE,
    );
  });

  it('rechaza una zonal que no está vigente', async () => {
    const { servicio, crear } = armar({ zonalVigente: false });

    const fallo = await servicio
      .crear({ ...NUEVO, area: AreaPersonal.GENERAL, zonalId: 999 }, 6, [
        RolDepartamental.ADMINISTRADOR_DMIP,
      ])
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('vigente');
    expect(crear).not.toHaveBeenCalled();
  });
});

describe('FuncionariosService · baja lógica', () => {
  it('caso 3 del plan · la baja conserva la ficha y cuenta el histórico', async () => {
    const { servicio, registrar } = armar({
      existentes: [funcionario()],
      asignaciones: 14,
    });

    const baja = await servicio.desactivar(
      1,
      6,
      COMO_DMIP,
      'FIN_CONTRATO',
      null,
    );

    expect(baja.funcionario.activo).toBe(false);
    expect(baja.operativosHistoricos).toBe(14);
    expect(baja.mensaje).toContain('14 operativos anteriores');
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: AccionAuditoria.ELIMINAR }),
      CLIENTE,
    );
  });

  it('sin histórico tampoco se elimina: la persona puede reingresar', async () => {
    const { servicio } = armar({ existentes: [funcionario()] });

    const baja = await servicio.desactivar(
      1,
      6,
      COMO_DMIP,
      'FIN_CONTRATO',
      null,
    );

    expect(baja.funcionario.activo).toBe(false);
    expect(baja.mensaje).toContain('por si reingresa');
  });

  it('la baja guarda el motivo (código) en la ficha y lo audita', async () => {
    const { servicio, actualizar, registrar } = armar({
      existentes: [funcionario()],
    });

    await servicio.desactivar(1, 6, COMO_DMIP, 'RENUNCIA', null);

    expect(actualizar).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        motivoBaja: 'RENUNCIA',
        motivoBajaDetalle: null,
      }),
      CLIENTE,
    );
    // La auditoría de la baja (acción ELIMINAR) ya la fija la prueba «caso 3».
    expect(registrar).toHaveBeenCalled();
  });

  it('con «OTRO» guarda el detalle; con un motivo estándar lo descarta', async () => {
    const conOtro = armar({ existentes: [funcionario()] });
    await conOtro.servicio.desactivar(
      1,
      6,
      COMO_DMIP,
      'OTRO',
      'Cambio de ciudad',
    );
    expect(conOtro.actualizar).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        motivoBaja: 'OTRO',
        motivoBajaDetalle: 'Cambio de ciudad',
      }),
      CLIENTE,
    );

    // Un detalle enviado con un motivo estándar NO se guarda.
    const conEstandar = armar({ existentes: [funcionario()] });
    await conEstandar.servicio.desactivar(1, 6, COMO_DMIP, 'TRASLADO', 'sobra');
    expect(conEstandar.actualizar).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        motivoBaja: 'TRASLADO',
        motivoBajaDetalle: null,
      }),
      CLIENTE,
    );
  });

  it('repetir la baja no vuelve a escribir ni a auditar', async () => {
    const { servicio, actualizar, registrar } = armar({
      existentes: [funcionario({ activo: false })],
    });

    const baja = await servicio.desactivar(
      1,
      6,
      COMO_DMIP,
      'FIN_CONTRATO',
      null,
    );

    expect(baja.mensaje).toContain('ya estaba fuera del maestro');
    expect(actualizar).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it('el reingreso devuelve la ficha al maestro', async () => {
    const { servicio, registrar } = armar({
      existentes: [funcionario({ activo: false })],
    });

    const reactivado = await servicio.reactivar(1, 6, COMO_DMIP);

    expect(reactivado.activo).toBe(true);
    expect(registrar).toHaveBeenCalled();
  });

  it('el reingreso LIMPIA el motivo de baja (el historial queda en la auditoría)', async () => {
    const { servicio, actualizar } = armar({
      existentes: [funcionario({ activo: false })],
    });

    await servicio.reactivar(1, 6, COMO_DMIP);

    expect(actualizar).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        activo: true,
        motivoBaja: null,
        motivoBajaDetalle: null,
      }),
      CLIENTE,
    );
  });

  it('reactivar a quien ya está activo no escribe nada', async () => {
    const { servicio, actualizar } = armar({ existentes: [funcionario()] });

    await servicio.reactivar(1, 6, COMO_DMIP);

    expect(actualizar).not.toHaveBeenCalled();
  });

  /**
   * ES LA QUE PROTEGE EL REINGRESO. Sin la comprobación de alcance que se le añadió al
   * exponerlo, el administrador de un departamento podría reactivar la ficha de otro.
   */
  it('no reactiva una ficha fuera del alcance del administrador', async () => {
    const { servicio, registrar } = armar({
      existentes: [funcionario({ activo: false })],
      administra: SOLO_INSTRUCCION_GLOBAL,
    });

    // La ficha por omisión es de Inspecciones; quien solo administra Instrucción no la alcanza.
    await expect(
      servicio.reactivar(1, 6, SOLO_INSTRUCCION_GLOBAL),
    ).rejects.toThrow();
    expect(registrar).not.toHaveBeenCalled();
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CADA ADMINISTRADOR ESCRIBE SOBRE SU GENTE. 2026-09-01.
 *
 * El maestro dejó de tener un solo administrador: Inspecciones, Instrucción y Vehículos
 * manejan cada una su personal. El `@Roles` del controlador dice quién entra; estas
 * pruebas cubren lo otro, que es **sobre quién**, y que hasta hoy no existía porque solo
 * llegaba un rol y alcanzaba a todos.
 *
 * `administra` es lo que `t_rol_direccion` devuelve para quien opera. Con la lista vacía
 * se representa a quien no administra nada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('FuncionariosService · alcance por dirección', () => {
  const COMO_DMIT: RolDepartamental[] = [RolDepartamental.ADMINISTRADOR_DMIT];
  const SOLO_INSTRUCCION = [RolDepartamental.DMIT_INSTRUCTOR];

  const deInstruccion = () =>
    funcionario({ direccion: RolDepartamental.DMIT_INSTRUCTOR });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * LA DIRECCIÓN LA PONE EL ÁREA. Reescritas el 2026-09-01, al retirar el campo.
   *
   * Hasta hoy estas tres pruebas pasaban `direccion` en la petición, porque el formulario
   * la pedía. Ahora la deduce el servicio con `ROL_DEL_AREA` y **el contrato ya no la
   * admite**: lo que cambia no es la regla —PER-09 sigue igual— sino por dónde entra el
   * dato que la dispara.
   *
   * SE AFIRMA ADEMÁS QUÉ SE GUARDA, y no solo que se guardara. Sin comprobar la dirección
   * escrita, una deducción equivocada —o ninguna— pasaría estas pruebas: bastaría con que
   * el alta llegara al repositorio.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  it('el de Instrucción da de alta en su dirección, deducida del área', async () => {
    const { servicio, crear } = armar({ administra: SOLO_INSTRUCCION });

    await servicio.crear(
      { ...NUEVO, area: AreaPersonal.INSTRUCCION },
      6,
      COMO_DMIT,
    );

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({
        area: AreaPersonal.INSTRUCCION,
        direccion: RolDepartamental.DMIT_INSTRUCTOR,
      }),
      expect.anything(),
    );
  });

  /**
   * ES LA QUE DISCRIMINA EN EL ALTA. La anterior pasaría con una puerta que no mirase
   * nada; esta exige que el rechazo dependa de la dirección de la ficha, y que lo diga.
   *
   * `GENERAL` pertenece a DMIP Inspecciones, así que quien solo administra Instrucción no
   * puede crearla. Es la misma frontera de antes, expresada por el área.
   */
  it('y no en la ajena, nombrando la dirección', async () => {
    const { servicio, crear } = armar({ administra: SOLO_INSTRUCCION });

    const fallo: unknown = await servicio
      .crear({ ...NUEVO, area: AreaPersonal.GENERAL }, 6, COMO_DMIT)
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(AutorizacionError);
    expect((fallo as AutorizacionError).message).toContain('DMIP_INSPECCIONES');
    expect(crear).not.toHaveBeenCalled();
  });

  it('edita la ficha de los suyos', async () => {
    const { servicio, actualizar } = armar({
      existentes: [deInstruccion()],
      administra: SOLO_INSTRUCCION,
    });

    await servicio.actualizar(1, { cargo: 'Instructor Jefe' }, 6, COMO_DMIT);

    expect(actualizar).toHaveBeenCalled();
  });

  it('y no la de otro departamento', async () => {
    const { servicio, actualizar } = armar({
      existentes: [funcionario()],
      administra: SOLO_INSTRUCCION,
    });

    await expect(
      servicio.actualizar(1, { cargo: 'Inspector Jefe' }, 6, COMO_DMIT),
    ).rejects.toBeInstanceOf(AutorizacionError);

    expect(actualizar).not.toHaveBeenCalled();
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * NO SE LLEVA A NADIE CAMBIÁNDOLE EL ÁREA.
   *
   * Sin esta comprobación el control sería decorativo: bastaría con editar la ficha propia
   * poniéndole el área de otro departamento para sacarla del suyo, o al revés, traerse a
   * alguien ajeno en dos pasos. Mover a una persona exige alcanzar las dos direcciones.
   *
   * ES LA MISMA REGLA DE ANTES Y ENTRA POR OTRA PUERTA, y por eso hay que fijarla otra
   * vez. Hasta el 2026-09-01 se movía a alguien mandando `direccion`; ahora se le mueve
   * cambiándole el área, que es un campo que **sí** se sigue pidiendo en la pantalla y que
   * a primera vista no parece tener nada que ver con permisos.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  it('mover a alguien de área, si con ello cambia de departamento, se rechaza', async () => {
    const { servicio, actualizar } = armar({
      existentes: [deInstruccion()],
      administra: SOLO_INSTRUCCION,
    });

    // OPERATIVOS es de DMIP, y quien edita solo administra Instrucción.
    await expect(
      servicio.actualizar(1, { area: AreaPersonal.OPERATIVOS }, 6, COMO_DMIT),
    ).rejects.toBeInstanceOf(AutorizacionError);

    expect(actualizar).not.toHaveBeenCalled();
  });

  /**
   * Y EL CONTRASTE: cambiar de área dentro del mismo departamento no es moverse.
   *
   * Sin esta, la comprobación de arriba se cumpliría rechazando **todo** cambio de área,
   * que dejaría a un administrador sin poder corregir una errata en la ficha de los suyos.
   */
  it('pero cambiar de área dentro del mismo departamento sí se admite', async () => {
    const { servicio, actualizar } = armar({
      existentes: [
        funcionario({
          direccion: RolDepartamental.DMIP_INSPECCIONES,
          area: AreaPersonal.GENERAL,
        }),
      ],
      administra: [RolDepartamental.DMIP_INSPECCIONES],
    });

    // GENERAL y TECNICO son dos áreas de la misma dirección.
    await servicio.actualizar(1, { area: AreaPersonal.TECNICO }, 6, COMO_DMIT);

    expect(actualizar).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        area: AreaPersonal.TECNICO,
        direccion: RolDepartamental.DMIP_INSPECCIONES,
      }),
      expect.anything(),
    );
  });

  it('da de baja a los suyos y no a los ajenos', async () => {
    const propio = armar({
      existentes: [deInstruccion()],
      administra: SOLO_INSTRUCCION,
    });

    await propio.servicio.desactivar(1, 6, COMO_DMIT, 'FIN_CONTRATO', null);
    expect(propio.actualizar).toHaveBeenCalled();

    const ajeno = armar({
      existentes: [funcionario()],
      administra: SOLO_INSTRUCCION,
    });

    await expect(
      ajeno.servicio.desactivar(1, 6, COMO_DMIT, 'FIN_CONTRATO', null),
    ).rejects.toBeInstanceOf(AutorizacionError);
    expect(ajeno.actualizar).not.toHaveBeenCalled();
  });

  /**
   * PERTENECER TAMBIÉN ALCANZA, y por eso PER-09 sigue en pie: un rol departamental ve y
   * anota lo de su gente sin administrar nada. La diferencia entre pertenecer y
   * administrar decide otras potestades, no ésta.
   */
  it('un rol departamental alcanza su propia dirección sin administrar nada', async () => {
    const { servicio } = armar({ administra: [] });

    await expect(
      servicio.direccionesAlAlcance([RolDepartamental.DMIT_INSTRUCTOR]),
    ).resolves.toEqual([RolDepartamental.DMIT_INSTRUCTOR]);
  });

  it('quien no pertenece ni administra no alcanza a nadie', async () => {
    const { servicio } = armar({ administra: [] });

    await expect(
      servicio.direccionesAlAlcance([RolDepartamental.DIRECTOR]),
    ).resolves.toEqual([]);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * QUÉ ÁREAS ALCANZA CADA ADMINISTRADOR. 2026-09-01, tarde.
 *
 * El negocio lo pidió con las etiquetas de pantalla —«Unidad de Operativos, Inspector
 * General e Inspector Técnico» para la DMIP, «Personal de Instrucción» solo para el
 * DMIT—, y son áreas: `OPERATIVOS`, `GENERAL`, `TECNICO` e `INSTRUCCION`.
 *
 * LO QUE ESTAS PRUEBAS FIJAN ES QUE LA RESPUESTA SE DERIVE, no que coincida hoy. Una lista
 * escrita a mano en el servicio pasaría estas dos aserciones y se separaría del reparto en
 * cuanto alguien moviera una fila de `t_rol_direccion`; por eso la tercera cambia el
 * reparto y exige que las áreas cambien con él.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('FuncionariosService · qué áreas alcanza cada administrador', () => {
  it('el de la DMIP alcanza sus tres áreas y no la de Instrucción', async () => {
    const { servicio } = armar({
      administra: [
        RolDepartamental.DMIP_OPERATIVOS,
        RolDepartamental.DMIP_INSPECCIONES,
      ],
    });

    const areas = await servicio.areasAlAlcance([
      RolDepartamental.ADMINISTRADOR_DMIP,
    ]);

    expect(areas).toContain(AreaPersonal.OPERATIVOS);
    expect(areas).toContain(AreaPersonal.GENERAL);
    expect(areas).toContain(AreaPersonal.TECNICO);
    expect(areas).not.toContain(AreaPersonal.INSTRUCCION);
  });

  it('y el del DMIT alcanza únicamente la de Instrucción', async () => {
    const { servicio } = armar({
      administra: [RolDepartamental.DMIT_INSTRUCTOR],
    });

    const areas = await servicio.areasAlAlcance([
      RolDepartamental.ADMINISTRADOR_DMIT,
    ]);

    expect(areas).toEqual([AreaPersonal.INSTRUCCION]);
  });

  /**
   * ES LA QUE DISCRIMINA. Las dos anteriores pasarían con dos listas escritas a mano; ésta
   * exige que la respuesta salga del reparto, que es lo que hace que mover un departamento
   * sea una fila de la tabla y no un despliegue.
   */
  it('si el reparto cambia, las áreas cambian con él', async () => {
    const { servicio } = armar({
      administra: [RolDepartamental.DMIT_INSTRUCTOR],
    });

    // El mismo rol de siempre, administrando otra cosa: lo que decide es la tabla.
    const areas = await servicio.areasAlAlcance([
      RolDepartamental.ADMINISTRADOR_DMIP,
    ]);

    expect(areas).toEqual([AreaPersonal.INSTRUCCION]);
  });
});
