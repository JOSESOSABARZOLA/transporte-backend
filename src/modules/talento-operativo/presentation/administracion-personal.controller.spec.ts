/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Personal y disponibilidad (P-07)
 * Archivo: administracion-personal.controller.spec.ts
 * Responsabilidad: Que el maestro se acote por quien pregunta y no por lo que pida.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-27
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * PER-09 · CADA DEPARTAMENTO VE A SU GENTE, Y CADA ADMINISTRADOR LA SUYA.
 *
 * Hasta el 2026-08-27 este endpoint tomaba `direccion` y `area` del `query` **tal cual y
 * sin mirar al usuario**: los tres roles departamentales se descargaban el maestro entero
 * —cédulas y teléfonos de toda la AMC— y la pantalla se limitaba a filtrar en memoria lo
 * que ya tenía en el navegador. Un filtro de cliente no es una restricción: basta con
 * mirar la respuesta de red.
 *
 * ESTAS PRUEBAS SON UNITARIAS **A PROPÓSITO**, aunque exista la batería de integración.
 * `npm test` corre `*.spec.ts` y **no** los `*.integracion-spec.ts`, que necesitan la base
 * aislada. Una restricción de lectura de datos personales no puede depender de que alguien
 * se acuerde de levantar un contenedor.
 *
 * La segunda es la que discrimina: la primera pasaría con el filtro que ya había —tomado
 * del `query`—, y solo la segunda distingue «acotado por quién pregunta» de «acotado por
 * lo que pide».
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DESDE EL 2026-09-01 LA PANTALLA ES SOLO DE `ADMINISTRADOR_DMIP`, Y ESTAS PRUEBAS
 * SIGUEN VALIENDO. Conviene decir por qué, porque a primera vista sobran.
 *
 * Llaman al controlador **directamente**, sin la cadena de guardas, así que un rol
 * departamental llega aquí aunque `RolesGuard` lo rechace por HTTP. Lo que fijan no es
 * quién entra —eso lo comprueba la suite de integración, con un 403— sino **cómo se
 * calcula el alcance** una vez dentro.
 *
 * Ese cálculo es la pieza que impide que reabrir la pantalla a alguien le entregue el
 * maestro entero por omisión. Borrarlas dejaría esa red sin vigilancia justo mientras
 * nadie la usa, que es cuando se rompe sin que se note.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { RolDepartamental } from '@prisma/client';

import { AdministracionPersonalController } from './administracion-personal.controller';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import type { DisponibilidadService } from '../application/disponibilidad.service';
import { direccionesDeLosRoles } from '../domain/areas-del-rol';
import type { FuncionariosService } from '../application/funcionarios.service';
import type { CoberturaTurnosService } from '../application/cobertura-turnos.service';
import type { CorreoInstitucionalAuthService } from '../../identidad/application/correo-institucional-auth.service';
import type { CrearFuncionarioDto } from './dto/personal.dto';

/** Quien pregunta, con los roles que le dio Auth. */
const usuario = (...roles: RolDepartamental[]): UsuarioAutenticado =>
  ({ usuarioId: 1, rol: roles[0], roles }) as unknown as UsuarioAutenticado;

/**
 * EL REPARTO DE t_rol_direccion, tal como lo siembra la migracion del 2026-09-01.
 *
 * El alcance se calcula con la MISMA funcion de dominio que usa el servicio real: un
 * doble que decidiera por su cuenta estaria probando su propio criterio.
 */
const REPARTO: Partial<Record<RolDepartamental, RolDepartamental[]>> = {
  [RolDepartamental.ADMINISTRADOR_DMIP]: [
    RolDepartamental.DMIP_OPERATIVOS,
    RolDepartamental.DMIP_INSPECCIONES,
  ],
  [RolDepartamental.ADMINISTRADOR_DMIT]: [RolDepartamental.DMIT_INSTRUCTOR],
  [RolDepartamental.ADMINISTRADOR_DAF]: [RolDepartamental.DAF],
};

const direccionesAlAlcance = jest
  .fn()
  .mockImplementation((roles: readonly RolDepartamental[]) =>
    Promise.resolve(
      direccionesDeLosRoles(roles, [
        ...new Set(roles.flatMap((rol) => REPARTO[rol] ?? [])),
      ]),
    ),
  );

const armar = (
  ficha: { direccion: RolDepartamental } = {
    direccion: RolDepartamental.DMIP_OPERATIVOS,
  },
) => {
  const listar = jest.fn().mockResolvedValue([]);
  const obtener = jest.fn().mockResolvedValue({ id: 7, ...ficha });
  const exigirEnSuAlcance = jest.fn().mockResolvedValue(undefined);

  const controlador = new AdministracionPersonalController(
    {
      listar,
      obtener,
      exigirEnSuAlcance,
      direccionesAlAlcance,
    } as unknown as FuncionariosService,
    {} as unknown as DisponibilidadService,
  );

  return { controlador, listar, obtener, exigirEnSuAlcance };
};

