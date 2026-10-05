/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: directorio-auth.service.spec.ts
 * Responsabilidad: Verificar el cruce entre el directorio de Auth y las fichas locales.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-21
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LO QUE SE PROTEGE AQUÍ NO DA NINGÚN ERROR SI SE ROMPE.
 *
 *   · Si el filtro de activos cae, la pantalla ofrece dar de alta a gente que la
 *     institución dio de baja. Auth **no filtra**: manda a todos, bajas incluidas.
 *   · Si el cruce por cédula cae, alguien que ya tiene ficha aparece como que no la
 *     tiene, se le crea una segunda, y la segunda choca contra el índice único — pero
 *     recién en el momento de guardar, y sin que nadie entienda por qué.
 *   · Si las fichas inactivas se excluyen del cruce, quien reingresa aparece «sin ficha»
 *     y ocurre exactamente lo mismo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { AreaPersonal, RolDepartamental, TipoContrato } from '@prisma/client';

import type { FuncionariosService } from '../../talento-operativo/application/funcionarios.service';
import {
  AuthNoDisponibleError,
  type AuthUsuariosClient,
  type UsuarioDeAuth,
} from '../infrastructure/auth-usuarios.client';
import { UsuariosAdminService } from './usuarios-admin.service';
import { DirectorioAuthService, partirNombre } from './directorio-auth.service';

const TOKEN = 'token-de-auth';

const deAuth = (parcial: Partial<UsuarioDeAuth> = {}): UsuarioDeAuth => ({
  id: 1,
  nombre: 'SOSA BARZOLA JOSE LUIS',
  usuario: 'jlsosa',
  cedula: '0924402068',
  correo: 'jose.sosa@quito.gob.ec',
  dependencia: 'Dirección Metropolitana de Inspección',
  roles: ['(SIGOC) Transporte - Operativos'],
  activo: true,
  inspector: null,
  ...parcial,
});

const ficha = (parcial: Record<string, unknown> = {}) =>
  ({
    id: 150,
    cedula: '0924402068',
    apellidos: 'SOSA BARZOLA',
    nombres: 'JOSE LUIS',
    telefono: null,
    cargo: 'Agente',
    area: AreaPersonal.OPERATIVOS,
    tipoContrato: TipoContrato.NOMBRAMIENTO,
    direccion: RolDepartamental.DMIP_OPERATIVOS,
    activo: true,
    creadoEn: new Date(),
    actualizadoEn: new Date(),
    ...parcial,
  }) as never;

/** Una cuenta del cuadro, tal como la devuelve UsuariosAdminService.listar. */
const cuenta = (parcial: Record<string, unknown> = {}) =>
  ({
    id: 9,
    correo: 'quien.sea@quito.gob.ec',
    nombre: 'QUIEN SEA',
    identificadorAd: 'qsea',
    activo: true,
    roles: [{ rol: 'DMIP_OPERATIVOS' }],
    funcionario: null,
    ...parcial,
  }) as never;

const armar = (
  usuarios: UsuarioDeAuth[],
  fichas: ReturnType<typeof ficha>[] = [],
  cuentas: ReturnType<typeof cuenta>[] = [],
) => {
  const listarAuth = jest.fn().mockResolvedValue(usuarios);
  const listarFichas = jest.fn().mockResolvedValue(fichas);
  const listarCuentas = jest.fn().mockResolvedValue(cuentas);

  return {
    servicio: new DirectorioAuthService(
      { listar: listarAuth } as unknown as AuthUsuariosClient,
      { listar: listarFichas } as unknown as FuncionariosService,
      { listar: listarCuentas } as unknown as UsuariosAdminService,
    ),
    listarAuth,
    listarFichas,
    listarCuentas,
  };
};

