/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Maestro de personal y disponibilidad
 * Archivo: personal-disponibilidad.integracion-spec.ts
 * Responsabilidad: Verificar los seis casos del plan contra la base real.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * EXIGE LA BASE LEVANTADA. Se ejecuta con `npm run test:integracion`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOBRE LAS PERSONAS DE ESTA PRUEBA
 *
 * `t_funcionario` está VACÍA por PV-02: falta la base certificada con el tipo de
 * contrato. Esta prueba crea sus propias fichas y las borra al terminar.
 *
 * NO SON DATOS DE NADIE. Los apellidos son `PRUEBA_M10`, las cédulas se compusieron
 * con el algoritmo de módulo 10 y los teléfonos son inventados. Nada de esto es
 * personal de la AMC, y el prefijo lo hace evidente en cualquier consulta.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AreaPersonal,
  PoliticaVehiculo,
  RolDepartamental,
  TipoContrato,
} from '@prisma/client';
import type { Server } from 'node:http';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { correlacionMiddleware } from '../src/common/interceptors/correlacion.middleware';
import { LoggerService } from '../src/common/logger/logger.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { como } from './identidad-de-prueba';

const ADMINISTRADOR = '6';
const INSPECCIONES = '2';
const OPERATIVOS = '1';
/** Los dos administradores de area, desde el 2026-09-01. */
const ADMIN_DMIT = '8';
const ADMIN_DAF = '9';
const API = '/api/v1';
const PREFIJO = 'PRUEBA_M10';

/** Compuestas con el algoritmo de módulo 10. No pertenecen a ninguna persona. */
const CEDULA_UNO = '1710034065';
const CEDULA_DOS = '0926687856';

interface FuncionarioRespuesta {
  id: number;
  cedula: string;
  apellidos: string;
  telefono: string | null;
  activo: boolean;
}

interface ElegibleRespuesta {
  id: number;
  apellidos: string;
  /** Desde PV-37 la lista llega completa y cada persona trae su veredicto. */
  elegible: boolean;
  motivo: string | null;
}

