/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: ordenes-servicio.integracion-spec.ts
 * Responsabilidad: Verificar los nueve casos del plan contra la base real.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * EXIGE LA BASE LEVANTADA. Se ejecuta con `npm run test:integracion`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRES CASOS SOLO SE VEN AQUÍ.
 *
 *   · **5 y 6** · que dos usuarios vean **solo lo suyo**, y que manipular la petición no
 *     sirva de nada. Es RN-49, y depende del enlace usuario–funcionario que solo existe
 *     en la base.
 *   · **7** · la reemisión. `uq_orden_vigente` es un índice único PARCIAL: que la
 *     primera quede no vigente y la nueva sea la única vigente lo garantiza PostgreSQL,
 *     no el servicio.
 *   · **8** · que cambiar el conductor **no** altere la orden ya emitida. Con dobles se
 *     comprobaría que el servicio no la reescribe; aquí se comprueba que el contenido
 *     guardado sigue diciendo lo mismo después de que la DAF cambie el transporte.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AreaPersonal,
  PoliticaVehiculo,
  AccesoFormulario,
  RolDepartamental,
  type VentanaCarga,
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

const PREFIJO = 'PRUEBA_M20';
const API = '/api/v1';

const OPERATIVOS_ROL = '1';
const DAF = '4';
const DIRECTOR = '5';

const FECHA = '2027-03-15';

interface OrdenRespuesta {
  codigo: string;
  emitidaEn: string;
  vigente: boolean;
  fechaJornada: string;
  datoAislado: {
    horario: string;
    funcionario: string;
    conductor: { nombre: string; telefono: string | null } | null;
    placa: string | null;
  };
}