describe('DirectorioAuthService · el cruce', () => {
  /**
   * AUTH NO FILTRA: `GET /users` devuelve la institución completa, activos e inactivos.
   * Sin este descarte, la pantalla invitaría a fichar a quien ya no trabaja allí.
   */
  it('descarta a los inactivos de Auth', async () => {
    const { servicio } = armar([
      deAuth({ id: 1, cedula: '0924402068', activo: true }),
      deAuth({
        id: 2,
        cedula: '1719446302',
        nombre: 'PAREDES SOLIS ANA',
        activo: false,
      }),
    ]);

    const filas = await servicio.consultar(TOKEN);

    expect(filas).toHaveLength(1);
    expect(filas[0].cedula).toBe('0924402068');
  });

  it('marca sin ficha a quien todavía no la tiene', async () => {
    const { servicio } = armar([deAuth()], []);

    const [fila] = await servicio.consultar(TOKEN);

    expect(fila.ficha).toBeNull();
    expect(fila.correo).toBe('jose.sosa@quito.gob.ec');
    expect(fila.dependencia).toContain('Inspección');
  });

  it('enlaza la ficha por cédula cuando existe', async () => {
    const { servicio } = armar([deAuth()], [ficha()]);

    const [fila] = await servicio.consultar(TOKEN);

    expect(fila.ficha?.id).toBe(150);
    expect(fila.ficha?.tipoContrato).toBe(TipoContrato.NOMBRAMIENTO);
  });

  /**
   * QUIEN REINGRESA TIENE SU FICHA DESACTIVADA. Si el cruce solo mirara las vigentes,
   * aparecería como «sin ficha», se le crearía una segunda, y la cédula chocaría contra
   * `uq_funcionario_cedula` al guardar.
   */
  it('las fichas inactivas también cuentan: el reingreso no crea una segunda', async () => {
    const { servicio, listarFichas } = armar(
      [deAuth()],
      [ficha({ activo: false })],
    );

    const [fila] = await servicio.consultar(TOKEN);

    expect(listarFichas).toHaveBeenCalledWith({ incluirInactivos: true });
    expect(fila.ficha).not.toBeNull();
    expect(fila.ficha?.activo).toBe(false);
  });

  /** Sin cédula no hay con qué cruzar, y decirlo es más útil que ocultar la fila. */
  it('quien no tiene cédula en Auth se muestra, y sin ficha', async () => {
    const { servicio } = armar([deAuth({ cedula: '' })], [ficha()]);

    const [fila] = await servicio.consultar(TOKEN);

    expect(fila.ficha).toBeNull();
  });

  /** Lo pendiente primero: es el trabajo que la pantalla existe para hacer. */
  it('ordena delante a quienes falta fichar', async () => {
    const { servicio } = armar(
      [
        deAuth({ id: 1, cedula: '0924402068', nombre: 'AAA CON FICHA' }),
        deAuth({ id: 2, cedula: '1719446302', nombre: 'ZZZ SIN FICHA' }),
      ],
      [ficha()],
    );

    const filas = await servicio.consultar(TOKEN);

    expect(filas[0].nombre).toBe('ZZZ SIN FICHA');
    expect(filas[0].ficha).toBeNull();
  });

  /** El fallo de Auth se traslada tal cual: el controlador lo traduce a la pantalla. */
  it('propaga la caída de Auth en lugar de devolver una lista vacía', async () => {
    const caido = new AuthNoDisponibleError('Auth central no respondió.');
    const { servicio } = armar([]);
    // Se sustituye el doble para simular el fallo de red.
    const conFallo = new DirectorioAuthService(
      { listar: jest.fn().mockRejectedValue(caido) } as never,
      { listar: jest.fn().mockResolvedValue([]) } as never,
      { listar: jest.fn().mockResolvedValue([]) } as never,
    );

    await expect(conFallo.consultar(TOKEN)).rejects.toBe(caido);
    // Y el servicio sano sigue funcionando: la prueba anterior no lo dejó roto.
    await expect(servicio.consultar(TOKEN)).resolves.toEqual([]);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LA PARTICIÓN DEL NOMBRE ES UNA HEURÍSTICA, Y ESTAS PRUEBAS LA FIJAN COMO TAL.
 *
 * Auth guarda el nombre en un solo campo. No hay forma de separarlo con certeza, y por eso
 * el resultado llega al formulario como valor **editable**. Lo que aquí se garantiza es que
 * el criterio sea el mismo que usa Auth —dos primeras palabras como apellidos— y que no
 * invente nada cuando no hay material.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('partirNombre', () => {
  it('toma las dos primeras palabras como apellidos', () => {
    expect(partirNombre('SOSA BARZOLA JOSE LUIS')).toEqual({
      apellidos: 'SOSA BARZOLA',
      nombres: 'JOSE LUIS',
    });
  });

  it('con un solo nombre, el resto va completo a nombres', () => {
    expect(partirNombre('PAREDES SOLIS ANA')).toEqual({
      apellidos: 'PAREDES SOLIS',
      nombres: 'ANA',
    });
  });

  /** Con dos palabras no hay nada que partir: inventar un nombre sería peor. */
  it('con dos palabras no adivina: deja todo como apellidos', () => {
    expect(partirNombre('CORDOVA LUIS')).toEqual({
      apellidos: 'CORDOVA LUIS',
      nombres: '',
    });
  });

  it('tolera espacios de más', () => {
    expect(partirNombre('  SOSA   BARZOLA   JOSE  ')).toEqual({
      apellidos: 'SOSA BARZOLA',
      nombres: 'JOSE',
    });
  });

  /**
   * EL CASO QUE LA HEURÍSTICA NO RESUELVE, y se deja escrito para que nadie crea que sí.
   * «DE LA TORRE PEREZ JUAN» tiene tres palabras de apellido. Sale mal, y por eso el
   * formulario lo muestra editable.
   */
  it('un apellido compuesto sale mal, y es la razón de que el campo sea editable', () => {
    expect(partirNombre('DE LA TORRE PEREZ JUAN')).toEqual({
      apellidos: 'DE LA',
      nombres: 'TORRE PEREZ JUAN',
    });
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL CRUCE CON LAS CUENTAS. 2026-09-01.
 *
 * P-11 empieza el alta eligiendo del directorio, igual que P-07 desde el 24-AGO. Para
 * eso necesita saber quién **ya tiene cuenta**, que no es lo mismo que quién tiene ficha:
 * un inspector sale a operativos y nunca entra al cuadro; quien administra entra y no
 * sale a ninguno.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('DirectorioAuthService · el cruce con las cuentas', () => {
  it('marca sin cuenta a quien todavía no la tiene', async () => {
    const { servicio } = armar([deAuth()], [], []);

    const [fila] = await servicio.consultar(TOKEN);

    expect(fila.cuenta).toBeNull();
  });

  /**
   * ES LA QUE DISCRIMINA. La anterior pasaría con un cruce que devolviera `null` siempre;
   * ésta exige que encuentre la cuenta, y **por el usuario de Auth**: es la llave del
   * canje y lo único que garantiza que hablamos de la misma persona.
   */
  it('enlaza la cuenta por el usuario de Auth, con sus roles', async () => {
    const { servicio } = armar(
      [deAuth({ usuario: 'jlsosa' })],
      [],
      [cuenta({ identificadorAd: 'jlsosa', roles: [{ rol: 'DIRECTOR' }] })],
    );

    const [fila] = await servicio.consultar(TOKEN);

    expect(fila.cuenta?.id).toBe(9);
    expect(fila.cuenta?.roles).toEqual(['DIRECTOR']);
  });

  /**
   * NO SE CRUZA POR CÉDULA, y esta prueba lo fija. Una cuenta puede no tener ficha —quien
   * administra no sale a operativos— y entonces no hay cédula por la que cruzar. Cruzar
   * por ella dejaría a esos administradores apareciendo como «sin cuenta» para siempre.
   */
  it('no confunde a dos personas por compartir cédula vacía', async () => {
    const { servicio } = armar(
      [deAuth({ usuario: 'otra', cedula: '' })],
      [],
      [cuenta({ identificadorAd: 'jlsosa' })],
    );

    const [fila] = await servicio.consultar(TOKEN);

    expect(fila.cuenta).toBeNull();
  });

  /**
   * LAS CUENTAS DESACTIVADAS TAMBIÉN CUENTAN, por el mismo motivo que las fichas
   * inactivas: quien reingresa conserva la suya, y presentarlo como «sin cuenta» llevaría
   * a crear una segunda que chocaría contra el índice único del correo.
   */
  it('la cuenta desactivada se entrega, diciendo que lo está', async () => {
    const { servicio } = armar(
      [deAuth({ usuario: 'jlsosa' })],
      [],
      [cuenta({ identificadorAd: 'jlsosa', activo: false })],
    );

    const [fila] = await servicio.consultar(TOKEN);

    expect(fila.cuenta).not.toBeNull();
    expect(fila.cuenta?.activo).toBe(false);
  });

  /** Una cuenta sin usuario de Auth no puede cruzarse con nadie, y no debe estorbar. */
  it('una cuenta sin usuario de Auth no se enlaza a ciegas', async () => {
    const { servicio } = armar(
      [deAuth({ usuario: 'jlsosa' })],
      [],
      [cuenta({ identificadorAd: null })],
    );

    const [fila] = await servicio.consultar(TOKEN);

    expect(fila.cuenta).toBeNull();
  });
});