/** El filtro con el que el controlador acabó llamando al servicio. */
const filtroUsado = (listar: jest.Mock): { direccion?: unknown } => {
  const [primeraLlamada] = listar.mock.calls as [{ direccion?: unknown }][];

  return primeraLlamada[0];
};

describe('P-07 · el maestro se acota al departamento de quien consulta', () => {
  it('un rol departamental solo pide su propia dirección', async () => {
    const { controlador, listar } = armar();

    await controlador.listar(usuario(RolDepartamental.DMIP_OPERATIVOS));

    expect(filtroUsado(listar).direccion).toEqual([
      RolDepartamental.DMIP_OPERATIVOS,
    ]);
  });

  /**
   * ES LA QUE DISCRIMINA. Si el filtro volviera a salir del `query`, esta cae y las
   * demás no: son 200 con datos ajenos dentro, que es la forma en que estas fugas pasan
   * inadvertidas.
   */
  it('y pedir a mano la dirección de otro no le ensancha la vista', async () => {
    const { controlador, listar } = armar();

    await controlador.listar(
      usuario(RolDepartamental.DMIP_OPERATIVOS),
      RolDepartamental.DMIP_INSPECCIONES,
    );

    /*
     * DEVUELVE VACÍO, Y ANTES DEVOLVÍA SU PROPIA DIRECCIÓN. Cambió el 2026-09-01.
     *
     * Hasta hoy el parámetro **se descartaba** para los roles departamentales. Ahora se
     * **interseca** con el alcance, que es un solo camino para todos en lugar de dos que
     * pueden desincronizarse. Lo que esta prueba protege no cambia: pedir lo ajeno no
     * ensancha nada.
     *
     * No hay regresión en la pantalla: P-07 **no manda `direccion`** desde PER-09, y así
     * está dicho en `personal.service.ts`. Quien lo mande está probando la puerta.
     */
    expect(filtroUsado(listar).direccion).toEqual([]);
  });

  it('quien tiene dos departamentos ve la unión de los dos', async () => {
    // Es lo que este sistema hace en todas partes con las personas de varios roles.
    const { controlador, listar } = armar();

    await controlador.listar(
      usuario(
        RolDepartamental.DMIP_OPERATIVOS,
        RolDepartamental.DMIT_INSTRUCTOR,
      ),
    );

    expect(filtroUsado(listar).direccion).toEqual([
      RolDepartamental.DMIP_OPERATIVOS,
      RolDepartamental.DMIT_INSTRUCTOR,
    ]);
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * NINGÚN ADMINISTRADOR VE YA EL MAESTRO ENTERO. Cambió el 2026-09-01.
   *
   * Esta prueba decía «el administrador no queda acotado» y esperaba `undefined`, o sea
   * ningún filtro. Era cierto mientras hubo **un** administrador; el negocio lo repartió
   * en tres porque Inspecciones, Instrucción y Vehículos manejan cada una su gente.
   *
   * `ADMINISTRADOR_DMIP` administra las dos unidades de la DMIP y **nada más**. Para ver
   * el maestro completo hay que tener los tres roles, que el sistema admite desde el
   * 2026-08-19.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  it('el administrador de la DMIP alcanza sus dos unidades, no todas', async () => {
    const { controlador, listar } = armar();

    await controlador.listar(usuario(RolDepartamental.ADMINISTRADOR_DMIP));

    expect(filtroUsado(listar).direccion).toEqual([
      RolDepartamental.DMIP_OPERATIVOS,
      RolDepartamental.DMIP_INSPECCIONES,
    ]);
  });

  it('el de Instrucción alcanza la suya, y solo la suya', async () => {
    const { controlador, listar } = armar();

    await controlador.listar(usuario(RolDepartamental.ADMINISTRADOR_DMIT));

    expect(filtroUsado(listar).direccion).toEqual([
      RolDepartamental.DMIT_INSTRUCTOR,
    ]);
  });

  it('y el administrador sí puede acotar a mano dentro de lo suyo', async () => {
    const { controlador, listar } = armar();

    await controlador.listar(
      usuario(RolDepartamental.ADMINISTRADOR_DMIP),
      RolDepartamental.DMIP_INSPECCIONES,
    );

    // El desplegable de la pantalla: acota DENTRO de lo que ya alcanza.
    expect(filtroUsado(listar).direccion).toEqual([
      RolDepartamental.DMIP_INSPECCIONES,
    ]);
  });

  /**
   * LA QUE DISCRIMINA DEL REPARTO. La anterior pasaría con un administrador que lo viera
   * todo; esta exige que pedir una dirección que no administra devuelva vacío.
   */
  it('pero no fuera: pedir Instrucción siendo de la DMIP devuelve vacío', async () => {
    const { controlador, listar } = armar();

    await controlador.listar(
      usuario(RolDepartamental.ADMINISTRADOR_DMIP),
      RolDepartamental.DMIT_INSTRUCTOR,
    );

    expect(filtroUsado(listar).direccion).toEqual([]);
  });

  /**
   * UN PERFIL SIN DEPARTAMENTO NO VE A NADIE, y no debe caer en «sin filtro».
   *
   * Hoy no llega hasta aquí —el `@Roles` de la clase lo corta antes— pero el día que se
   * añada un rol a esa lista, la diferencia entre lista vacía y maestro completo es la
   * diferencia entre un hueco visible y una fuga silenciosa.
   *
   * SE PROBABA CON `DAF` HASTA EL 2026-09-01 y dejó de servir: la DAF pasó a ser una
   * dirección con personal, así que ahora sí ve el suyo. Se usa `DIRECTOR`, que supervisa
   * y no tiene gente propia.
   */
  it('un rol sin personal propio no recibe el maestro entero', async () => {
    const { controlador, listar } = armar();

    await controlador.listar(usuario(RolDepartamental.DIRECTOR));

    expect(filtroUsado(listar).direccion).toEqual([]);
  });

  it('y la DAF sí ve el suyo, porque tiene gente aunque no tenga área', async () => {
    const { controlador, listar } = armar();

    await controlador.listar(usuario(RolDepartamental.ADMINISTRADOR_DAF));

    expect(filtroUsado(listar).direccion).toEqual([RolDepartamental.DAF]);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LA FICHA POR IDENTIFICADOR TAMBIÉN SE ACOTA. Agujero cerrado el 2026-09-01.
 *
 * El listado se acotó el 27-AGO con PER-09; `GET /administracion/personal/:id` **no**, y
 * hereda el `@Roles` de la clase, que admite a los tres roles departamentales. Cualquiera
 * de ellos podía recorrer identificadores y leer cédula y teléfono de toda la AMC.
 *
 * Acotar la lista y dejar abierta la ficha no es acotar nada: quien conoce un número no
 * pasa por la lista.
 *
 * SE COMPRUEBA QUE LA PUERTA **CONSULTA** EL ALCANCE, no se vuelve a decidir aquí quién
 * pasa. Esa decisión es de `FuncionariosService` y tiene sus propias pruebas; repetirla
 * en el doble sería probar la copia en lugar del original.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('P-07 · la ficha por identificador se acota igual que la lista', () => {
  it('pregunta por la dirección de esa ficha y por los roles de quien pide', async () => {
    const { controlador, exigirEnSuAlcance } = armar({
      direccion: RolDepartamental.DMIT_INSTRUCTOR,
    });

    await controlador.listar(usuario(RolDepartamental.ADMINISTRADOR_DMIT));
    await controlador.obtener(7, usuario(RolDepartamental.ADMINISTRADOR_DMIT));

    expect(exigirEnSuAlcance).toHaveBeenCalledWith(
      RolDepartamental.DMIT_INSTRUCTOR,
      [RolDepartamental.ADMINISTRADOR_DMIT],
      { funcionarioId: 7 },
    );
  });

  /**
   * ES LA QUE DISCRIMINA. La anterior pasaría aunque el controlador ignorase el veredicto;
   * ésta exige que un rechazo del servicio impida devolver la ficha.
   */
  it('y si el alcance la rechaza, no devuelve la ficha', async () => {
    const { controlador, exigirEnSuAlcance } = armar({
      direccion: RolDepartamental.DMIP_OPERATIVOS,
    });

    exigirEnSuAlcance.mockRejectedValue(new Error('fuera de su alcance'));

    await expect(
      controlador.obtener(7, usuario(RolDepartamental.ADMINISTRADOR_DMIT)),
    ).rejects.toThrow('fuera de su alcance');
  });
});

describe('P-07 · qué direcciones dice el servidor que se gestionan', () => {
  /**
   * La pantalla necesita saberlo para dos cosas: con qué dirección nace un alta y cuáles
   * ofrece el desplegable. Deducirlo en el navegador con `rolCodes.includes(direccion)`
   * acierta para un rol departamental y devuelve **vacío** para un administrador, que no
   * es ninguna dirección: administra unas cuantas.
   */
  it('el de Instrucción recibe la suya', async () => {
    const { controlador } = armar();

    await expect(
      controlador.direccionesQueGestiona(
        usuario(RolDepartamental.ADMINISTRADOR_DMIT),
      ),
    ).resolves.toEqual([RolDepartamental.DMIT_INSTRUCTOR]);
  });

  it('el de la DMIP recibe sus dos unidades', async () => {
    const { controlador } = armar();

    await expect(
      controlador.direccionesQueGestiona(
        usuario(RolDepartamental.ADMINISTRADOR_DMIP),
      ),
    ).resolves.toEqual([
      RolDepartamental.DMIP_OPERATIVOS,
      RolDepartamental.DMIP_INSPECCIONES,
    ]);
  });

  /**
   * ES LA QUE DISCRIMINA. Un rol departamental sigue recibiendo la suya —pertenecer
   * también alcanza, PER-09 no cambió— y quien no pertenece ni administra, ninguna.
   */
  it('un rol departamental la suya, y quien no gestiona nada recibe lista vacía', async () => {
    const { controlador } = armar();

    await expect(
      controlador.direccionesQueGestiona(
        usuario(RolDepartamental.DMIT_INSTRUCTOR),
      ),
    ).resolves.toEqual([RolDepartamental.DMIT_INSTRUCTOR]);

    await expect(
      controlador.direccionesQueGestiona(usuario(RolDepartamental.DIRECTOR)),
    ).resolves.toEqual([]);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * B2 · EN UN ALTA DESDE AUTH, EL CORREO INSTITUCIONAL LO PONE AUTH (2026-10-08).
 *
 * El que manda el navegador se descarta: el servidor pregunta a Auth por la cédula. El alta
 * MANUAL —«¿No aparece? Registro manual»— sigue guardando el del cliente.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('P-07 · alta: el correo institucional de origen AUTH lo toma el servidor', () => {
  const FICHA = {
    cedula: '1712345678',
    apellidos: 'ABAD MOLINA',
    nombres: 'VERONICA',
    area: 'GENERAL',
    tipoContrato: 'OCASIONAL',
    correoInstitucional: 'manipulado@ejemplo.com',
  };

  const armarAlta = () => {
    const crear = jest
      .fn()
      .mockImplementation((datos: Record<string, unknown>) =>
        Promise.resolve({ id: 99, activo: true, ...datos }),
      );
    const correoPorCedula = jest
      .fn()
      .mockResolvedValue('veronica.abad@quito.gob.ec');
    const controlador = new AdministracionPersonalController(
      { crear } as unknown as FuncionariosService,
      {} as unknown as DisponibilidadService,
      {} as unknown as CoberturaTurnosService,
      { correoPorCedula } as unknown as CorreoInstitucionalAuthService,
    );
    return { controlador, crear, correoPorCedula };
  };

  const conToken = {
    ...usuario(RolDepartamental.ADMINISTRADOR_DMIP),
    tokenAuth: 'token-de-sesion',
  } as UsuarioAutenticado;

  it('AUTH · ignora el correo del cliente y guarda el de Auth', async () => {
    const { controlador, crear, correoPorCedula } = armarAlta();

    await controlador.crear(
      { ...FICHA, origen: 'AUTH' } as unknown as CrearFuncionarioDto,
      conToken,
    );

    expect(correoPorCedula).toHaveBeenCalledWith(
      '1712345678',
      'token-de-sesion',
    );
    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({
        correoInstitucional: 'veronica.abad@quito.gob.ec',
      }),
      1,
      conToken.roles,
    );
  });

  it('MANUAL · no pregunta a Auth y conserva el correo del cliente', async () => {
    const { controlador, crear, correoPorCedula } = armarAlta();

    await controlador.crear(
      { ...FICHA, origen: 'MANUAL' } as unknown as CrearFuncionarioDto,
      conToken,
    );

    expect(correoPorCedula).not.toHaveBeenCalled();
    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({
        correoInstitucional: 'manipulado@ejemplo.com',
      }),
      1,
      conToken.roles,
    );
  });

  /*
    DEFECTO DEL 2026-10-08: `origen` llegaba a `funcionario.create()`, que no tiene esa columna,
    y Prisma rechazaba TODA el alta («Unknown argument»), en AUTH y en MANUAL. Las dos pruebas de
    arriba no lo veían porque solo miran lo que SÍ viaja.
  */
  it.each(['AUTH', 'MANUAL'])(
    '%s · `origen` no llega a la ficha que se guarda',
    async (origen) => {
      const { controlador, crear } = armarAlta();

      await controlador.crear(
        { ...FICHA, origen } as unknown as CrearFuncionarioDto,
        conToken,
      );

      expect(crear).toHaveBeenCalledWith(
        expect.not.objectContaining({ origen }),
        1,
        conToken.roles,
      );
    },
  );
});