describe('Órdenes de servicio · integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ventanasIniciales: VentanaCarga[] = [];

  let operativoConTres = 0;
  let operativoSinPersonal = 0;
  let benavides = 0;
  let segovia = 0;
  let taco = 0;
  let conductor = 0;
  let otroConductor = 0;
  let vehiculo = 0;
  let usuarioDeBenavides = 0;
  let usuarioDeSegovia = 0;

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

    ventanasIniciales = await prisma.ventanaCarga.findMany();
    await prisma.ventanaCarga.updateMany({ data: { activo: false } });

    const institucionales = await prisma.formulario.count({
      where: { codigo: { not: { startsWith: PREFIJO } } },
    });
    if (institucionales > 0) {
      throw new Error(
        't_formulario ya tiene formularios institucionales. Esta prueba crea el suyo con el número 6 y chocaría con ellos: revise la estrategia de datos de prueba antes de continuar.',
      );
    }

    const formulario = await prisma.formulario.create({
      data: {
        numero: 6,
        codigo: `${PREFIJO}_ICNECU`,
        nombre: 'PATRULLA REACCION NOCTURNA',
        colorFondo: '#EEEEEE',
        colorAcento: '#000000',
        colorNombre: 'gris',
        rolDueno: RolDepartamental.DMIP_OPERATIVOS,
        politicaVehiculo: PoliticaVehiculo.REQUERIDO,
        orden: 6,
        // Autorización en t_formulario_rol (2026-08-25): el dueño registra (ESCRITURA).
        roles: {
          create: [
            {
              rol: RolDepartamental.DMIP_OPERATIVOS,
              acceso: AccesoFormulario.ESCRITURA,
            },
          ],
        },
        prefijos: { create: [{ prefijo: 'ICNECU', esPredeterminado: true }] },
        areas: { create: [{ area: AreaPersonal.GENERAL }] },
      },
    });

    const zonal = await prisma.zonal.findFirstOrThrow({
      orderBy: { orden: 'asc' },
    });
    const punto = await prisma.puntoEncuentro.create({
      data: {
        nombre: `${PREFIJO} EL TEJAR`,
        zonalId: zonal.id,
        formularios: { create: [{ formularioId: formulario.id }] },
      },
    });
    const tipo = await prisma.tipoControl.create({
      data: {
        nombre: `${PREFIJO} CONTROL`,
        formularioId: formulario.id,
      },
    });
    const entidad = await prisma.institucion.create({
      data: {
        sigla: `${PREFIJO}AMC`,
        nombre: 'Agencia de prueba M20',
        formularios: { create: [{ formularioId: formulario.id }] },
      },
    });

    benavides = await crearFuncionario('0501', 'BENAVIDES', 'FERNANDO');
    segovia = await crearFuncionario('0502', 'SEGOVIA', 'MARIA');
    taco = await crearFuncionario('0503', 'TACO', 'ROBERTO');

    vehiculo = (
      await prisma.vehiculo.create({
        data: { placa: 'PMA7892', descripcion: `${PREFIJO} camioneta` },
      })
    ).id;
    conductor = (
      await prisma.conductor.create({
        data: {
          cedula: '5555550501',
          nombreCompleto: `${PREFIJO} VIVANCO JORGE`,
          telefono: '0978631797',
          vehiculoHabitualId: vehiculo,
        },
      })
    ).id;
    otroConductor = (
      await prisma.conductor.create({
        data: {
          cedula: '5555550502',
          nombreCompleto: `${PREFIJO} PAREDES LUIS`,
          telefono: '0987654321',
        },
      })
    ).id;

    // ─────────────────────────────────────────────────────────────────────────
    // El enlace usuario–funcionario que agrega la migración #7.
    //
    // Los identificadores se fijan A MANO —1 y 2— y no se dejan a la secuencia: mientras
    // la identidad sea provisional, `IdentidadGuard` resuelve el rol con
    // `test/identidad-de-prueba.ts`, donde el 1 es Operativos y el 2 Inspecciones. Si
    // estas filas tomaran otro identificador, la cookie de sesión traería un `usuarioId`
    // que no enlaza con ninguna ficha y `GET /ordenes-servicio/mias` respondería que la
    // cuenta no tiene personal asociado, sin que el fallo dijera por qué.
    //
    // Se comprueba antes que la tabla esté libre, para no pisar datos institucionales.
    // ─────────────────────────────────────────────────────────────────────────
    const usuariosExistentes = await prisma.usuario.count({
      where: { id: { in: [1, 2] } },
    });
    if (usuariosExistentes > 0) {
      throw new Error(
        't_usuario ya tiene filas con los identificadores 1 y 2. Esta prueba los necesita para enlazar con las identidades de test/identidad-de-prueba.ts: revise la estrategia de datos de prueba antes de continuar.',
      );
    }

    usuarioDeBenavides = (
      await prisma.usuario.create({
        data: {
          id: 1,
          correo: `${PREFIJO.toLowerCase()}.benavides@amc.gob.ec`,
          nombre: 'BENAVIDES FERNANDO',
          roles: { create: [{ rol: RolDepartamental.DMIP_OPERATIVOS }] },
          funcionarioId: benavides,
        },
      })
    ).id;
    usuarioDeSegovia = (
      await prisma.usuario.create({
        data: {
          id: 2,
          correo: `${PREFIJO.toLowerCase()}.segovia@amc.gob.ec`,
          nombre: 'SEGOVIA MARIA',
          roles: { create: [{ rol: RolDepartamental.DMIP_INSPECCIONES }] },
          funcionarioId: segovia,
        },
      })
    ).id;

    await prisma.cuadroDiario.create({
      data: {
        fecha: new Date(`${FECHA}T00:00:00.000Z`),
        ordenTrabajo: `${PREFIJO}-OT-001`,
        nroSemana: 11,
        anioSemana: 2027,
      },
    });

    const registrar = (horaInicio: string, horaFin: string) =>
      request(servidor())
        .post(`${API}/operativos`)
        .set(como(OPERATIVOS_ROL))
        .send({
          cuadroFecha: FECHA,
          formularioCodigo: `${PREFIJO}_ICNECU`,
          horaInicio,
          horaFin,
          zonalesIds: [zonal.id],
          puntoEncuentroId: punto.id,
          tipoControlId: tipo.id,
          institucionesIds: [entidad.id],
        })
        .expect(201);

    operativoConTres = ((await registrar('18:00', '23:30')).body as { id: number })
      .id;
    operativoSinPersonal = (
      (await registrar('08:00', '12:00')).body as { id: number }
    ).id;

    for (const funcionarioId of [benavides, segovia, taco]) {
      await request(servidor())
        .post(`${API}/operativos/${operativoConTres}/personal`)
        .set(como(OPERATIVOS_ROL))
        .send({ funcionarioId })
        .expect(201);
    }

    // La DAF asigna transporte: el dato aislado necesita conductor y placa.
    await request(servidor())
      .patch(`${API}/transporte/operativos/${operativoConTres}`)
      .set(como(DAF))
      .send({ conductorId: conductor, vehiculoId: vehiculo })
      .expect(200);
  });

  afterAll(async () => {
    await limpiar();

    for (const original of ventanasIniciales) {
      await prisma.ventanaCarga.update({
        where: { rol: original.rol },
        data: { activo: original.activo },
      });
    }
    await app.close();
  });

  const limpiar = async (): Promise<void> => {
    await prisma.ordenServicio.deleteMany({
      where: { codigo: { contains: 'ICNECU' } },
    });
    await prisma.cuadroDiario.deleteMany({
      where: { ordenTrabajo: { startsWith: PREFIJO } },
    });
    await prisma.formulario.deleteMany({
      where: { codigo: { startsWith: PREFIJO } },
    });
    await prisma.puntoEncuentro.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.tipoControl.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.institucion.deleteMany({
      where: { sigla: { startsWith: PREFIJO } },
    });
    await prisma.usuario.deleteMany({
      where: { correo: { startsWith: PREFIJO.toLowerCase() } },
    });
    await prisma.funcionario.deleteMany({
      where: { apellidos: { startsWith: PREFIJO } },
    });
    await prisma.conductor.deleteMany({
      where: { nombreCompleto: { startsWith: PREFIJO } },
    });
    await prisma.vehiculo.deleteMany({ where: { placa: 'PMA7892' } });
  };

  const crearFuncionario = async (
    sufijo: string,
    apellidos: string,
    nombres: string,
  ): Promise<number> => {
    const creado = await prisma.funcionario.create({
      data: {
        cedula: `555555${sufijo}`,
        apellidos: `${PREFIJO} ${apellidos}`,
        nombres,
        area: AreaPersonal.GENERAL,
        tipoContrato: 'OCASIONAL',
        direccion: RolDepartamental.DMIP_OPERATIVOS,
      },
    });
    return creado.id;
  };

  const servidor = (): Server => app.getHttpServer() as Server;

  const emitir = (usuario: string, operativoId: number) =>
    request(servidor())
      .post(`${API}/operativos/${operativoId}/ordenes-servicio`)
      .set(como(usuario));

  describe('casos 1 y 2 · la emisión', () => {
    it('caso 1 · un operativo con tres funcionarios produce TRES órdenes', async () => {
      const respuesta = await emitir(DIRECTOR, operativoConTres).expect(201);
      const ordenes = respuesta.body as OrdenRespuesta[];

      expect(ordenes).toHaveLength(3);
      expect(new Set(ordenes.map((orden) => orden.codigo)).size).toBe(3);
    });

    it('caso 1 · NINGUNA menciona a las otras dos', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/operativos/${operativoConTres}/ordenes-servicio`)
        .set(como(DIRECTOR))
        .expect(200);

      const ordenes = respuesta.body as OrdenRespuesta[];
      const deBenavides = ordenes.find((orden) =>
        orden.datoAislado.funcionario.includes('BENAVIDES'),
      );

      const contenido = JSON.stringify(deBenavides);
      expect(contenido).toContain('BENAVIDES');
      expect(contenido).not.toContain('SEGOVIA');
      expect(contenido).not.toContain('TACO');
    });

    it('caso 2 · el contenido guardado tiene EXACTAMENTE los cuatro campos', async () => {
      const guardada = await prisma.ordenServicio.findFirstOrThrow({
        where: { operativoId: operativoConTres, funcionarioId: benavides },
      });

      const dato = guardada.datoAislado as unknown as Record<string, unknown>;

      expect(Object.keys(dato).sort()).toEqual([
        'conductor',
        'funcionario',
        'horario',
        'placa',
      ]);
      expect(dato.horario).toBe('18H00 A 23H30');
      expect(dato.placa).toBe('PMA7892');
    });

    it('el punto de encuentro NO está en la orden, aunque el operativo lo tenga', async () => {
      // Es RN-51: el punto de los demás operativos es lo que permitía anticiparse.
      const guardada = await prisma.ordenServicio.findFirstOrThrow({
        where: { operativoId: operativoConTres, funcionarioId: benavides },
      });

      expect(JSON.stringify(guardada.datoAislado)).not.toContain('TEJAR');
      expect(JSON.stringify(guardada.datoAislado)).not.toContain('ICNECU');
    });

    it('caso 3 · un operativo sin personal responde 409', async () => {
      const respuesta = await emitir(DIRECTOR, operativoSinPersonal).expect(409);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        'no tiene personal asignado',
      );
    });

    it('caso 4 · un rol distinto de DIRECTOR no emite', async () => {
      const respuesta = await emitir(OPERATIVOS_ROL, operativoConTres).expect(
        403,
      );

      expect((respuesta.body as { codigo: string }).codigo).toBe(
        'PERMISO_INSUFICIENTE',
      );

      await emitir(DAF, operativoConTres).expect(403);
    });

    it('sin identidad responde 401', async () => {
      await request(servidor())
        .post(`${API}/operativos/${operativoConTres}/ordenes-servicio`)
        .expect(401);
    });

    it('la emisión queda auditada como EMITIR', async () => {
      const trazas = await prisma.auditoria.findMany({
        where: { entidad: 't_orden_servicio', operativoId: operativoConTres },
      });

      expect(trazas.length).toBeGreaterThanOrEqual(3);
      expect(trazas.every((traza) => traza.accion === 'EMITIR')).toBe(true);
      expect(trazas[0].usuario).toBe(5);
    });
  });

  describe('casos 5 y 6 · cada quien ve solo lo suyo', () => {
    it('caso 5 · dos usuarios distintos reciben órdenes distintas', async () => {
      const deBenavides = await request(servidor())
        .get(`${API}/ordenes-servicio/mias`)
        .set(como(String(usuarioDeBenavides)))
        .expect(200);

      const deSegovia = await request(servidor())
        .get(`${API}/ordenes-servicio/mias`)
        .set(como(String(usuarioDeSegovia)))
        .expect(200);

      const unas = deBenavides.body as OrdenRespuesta[];
      const otras = deSegovia.body as OrdenRespuesta[];

      expect(unas).toHaveLength(1);
      expect(otras).toHaveLength(1);
      expect(unas[0].datoAislado.funcionario).toContain('BENAVIDES');
      expect(otras[0].datoAislado.funcionario).toContain('SEGOVIA');
      expect(unas[0].codigo).not.toBe(otras[0].codigo);
    });

    it('caso 6 · un parámetro con otro identificador se ignora', async () => {
      // No existe tal parámetro: el filtro sale de la identidad. Con `whitelist`, la
      // petición ni siquiera lo transporta.
      const respuesta = await request(servidor())
        .get(
          `${API}/ordenes-servicio/mias?funcionarioId=${segovia}&usuarioId=${usuarioDeSegovia}`,
        )
        .set(como(String(usuarioDeBenavides)))
        .expect(200);

      const ordenes = respuesta.body as OrdenRespuesta[];
      expect(ordenes).toHaveLength(1);
      expect(ordenes[0].datoAislado.funcionario).toContain('BENAVIDES');
    });

    it('un usuario sin ficha de personal recibe una explicación', async () => {
      // El perfil 5 es la Dirección: no sale a operativos, así que no tiene ficha.
      const respuesta = await request(servidor())
        .get(`${API}/ordenes-servicio/mias`)
        .set(como(DIRECTOR))
        .expect(404);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        'ficha de personal',
      );
    });

    it('el documento de otra persona no se descarga, aunque se conozca su código', async () => {
      const deSegovia = await prisma.ordenServicio.findFirstOrThrow({
        where: { operativoId: operativoConTres, funcionarioId: segovia },
      });

      await request(servidor())
        .get(`${API}/ordenes-servicio/${deSegovia.codigo}/documento`)
        .set(como(String(usuarioDeBenavides)))
        .expect(400);
    });
  });

  describe('caso 7 · la reemisión', () => {
    it('la primera deja de ser vigente y la nueva la sustituye', async () => {
      const antes = await prisma.ordenServicio.findFirstOrThrow({
        where: {
          operativoId: operativoConTres,
          funcionarioId: benavides,
          vigente: true,
        },
      });

      await emitir(DIRECTOR, operativoConTres).expect(201);

      const todas = await prisma.ordenServicio.findMany({
        where: { operativoId: operativoConTres, funcionarioId: benavides },
        orderBy: { id: 'asc' },
      });

      expect(todas).toHaveLength(2);
      expect(todas[0].id).toBe(antes.id);
      expect(todas[0].vigente).toBe(false);
      expect(todas[1].vigente).toBe(true);
      expect(todas[1].codigo).not.toBe(todas[0].codigo);
    });

    it('INV-23 · queda una sola orden vigente por persona y operativo', async () => {
      const vigentes = await prisma.ordenServicio.count({
        where: {
          operativoId: operativoConTres,
          funcionarioId: benavides,
          vigente: true,
        },
      });

      expect(vigentes).toBe(1);
    });

    it('la anulada NO se borra: sigue siendo evidencia de lo comunicado', async () => {
      const anuladas = await prisma.ordenServicio.count({
        where: { operativoId: operativoConTres, vigente: false },
      });

      expect(anuladas).toBeGreaterThan(0);
    });

    it('«mis órdenes» muestra solo la vigente', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/ordenes-servicio/mias`)
        .set(como(String(usuarioDeBenavides)))
        .expect(200);

      const ordenes = respuesta.body as OrdenRespuesta[];
      expect(ordenes).toHaveLength(1);
      expect(ordenes[0].vigente).toBe(true);
    });
  });

  describe('caso 8 · la orden emitida no cambia', () => {
    it('cambiar el conductor después NO altera lo ya entregado', async () => {
      const antes = await prisma.ordenServicio.findFirstOrThrow({
        where: {
          operativoId: operativoConTres,
          funcionarioId: segovia,
          vigente: true,
        },
      });

      const contenidoOriginal = JSON.stringify(antes.datoAislado);
      expect(contenidoOriginal).toContain('VIVANCO');

      // La DAF cambia el conductor media hora después.
      await request(servidor())
        .patch(`${API}/transporte/operativos/${operativoConTres}`)
        .set(como(DAF))
        .send({ conductorId: otroConductor, vehiculoId: vehiculo })
        .expect(200);

      const despues = await prisma.ordenServicio.findUniqueOrThrow({
        where: { id: antes.id },
      });

      // El documento entregado sigue diciendo lo que decía: es evidencia, no una vista
      // en vivo.
      expect(JSON.stringify(despues.datoAislado)).toBe(contenidoOriginal);
      expect(JSON.stringify(despues.datoAislado)).not.toContain('PAREDES');
    });

    it('una reemisión posterior sí recoge el conductor nuevo', async () => {
      await emitir(DIRECTOR, operativoConTres).expect(201);

      const vigente = await prisma.ordenServicio.findFirstOrThrow({
        where: {
          operativoId: operativoConTres,
          funcionarioId: segovia,
          vigente: true,
        },
      });

      expect(JSON.stringify(vigente.datoAislado)).toContain('PAREDES');
    });
  });

  describe('caso 9 · el documento generado', () => {
    it('es un PDF vertical, uno por persona, con nombre por código', async () => {
      const propias = await request(servidor())
        .get(`${API}/ordenes-servicio/mias`)
        .set(como(String(usuarioDeBenavides)))
        .expect(200);

      const codigo = (propias.body as OrdenRespuesta[])[0].codigo;

      const respuesta = await request(servidor())
        .get(`${API}/ordenes-servicio/${codigo}/documento`)
        .set(como(String(usuarioDeBenavides)))
        .buffer()
        .parse((res, callback) => {
          const partes: Buffer[] = [];
          res.on('data', (parte: Buffer) => partes.push(parte));
          res.on('end', () => callback(null, Buffer.concat(partes)));
        })
        .expect(200);

      expect(respuesta.headers['content-type']).toContain('application/pdf');
      expect(respuesta.headers['content-disposition']).toContain(
        `orden-${codigo}.pdf`,
      );

      const contenido = respuesta.body as Buffer;
      expect(contenido.subarray(0, 4).toString()).toBe('%PDF');
      expect(contenido.byteLength).toBeGreaterThan(1000);
    });
  });
});