describe('Personal y disponibilidad · integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let creadoId = 0;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = modulo.createNestApplication({ bufferLogs: true });
    app.use(correlacionMiddleware);
    // La identidad viaja en la cookie de sesion: sin esto `request.cookies` es indefinido
    // y toda peticion recibe 401. Lo registra tambien `main.ts`.
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter(app.get(LoggerService)));
    await app.init();

    prisma = app.get(PrismaService);

    await limpiar();

    // Un formulario de prueba con sus áreas, para la consulta de elegibles.
    await prisma.formulario.create({
      data: {
        numero: 8,
        codigo: `${PREFIJO}_INSP`,
        nombre: 'FORMULARIO DE PRUEBA M10',
        colorFondo: '#EEEEEE',
        colorAcento: '#000000',
        colorNombre: 'gris',
        rolDueno: RolDepartamental.DMIP_INSPECCIONES,
        politicaVehiculo: PoliticaVehiculo.CONDICIONAL,
        condicionanteNoct: false,
        esPatrulla: false,
        orden: 8,
        areas: {
          create: [{ area: AreaPersonal.GENERAL }],
        },
      },
    });
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  /** El orden importa: las ausencias caen en cascada con el funcionario. */
  const limpiar = async (): Promise<void> => {
    await prisma.funcionario.deleteMany({
      where: { apellidos: { startsWith: PREFIJO } },
    });
    await prisma.formulario.deleteMany({
      where: { codigo: { startsWith: PREFIJO } },
    });
  };

  const servidor = (): Server => app.getHttpServer() as Server;

  const nuevaFicha = (cedula: string, apellidos: string) => ({
    cedula,
    apellidos,
    nombres: 'PERSONA',
    telefono: '098 514 4231',
    cargo: 'Inspector',
    area: AreaPersonal.GENERAL,
    tipoContrato: TipoContrato.NOMBRAMIENTO,
    // Área DMIP: la zonal es opcional (2026-09-21); se envía una válida (zona 1 existe en pruebas).
    zonalId: 1,
    // La dirección la deriva el servidor del `area` desde el 2026-08-27; el alta ya no la
    // acepta en el cuerpo (respondería «no permite modificar direccion»).
  });

  describe('Alta de personal', () => {
    it('crea la ficha y la devuelve completa al ADMINISTRADOR', async () => {
      const respuesta = await request(servidor())
        .post(`${API}/administracion/personal`)
        .set(como(ADMINISTRADOR))
        .send(nuevaFicha(CEDULA_UNO, `${PREFIJO}_UNO`))
        .expect(201);

      const ficha = respuesta.body as FuncionarioRespuesta;
      creadoId = ficha.id;

      expect(ficha.cedula).toBe(CEDULA_UNO);
      expect(ficha.telefono).toBe('098 514 4231');
      expect(ficha.activo).toBe(true);
    });

    it('caso 1 · la cédula repetida se rechaza diciendo de quién es', async () => {
      const respuesta = await request(servidor())
        .post(`${API}/administracion/personal`)
        .set(como(ADMINISTRADOR))
        .send(nuevaFicha(CEDULA_UNO, `${PREFIJO}_REPETIDA`))
        // 409 CEDULA_CON_FICHA desde el rediseño de P-07 (2026-10-08).
        .expect(409);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        `${PREFIJO}_UNO`,
      );
    });

    it('rechaza una cédula con dígito verificador incorrecto', async () => {
      await request(servidor())
        .post(`${API}/administracion/personal`)
        .set(como(ADMINISTRADOR))
        .send(nuevaFicha('1710034066', `${PREFIJO}_MALA`))
        .expect(400);
    });

    it('exige el tipo de contrato, del que depende RN-26', async () => {
      const { tipoContrato, ...sinContrato } = nuevaFicha(
        CEDULA_DOS,
        `${PREFIJO}_SIN`,
      );
      expect(tipoContrato).toBeDefined();

      const respuesta = await request(servidor())
        .post(`${API}/administracion/personal`)
        .set(como(ADMINISTRADOR))
        .send(sinContrato)
        .expect(400);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        'tipo de contrato',
      );
    });

    it('un rol departamental no puede administrar personal', async () => {
      await request(servidor())
        .post(`${API}/administracion/personal`)
        .set(como(INSPECCIONES))
        .send(nuevaFicha(CEDULA_DOS, `${PREFIJO}_PROHIBIDA`))
        .expect(403);
    });

    it('sin identidad responde 401', async () => {
      await request(servidor())
        .get(`${API}/administracion/personal`)
        .expect(401);
    });
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * CADA DEPARTAMENTO VE A SU GENTE. PER-09, 2026-08-27.
   *
   * Hasta este cambio los tres roles departamentales se descargaban el maestro entero
   * —cédulas y teléfonos de toda la AMC— y la pantalla filtraba en memoria. Un filtro
   * de cliente no restringe nada: basta con mirar la respuesta de red.
   *
   * La segunda prueba es la que discrimina. La primera pasaría con un filtro que se
   * tomara del `query`, que es exactamente lo que había; solo la segunda distingue
   * «filtrado por quién pregunta» de «filtrado por lo que pide».
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  describe('El maestro se acota al departamento de quien consulta', () => {
    /** Dos fichas de departamentos distintos, para que haya algo que separar. */
    beforeAll(async () => {
      await prisma.funcionario.createMany({
        data: [
          {
            cedula: '1713175146',
            apellidos: `${PREFIJO}_DE_INSPECCIONES`,
            nombres: 'PERSONA',
            telefono: '098 514 4232',
            area: AreaPersonal.GENERAL,
            tipoContrato: TipoContrato.NOMBRAMIENTO,
            direccion: RolDepartamental.DMIP_INSPECCIONES,
          },
          {
            cedula: '1717639543',
            apellidos: `${PREFIJO}_DE_OPERATIVOS`,
            nombres: 'PERSONA',
            telefono: '098 514 4233',
            area: AreaPersonal.OPERATIVOS,
            tipoContrato: TipoContrato.NOMBRAMIENTO,
            direccion: RolDepartamental.DMIP_OPERATIVOS,
          },
        ],
        skipDuplicates: true,
      });
    });

    const apellidosQueVe = async (rol: string, consulta = '') => {
      const respuesta = await request(servidor())
        .get(`${API}/administracion/personal${consulta}`)
        .set(como(rol))
        .expect(200);

      return (respuesta.body as FuncionarioRespuesta[]).map(
        (ficha) => ficha.apellidos,
      );
    };

/**
     * ═══════════════════════════════════════════════════════════════════════════════
     * PER-09 SE REVIRTIÓ EL 2026-09-01: LA PANTALLA ES DE UN SOLO ROL.
     *
     * Estas tres pruebas afirmaban que cada departamento veía a su gente y solo a la
     * suya. El negocio decidió, viendo P-07 en marcha, que la abra únicamente
     * `ADMINISTRADOR_DMIP`, así que ahora ninguno de los tres llega al endpoint.
     *
     * SE CONSERVA EL CASO, INVERTIDO, en lugar de borrarlo. Es el mismo criterio que ya
     * aplicó `operativos.integracion-spec` cuando la jornada pasó a abrirse sola: que
     * quede constancia de que el acceso se retiró a propósito y no se perdió por
     * descuido. El día que se reabra, aquí está escrito qué se esperaba antes.
     * ═══════════════════════════════════════════════════════════════════════════════
     */
    const seLeNiega = async (rol: string) =>
      request(servidor())
        .get(`${API}/administracion/personal`)
        .set(como(rol))
        .expect(403);

    it('un rol departamental ya no entra al maestro', async () => {
      await seLeNiega(OPERATIVOS);
      await seLeNiega(INSPECCIONES);
    });

    /**
     * ES LA QUE DISCRIMINA. La anterior pasaría con un servidor que rechazara a todo el
     * mundo; ésta exige que el rechazo sea del rol y no del endpoint.
     */
    it('y el administrador de la DMIP sí, con el maestro entero', async () => {
      const vistos = await apellidosQueVe(ADMINISTRADOR);

      expect(vistos).toContain(`${PREFIJO}_DE_OPERATIVOS`);
      expect(vistos).toContain(`${PREFIJO}_DE_INSPECCIONES`);
    });

    /**
     * EL ALCANCE POR DIRECCIÓN SIGUE VIVO AUNQUE HOY NO RECHACE A NADIE.
     *
     * `ADMINISTRADOR_DMIP` recibió las cuatro direcciones en `20260901094000`, porque si
     * es el único que entra y solo alcanzaba las dos de la DMIP, el personal de
     * Instrucción y de la DAF se quedaba sin nadie que lo administrara.
     */
    it('y su alcance son las cuatro direcciones con personal', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/administracion/personal/direcciones`)
        .set(como(ADMINISTRADOR))
        .expect(200);

      expect(respuesta.body).toEqual([
        RolDepartamental.DMIP_OPERATIVOS,
        RolDepartamental.DMIP_INSPECCIONES,
        RolDepartamental.DMIT_INSTRUCTOR,
        RolDepartamental.DAF,
      ]);
    });
  });

  describe('Disponibilidad', () => {
    it('registra una ausencia', async () => {
      await request(servidor())
        .post(`${API}/administracion/personal/${creadoId}/disponibilidad`)
        .set(como(ADMINISTRADOR))
        .send({
          estado: 'VACACIONES',
          desde: '2026-09-01',
          hasta: '2026-09-15',
          motivo: 'Vacaciones programadas',
        })
        .expect(201);
    });

    it('caso 2 · INV-14 · el período solapado se rechaza', async () => {
      const respuesta = await request(servidor())
        .post(`${API}/administracion/personal/${creadoId}/disponibilidad`)
        .set(como(ADMINISTRADOR))
        .send({ estado: 'PERMISO', desde: '2026-09-10', hasta: '2026-09-20' })
        // 409 AUSENCIA_SOLAPADA desde el rediseño de P-07 (2026-10-08).
        .expect(409);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        '2026-09-01',
      );
    });

    it('caso 6 · la fecha de fin anterior al inicio se rechaza', async () => {
      await request(servidor())
        .post(`${API}/administracion/personal/${creadoId}/disponibilidad`)
        .set(como(ADMINISTRADOR))
        .send({ estado: 'PERMISO', desde: '2026-10-15', hasta: '2026-10-01' })
        .expect(400);
    });

    it('rechaza una fecha con otro formato', async () => {
      await request(servidor())
        .post(`${API}/administracion/personal/${creadoId}/disponibilidad`)
        .set(como(ADMINISTRADOR))
        .send({ estado: 'PERMISO', desde: '01/10/2026', hasta: '05/10/2026' })
        .expect(400);
    });

    /**
     * ═══════════════════════════════════════════════════════════════════════════════
     * QUIEN ALCANZA LA DIRECCIÓN LEE LAS AUSENCIAS; QUIEN NO, RECIBE 403. H-01.
     *
     * `creadoId` es de área GENERAL → dirección DMIP_INSPECCIONES. La lectura de sus
     * ausencias se acota con la MISMA vara que el registro (`exigirSuDepartamento`):
     * antes solo comprobaba que la ficha existiera, así que un administrador de otra
     * dirección podía iterar por `:id` y leer el `motivo` —posible dato de salud— de
     * personal ajeno (IDOR, A01).
     *
     * LA SEGUNDA ES LA QUE DISCRIMINA. `ADMINISTRADOR_DMIT` **sí** tiene
     * `personal:administrar` —pasa la guarda de permiso— pero administra
     * `DMIT_INSTRUCTOR`, no `DMIP_INSPECCIONES`: el 403 es del alcance, no del endpoint.
     * ═══════════════════════════════════════════════════════════════════════════════
     */
    it('las lista el administrador que alcanza la dirección', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/administracion/personal/${creadoId}/disponibilidad`)
        .set(como(ADMINISTRADOR))
        .expect(200);

      const estados = (respuesta.body as { estado: string }[]).map(
        (periodo) => periodo.estado,
      );
      expect(estados).toContain('VACACIONES');
    });

    it('IDOR · el administrador de otra dirección no las lee', async () => {
      await request(servidor())
        .get(`${API}/administracion/personal/${creadoId}/disponibilidad`)
        .set(como(ADMIN_DMIT))
        .expect(403);
    });
  });

  describe('GET /personal/elegible', () => {
    it('lo consulta un rol departamental y devuelve a la persona', async () => {
      const respuesta = await request(servidor())
        .get(
          `${API}/personal/elegible?formulario=${PREFIJO}_INSP&inicio=2026-08-06`,
        )
        .set(como(INSPECCIONES))
        .expect(200);

      const elegibles = (respuesta.body as ElegibleRespuesta[]).filter((p) =>
        p.apellidos.startsWith(PREFIJO),
      );
      expect(elegibles.map((p) => p.id)).toContain(creadoId);
    });

    /**
     * PV-37, resuelto el 11-AGO. **Antes esta prueba exigía lo contrario**: que quien
     * está ausente desapareciera de la lista.
     *
     * Se cambió porque desaparecer sin explicación obliga a levantar el teléfono, que es
     * el canal que este sistema existe para reemplazar: quien armaba el cuadro veía una
     * lista más corta sin saber por qué faltaba alguien.
     *
     * LA SEGUNDA MITAD ES LA QUE HAY QUE VIGILAR. Una ausencia dice QUE la hay, nunca
     * cuál es: no se publica que alguien está de vacaciones, de reposo médico o de
     * calamidad doméstica. Las reglas de descanso sí explican su rechazo entero, porque
     * son hechos operativos del cuadro; una ausencia, no.
     */
    it('caso 4 · quien está de vacaciones aparece, no elegible, y sin decir por qué', async () => {
      const respuesta = await request(servidor())
        .get(
          `${API}/personal/elegible?formulario=${PREFIJO}_INSP&inicio=2026-09-05`,
        )
        .set(como(INSPECCIONES))
        .expect(200);

      const nuestros = (respuesta.body as ElegibleRespuesta[]).filter((p) =>
        p.apellidos.startsWith(PREFIJO),
      );

      /*
       * ═══════════════════════════════════════════════════════════════════════════════
       * SE BUSCA LA FICHA, NO SE CUENTA LA LISTA. Corregido el 2026-08-31.
       *
       * Aquí había un `toHaveLength(1)`. Dejó de ser cierto el 27-AGO, cuando las pruebas
       * de PER-09 sumaron `PRUEBA_M10_DE_INSPECCIONES` —una ficha de `DMIP_INSPECCIONES`—
       * que este endpoint devuelve **con todo derecho**: desde esa misma fecha el personal
       * ofrecido se filtra por el departamento de quien pregunta, y quien pregunta aquí es
       * INSPECCIONES.
       *
       * No se vio hasta hoy porque la suite llevaba sin poder ejecutarse desde el 25-AGO.
       * El código acertaba; la cuenta era lo que había envejecido.
       *
       * Y contar nunca fue lo que esta prueba quería decir: lo que afirma es que **quien
       * está ausente aparece, no elegible, y sin publicar por qué**. Buscar la ficha dice
       * eso mismo y no vuelve a romperse cada vez que otra prueba siembre un compañero de
       * departamento.
       * ═══════════════════════════════════════════════════════════════════════════════
       */
      const ausente = nuestros.find((p) => p.id === creadoId);

      expect(ausente).toBeDefined();
      expect(ausente!.elegible).toBe(false);
      expect(ausente!.motivo).toContain('no está disponible');

      // Ni el tipo de ausencia ni el motivo que escribió el administrador salen de la
      // base. El funcionario que arma el cuadro no tiene por qué saberlos.
      expect(ausente!.motivo).not.toContain('VACACIONES');
      expect(ausente!.motivo).not.toContain('programadas');

      // El acompañante confirma que la lista no viene bloqueada en bloque: la misma
      // respuesta trae a alguien de su departamento SÍ elegible.
      const acompaniante = nuestros.find(
        (p) => p.apellidos === `${PREFIJO}_DE_INSPECCIONES`,
      );

      expect(acompaniante?.elegible).toBe(true);
    });

    it('caso 5 · LA RESPUESTA NO LLEVA TELÉFONO NI CÉDULA', async () => {
      const respuesta = await request(servidor())
        .get(
          `${API}/personal/elegible?formulario=${PREFIJO}_INSP&inicio=2026-08-06`,
        )
        .set(como(INSPECCIONES))
        .expect(200);

      const cuerpo = JSON.stringify(respuesta.body);
      expect(cuerpo).not.toContain('98 514');
      expect(cuerpo).not.toContain(CEDULA_UNO);
      expect(cuerpo).not.toContain('telefono');
      expect(cuerpo).not.toContain('cedula');
    });

    it('exige el formulario y la fecha', async () => {
      await request(servidor())
        .get(`${API}/personal/elegible?inicio=2026-08-06`)
        .set(como(INSPECCIONES))
        .expect(400);

      await request(servidor())
        .get(`${API}/personal/elegible?formulario=${PREFIJO}_INSP`)
        .set(como(INSPECCIONES))
        .expect(400);
    });

    it('un formulario inexistente responde 404', async () => {
      await request(servidor())
        .get(`${API}/personal/elegible?formulario=NO_EXISTE&inicio=2026-08-06`)
        .set(como(INSPECCIONES))
        .expect(404);
    });
  });

  describe('Baja lógica', () => {
    it('caso 3 · la ficha se conserva y deja de ofrecerse', async () => {
      const baja = await request(servidor())
        .delete(`${API}/administracion/personal/${creadoId}`)
        .set(como(ADMINISTRADOR))
        .expect(200);

      expect((baja.body as { activo: boolean }).activo).toBe(false);

      // Sigue en la base.
      const enBase = await prisma.funcionario.findUnique({
        where: { id: creadoId },
      });
      expect(enBase).not.toBeNull();
      expect(enBase?.activo).toBe(false);

      // Y ya no aparece entre los elegibles.
      const elegibles = await request(servidor())
        .get(
          `${API}/personal/elegible?formulario=${PREFIJO}_INSP&inicio=2026-08-06`,
        )
        .set(como(INSPECCIONES))
        .expect(200);

      expect(
        (elegibles.body as ElegibleRespuesta[]).map((p) => p.id),
      ).not.toContain(creadoId);
    });

    it('el reingreso devuelve la ficha al maestro', async () => {
      await request(servidor())
        .put(`${API}/administracion/personal/${creadoId}`)
        .set(como(ADMINISTRADOR))
        .send({ activo: true })
        .expect(200);

      const enBase = await prisma.funcionario.findUnique({
        where: { id: creadoId },
      });
      expect(enBase?.activo).toBe(true);
    });
  });

  describe('Auditoría', () => {
    it('LA TRAZA DEL TELÉFONO NO GUARDA EL NÚMERO', async () => {
      await request(servidor())
        .put(`${API}/administracion/personal/${creadoId}`)
        .set(como(ADMINISTRADOR))
        .send({ telefono: '099 111 2233' })
        .expect(200);

      const trazas = await prisma.auditoria.findMany({
        where: { entidad: 't_funcionario', entidadId: creadoId },
        orderBy: { id: 'desc' },
        take: 1,
      });

      expect(trazas[0].campo).toBe('func_telefono');
      expect(trazas[0].valorNuevo).toBe('[dato personal]');
      expect(trazas[0].valorAnterior).toBe('[dato personal]');
      expect(trazas[0].usuario).toBe(6);
      expect(trazas[0].rol).toBe(RolDepartamental.ADMINISTRADOR_DMIP);
    });

    it('la traza de la ausencia no guarda el motivo', async () => {
      const trazas = await prisma.auditoria.findMany({
        where: { entidad: 't_disponibilidad' },
        orderBy: { id: 'desc' },
        take: 1,
      });

      expect(trazas[0].valorNuevo).toContain('VACACIONES');
      expect(trazas[0].valorNuevo).not.toContain('programadas');
    });
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * QUIÉN ADMINISTRA EL MAESTRO DE PERSONAL. Corregido el 2026-09-02.
   *
   * `ADMINISTRADOR_DMIP` y `ADMINISTRADOR_DMIT` administran P-07, cada uno ACOTADO a las
   * direcciones que declara `t_rol_direccion`: el DMIP alcanza las cuatro —incluida
   * Instrucción, que si no quedaría huérfana—; el DMIT, solo la suya. `ADMINISTRADOR_DAF`
   * se queda fuera: no está en el `@Roles` del controlador.
   *
   * La mañana del 2026-09-01 se probó lo contrario —que los dos administradores de área NO
   * entraban— y esa misma tarde el negocio le devolvió al DMIT su personal de Instrucción
   * («AHORA entra ADMINISTRADOR_DMIT», ver el `@Roles` de `administracion-personal.controller.ts`).
   * El alcance vive en `t_rol_direccion`, y estas pruebas lo comprueban CONTRA LA BASE.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  describe('Quién administra el maestro de personal', () => {
    const CEDULA_DMIT = '1710034073';

    beforeAll(async () => {
      await prisma.funcionario.createMany({
        data: [
          {
            cedula: CEDULA_DMIT,
            apellidos: `${PREFIJO}_DE_INSTRUCCION`,
            nombres: 'PERSONA',
            telefono: '098 514 4234',
            area: AreaPersonal.INSTRUCCION,
            tipoContrato: TipoContrato.NOMBRAMIENTO,
            direccion: RolDepartamental.DMIT_INSTRUCTOR,
          },
        ],
        skipDuplicates: true,
      });
    });

    it('el de Instrucción entra al listado, acotado a su personal', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/administracion/personal`)
        .set(como(ADMIN_DMIT))
        .expect(200);

      const apellidos = (respuesta.body as FuncionarioRespuesta[]).map(
        (ficha) => ficha.apellidos,
      );
      // Ve a su personal de Instrucción...
      expect(apellidos).toContain(`${PREFIJO}_DE_INSTRUCCION`);
      // ...y no al de otras direcciones: `_UNO` es del área GENERAL, que no administra.
      expect(apellidos).not.toContain(`${PREFIJO}_UNO`);
    });

    it('el de la DAF no entra al maestro', async () => {
      await request(servidor())
        .get(`${API}/administracion/personal`)
        .set(como(ADMIN_DAF))
        .expect(403);
    });

    it('el de Instrucción da de alta en su propia dirección', async () => {
      // La dirección la deriva el servidor del `area`; el cuerpo ya no la lleva.
      const respuesta = await request(servidor())
        .post(`${API}/administracion/personal`)
        .set(como(ADMIN_DMIT))
        .send({
          cedula: CEDULA_DOS,
          apellidos: `${PREFIJO}_ALTA_DMIT`,
          nombres: 'PERSONA',
          area: AreaPersonal.INSTRUCCION,
          tipoContrato: TipoContrato.NOMBRAMIENTO,
        })
        .expect(201);

      expect((respuesta.body as FuncionarioRespuesta).cedula).toBe(CEDULA_DOS);
    });

    it('pero no en un área que no administra (PER-09)', async () => {
      // GENERAL pertenece a otra dirección; el alcance lo rechaza ANTES de la unicidad,
      // así que la cédula puede ser una ya existente sin que cambie el resultado.
      await request(servidor())
        .post(`${API}/administracion/personal`)
        .set(como(ADMIN_DMIT))
        .send({
          cedula: CEDULA_UNO,
          apellidos: `${PREFIJO}_FUERA_DE_ALCANCE`,
          nombres: 'PERSONA',
          area: AreaPersonal.GENERAL,
          tipoContrato: TipoContrato.NOMBRAMIENTO,
        })
        .expect(403);
    });

    it('y el de la DAF tampoco da de alta', async () => {
      await request(servidor())
        .post(`${API}/administracion/personal`)
        .set(como(ADMIN_DAF))
        .send({
          cedula: CEDULA_DOS,
          apellidos: `${PREFIJO}_ALTA_DAF`,
          nombres: 'PERSONA',
          area: AreaPersonal.INSTRUCCION,
          tipoContrato: TipoContrato.NOMBRAMIENTO,
        })
        .expect(403);
    });

    /**
     * ES LA QUE DISCRIMINA, Y LA RAZÓN DE QUE EXISTA LA MIGRACIÓN `20260901094000`.
     *
     * Sin ella, dejar P-07 en un solo rol habría dejado al personal de Instrucción y de
     * la DAF sin nadie que pudiera verlo ni corregirlo. No habría fallado nada al
     * desplegar: se habría descubierto semanas después, buscando a alguien que no está.
     */
    it('y el de la DMIP sí ve al personal de Instrucción, que si no quedaría huérfano', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/administracion/personal`)
        .set(como(ADMINISTRADOR))
        .expect(200);

      const apellidos = (respuesta.body as FuncionarioRespuesta[]).map(
        (ficha) => ficha.apellidos,
      );

      expect(apellidos).toContain(`${PREFIJO}_DE_INSTRUCCION`);
    });

    /**
     * QUE LA RUTA NO SE LA TRAGUE `:id`. Es el único riesgo que una prueba unitaria no
     * puede ver: Nest resuelve por orden de declaración y `:id` lleva `ParseIntPipe`, así
     * que declarada después esta ruta respondería 400 en lugar de la lista.
     */
    it('el endpoint de direcciones resuelve, y no como identificador', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/administracion/personal/direcciones`)
        .set(como(ADMINISTRADOR))
        .expect(200);

      expect(respuesta.body).toHaveLength(4);
    });
  });
});
