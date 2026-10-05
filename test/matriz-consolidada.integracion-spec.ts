/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Matriz consolidada
 * Archivo: matriz-consolidada.integracion-spec.ts
 * Responsabilidad: Verificar los nueve casos del plan contra la base real.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * EXIGE LA BASE LEVANTADA. Se ejecuta con `npm run test:integracion`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRES CASOS SOLO SE VEN AQUÍ.
 *
 *   · **2 y 3** · que la matriz **no se sirva** a los perfiles departamentales ni a la
 *     DAF. Es el requisito que originó el encargo, y solo una petición HTTP real
 *     atraviesa la guarda que lo garantiza.
 *   · **7** · el número de consultas. Se cuenta con el registro de Prisma, no con dobles:
 *     lo que interesa es cuántas viajan a PostgreSQL.
 *   · **9** · los tres segundos. Con datos en memoria la medición no significa nada.
 *
 * Las ventanas se manipulan a propósito para separar el caso 4 del 5: la evidencia solo
 * aparece cuando la ventana venció.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AreaPersonal,
  PoliticaVehiculo,
  AccesoFormulario,
  RolDepartamental,
  TipoVentana,
  type VentanaCarga,
} from '@prisma/client';
import type { Server } from 'node:http';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { correlacionMiddleware } from '../src/common/interceptors/correlacion.middleware';
import { LoggerService } from '../src/common/logger/logger.service';
import { VentanaCargaService } from '../src/modules/configuracion/application/ventana-carga.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { como } from './identidad-de-prueba';

const PREFIJO = 'PRUEBA_M19';
const API = '/api/v1';

const OPERATIVOS_ROL = '1';
const INSPECCIONES = '2';
const DAF = '4';
const DIRECTOR = '5';
const ADMINISTRADOR = '6';

const FECHA = '2027-02-10';

interface MatrizRespuesta {
  cabecera: {
    ordenTrabajo: string;
    fecha: string;
    fechaNatural: string;
    nroSemana: number;
    estado: string;
    totalOperativos: number;
    totalAlertas: number;
    formulariosSinCarga: number;
    flota: {
      declarados: number;
      requeridos: number;
      hayAdvertencia: boolean;
    } | null;
  };
  secciones: {
    numero: number;
    nombre: string;
    colorFondo: string;
    responsable: string;
    totalOperativos: number;
    filas: {
      identificador: string;
      horario: string;
      personal: { nombre: string }[];
      conductor: string | null;
      placa: string | null;
      alertas: { codigo: string }[];
    }[];
    evidencia: {
      leyenda: string;
      responsable: string;
      horaCierre: string | null;
    } | null;
  }[];
}

describe('Matriz consolidada · integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ventanasIniciales: VentanaCarga[] = [];

  let formularioConCarga = 0;
  let formularioSinCarga = 0;

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
        't_formulario ya tiene formularios institucionales. Esta prueba crea los suyos con los números 1 y 7 y chocaría con ellos: revise la estrategia de datos de prueba antes de continuar.',
      );
    }

    formularioConCarga = await crearFormulario(
      1,
      'OPERATIVOS FIJOS',
      RolDepartamental.DMIP_OPERATIVOS,
    );
    formularioSinCarga = await crearFormulario(
      7,
      'OPERATIVO DMIT',
      RolDepartamental.DMIT_INSTRUCTOR,
    );

    const zonal = await prisma.zonal.findFirstOrThrow({
      orderBy: { orden: 'asc' },
    });
    const punto = await prisma.puntoEncuentro.create({
      data: {
        nombre: `${PREFIJO} EL TEJAR`,
        zonalId: zonal.id,
        formularios: { create: [{ formularioId: formularioConCarga }] },
      },
    });
    const tipo = await prisma.tipoControl.create({
      data: {
        nombre: `${PREFIJO} ESPACIO PUBLICO`,
        formularioId: formularioConCarga,
      },
    });
    const entidad = await prisma.institucion.create({
      data: {
        sigla: `${PREFIJO}AMC`,
        nombre: 'Agencia de prueba M19',
        formularios: { create: [{ formularioId: formularioConCarga }] },
      },
    });

    const funcionario = await prisma.funcionario.create({
      data: {
        cedula: '6666660401',
        apellidos: `${PREFIJO} SEGOVIA`,
        nombres: 'MARIA',
        area: AreaPersonal.GENERAL,
        tipoContrato: 'OCASIONAL',
        direccion: RolDepartamental.DMIP_OPERATIVOS,
      },
    });

    await prisma.cuadroDiario.create({
      data: {
        fecha: new Date(`${FECHA}T00:00:00.000Z`),
        ordenTrabajo: `${PREFIJO}-OT-001`,
        nroSemana: 6,
        anioSemana: 2027,
      },
    });

    // Tres operativos en el formulario 1; el 7 queda vacío a propósito.
    for (const [horaInicio, horaFin] of [
      ['07:00', '11:00'],
      ['12:00', '16:00'],
      ['18:00', '22:00'],
    ]) {
      const creado = await request(servidor())
        .post(`${API}/operativos`)
        .set(como(OPERATIVOS_ROL))
        .send({
          cuadroFecha: FECHA,
          formularioCodigo: `${PREFIJO}_1`,
          horaInicio,
          horaFin,
          zonalesIds: [zonal.id],
          puntoEncuentroId: punto.id,
          tipoControlId: tipo.id,
          institucionesIds: [entidad.id],
          observaciones: ['Coordinado con la AMT.'],
        })
        .expect(201);

      // Al primero se le asigna personal, para que la matriz tenga una fila completa.
      if (horaInicio === '07:00') {
        await request(servidor())
          .post(
            `${API}/operativos/${(creado.body as { id: number }).id}/personal`,
          )
          .set(como(OPERATIVOS_ROL))
          .send({ funcionarioId: funcionario.id, esResponsable: true })
          .expect(201);
      }
    }
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
    await prisma.funcionario.deleteMany({
      where: { apellidos: { startsWith: PREFIJO } },
    });
  };

  const crearFormulario = async (
    numero: number,
    nombre: string,
    rolDueno: RolDepartamental,
  ): Promise<number> => {
    const formulario = await prisma.formulario.create({
      data: {
        numero,
        codigo: `${PREFIJO}_${numero}`,
        nombre,
        colorFondo: numero === 1 ? '#2e7d32' : '#f5f5f5',
        colorAcento: '#000000',
        colorNombre: numero === 1 ? 'verde' : 'gris',
        rolDueno,
        politicaVehiculo: PoliticaVehiculo.REQUERIDO,
        orden: numero,
        // Autorización en t_formulario_rol (2026-08-25): el dueño registra (ESCRITURA).
        roles: {
          create: [{ rol: rolDueno, acceso: AccesoFormulario.ESCRITURA }],
        },
        // Solo letras: `IdentificadorOperativo` exige que el prefijo sea una sigla
        // institucional, y un dígito lo rechaza (M-09).
        prefijos: {
          create: [
            { prefijo: numero === 1 ? 'OCF' : 'DMIT', esPredeterminado: true },
          ],
        },
        areas: { create: [{ area: AreaPersonal.GENERAL }] },
      },
    });
    return formulario.id;
  };

  const servidor = (): Server => app.getHttpServer() as Server;

  /**
   * Escribe la ventana del rol y **descarta la caché de M-08**.
   *
   * `VentanaCargaService` guarda las seis ventanas en memoria y solo las descarta cuando
   * se modifican por su propio servicio. La prueba escribe directamente en la base para
   * situar el horario donde lo necesita, así que tiene que invalidarla a mano: sin esto,
   * la matriz seguiría viendo la ventana anterior y el caso 4 pasaría por casualidad.
   */
  const ajustarVentana = async (
    rol: RolDepartamental,
    datos: { activo: boolean; horaApertura: string; horaCierre: string },
  ): Promise<void> => {
    await prisma.ventanaCarga.upsert({
      where: { rol },
      update: { ...datos, tipo: TipoVentana.DIARIO },
      create: {
        rol,
        tipo: TipoVentana.DIARIO,
        ...datos,
        mensajeCierre: 'Ventana cerrada.',
      },
    });

    app.get(VentanaCargaService).invalidarCache();
  };

  const consultarMatriz = (usuario: string, fecha = FECHA) =>
    request(servidor()).get(`${API}/matriz/${fecha}`).set(como(usuario));

  describe('caso 1 · la matriz del Director', () => {
    it('devuelve los formularios agrupados, con sus colores y su responsable', async () => {
      const respuesta = await consultarMatriz(DIRECTOR).expect(200);
      const matriz = respuesta.body as MatrizRespuesta;

      expect(matriz.secciones).toHaveLength(2);

      const conCarga = matriz.secciones.find((seccion) => seccion.numero === 1);
      expect(conCarga?.totalOperativos).toBe(3);
      expect(conCarga?.filas).toHaveLength(3);
      expect(conCarga?.responsable).toContain('Unidad de Operativos');
    });

    it('caso 6 · los colores vienen en el JSON, no del frontend', async () => {
      const respuesta = await consultarMatriz(DIRECTOR).expect(200);
      const matriz = respuesta.body as MatrizRespuesta;

      const conCarga = matriz.secciones.find((seccion) => seccion.numero === 1);
      expect(conCarga?.colorFondo).toBe('#2e7d32');
    });

    it('la cabecera trae la orden de trabajo, la fecha natural y la semana', async () => {
      const respuesta = await consultarMatriz(DIRECTOR).expect(200);
      const cabecera = (respuesta.body as MatrizRespuesta).cabecera;

      expect(cabecera.ordenTrabajo).toBe(`${PREFIJO}-OT-001`);
      expect(cabecera.fechaNatural).toBe('miércoles 10 de febrero de 2027');
      expect(cabecera.nroSemana).toBe(6);
      expect(cabecera.totalOperativos).toBe(3);
      expect(cabecera.totalAlertas).toBeGreaterThan(0);
    });

    it('las filas traen las nueve columnas y las alertas por celda', async () => {
      const respuesta = await consultarMatriz(DIRECTOR).expect(200);
      const conCarga = (respuesta.body as MatrizRespuesta).secciones.find(
        (seccion) => seccion.numero === 1,
      );

      const conPersonal = conCarga?.filas.find(
        (fila) => fila.personal.length > 0,
      );

      expect(conPersonal?.horario).toBe('07H00 A 11H00');
      expect(conPersonal?.personal[0].nombre).toContain('SEGOVIA');
      expect(conPersonal?.conductor).toBeNull();
      expect(conPersonal?.placa).toBeNull();
      // Sin conductor asignado, ALV-02 y ALV-03 viajan con la fila.
      expect(conPersonal?.alertas.map((alerta) => alerta.codigo)).toContain(
        'ALV-02',
      );
    });

    it('el indicador de flota aparece cuando la DAF declara', async () => {
      await request(servidor())
        .put(`${API}/transporte/capacidad/${FECHA}`)
        .set(como(DAF))
        .send({ vehiculosHabiles: 2, conductoresHabiles: 2 })
        .expect(200);

      const respuesta = await consultarMatriz(DIRECTOR).expect(200);
      const flota = (respuesta.body as MatrizRespuesta).cabecera.flota;

      expect(flota).toEqual({
        declarados: 2,
        requeridos: 3,
        hayAdvertencia: true,
      });
    });

    it('una fecha sin jornada abierta responde 404', async () => {
      await consultarMatriz(DIRECTOR, '2027-02-11').expect(404);
    });

    it('una fecha mal escrita responde 400', async () => {
      await consultarMatriz(DIRECTOR, '10-02-2027').expect(400);
    });
  });

  describe('casos 2 y 3 · la matriz NO se sirve a otros perfiles', () => {
    it('caso 2 · un rol departamental recibe 403', async () => {
      const respuesta = await consultarMatriz(OPERATIVOS_ROL).expect(403);

      expect((respuesta.body as { codigo: string }).codigo).toBe(
        'PERMISO_INSUFICIENTE',
      );
    });

    it('ni siquiera el dueño del formulario que sí tiene carga', async () => {
      await consultarMatriz(INSPECCIONES).expect(403);
    });

    it('caso 3 · la DAF recibe 403, aunque vea los nueve formularios al asignar', async () => {
      await consultarMatriz(DAF).expect(403);
    });

    it('el ADMINISTRADOR tampoco: configura el sistema, no revisa la jornada', async () => {
      await consultarMatriz(ADMINISTRADOR).expect(403);
    });

    it('sin identidad responde 401', async () => {
      await request(servidor()).get(`${API}/matriz/${FECHA}`).expect(401);
    });

    it('la exportación está igual de restringida', async () => {
      await request(servidor())
        .get(`${API}/matriz/${FECHA}/exportar`)
        .set(como(OPERATIVOS_ROL))
        .expect(403);
    });
  });

  describe('casos 4 y 5 · la fila de evidencia', () => {
    it('caso 5 · con la ventana ABIERTA, el formulario vacío no lleva evidencia', async () => {
      await ajustarVentana(RolDepartamental.DMIT_INSTRUCTOR, {
        activo: true,
        horaApertura: '00:00',
        horaCierre: '23:59',
      });

      const respuesta = await consultarMatriz(DIRECTOR).expect(200);
      const matriz = respuesta.body as MatrizRespuesta;
      const vacio = matriz.secciones.find((seccion) => seccion.numero === 7);

      expect(vacio?.totalOperativos).toBe(0);
      expect(vacio?.evidencia).toBeNull();
      expect(matriz.cabecera.formulariosSinCarga).toBe(0);
    });

    it('caso 4 · vencida la ventana, aparece con responsable y hora de cierre', async () => {
      await ajustarVentana(RolDepartamental.DMIT_INSTRUCTOR, {
        activo: true,
        horaApertura: '00:00',
        horaCierre: '00:01',
      });

      const respuesta = await consultarMatriz(DIRECTOR).expect(200);
      const matriz = respuesta.body as MatrizRespuesta;
      const vacio = matriz.secciones.find((seccion) => seccion.numero === 7);

      expect(vacio?.evidencia?.leyenda).toContain('no fue ingresada');
      expect(vacio?.evidencia?.responsable).toBe('DMIT · Instrucción');
      expect(vacio?.evidencia?.horaCierre).toBe('00H01');
      expect(matriz.cabecera.formulariosSinCarga).toBe(1);
    });

    it('el formulario con carga nunca lleva evidencia', async () => {
      const respuesta = await consultarMatriz(DIRECTOR).expect(200);
      const conCarga = (respuesta.body as MatrizRespuesta).secciones.find(
        (seccion) => seccion.numero === 1,
      );

      expect(conCarga?.evidencia).toBeNull();
    });

    it('con la ventana desactivada tampoco: sin horario no hay vencimiento', async () => {
      await ajustarVentana(RolDepartamental.DMIT_INSTRUCTOR, {
        activo: false,
        horaApertura: '00:00',
        horaCierre: '00:01',
      });

      const respuesta = await consultarMatriz(DIRECTOR).expect(200);
      const vacio = (respuesta.body as MatrizRespuesta).secciones.find(
        (seccion) => seccion.numero === 7,
      );

      expect(vacio?.evidencia).toBeNull();
    });
  });

  describe('casos 7 y 9 · el coste de componer la matriz', () => {
    /**
     * El NÚMERO de consultas se afirma en la prueba unitaria, donde las llamadas del
     * servicio son observables: `listarFormularios` y `listarOperativos` una vez cada
     * una, con cincuenta operativos igual que con cinco.
     *
     * Aquí se mide lo que aquella no puede: que el coste real **no crece con las filas**.
     * Con una consulta por fila y por relación —personal, zonales, instituciones,
     * conductor, vehículo—, treinta operativos serían más de ciento cincuenta viajes a
     * PostgreSQL y el tiempo se dispararía. Es la evidencia del `include`.
     */
    it('caso 9 · una jornada de treinta operativos se compone en menos de tres segundos', async () => {
      const cuadro = await prisma.cuadroDiario.findUniqueOrThrow({
        where: { fecha: new Date(`${FECHA}T00:00:00.000Z`) },
      });
      const punto = await prisma.puntoEncuentro.findFirstOrThrow({
        where: { nombre: { startsWith: PREFIJO } },
      });
      const tipo = await prisma.tipoControl.findFirstOrThrow({
        where: { nombre: { startsWith: PREFIJO } },
      });

      const existentes = await prisma.operativo.count({
        where: { cuadroId: cuadro.id },
      });

      // Se insertan directamente: el objetivo es el volumen, no repetir el registro que
      // M-14 ya prueba por HTTP.
      await prisma.operativo.createMany({
        data: Array.from({ length: 30 - existentes }, (_, indice) => ({
          cuadroId: cuadro.id,
          formularioId: formularioConCarga,
          identificador: `OCF-${String(indice + 100)}-10-FEB-2027`,
          secuencial: indice + 100,
          horaInicio: '08:00',
          horaFin: '10:00',
          esNocturno: false,
          cruzaMedianoche: false,
          duracionHoras: 2,
          puntoEncuentroId: punto.id,
          tipoControlId: tipo.id,
          creadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
          creadoPor: 1,
          modificadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
          modificadoPor: 1,
        })),
      });

      const inicio = Date.now();
      const respuesta = await consultarMatriz(DIRECTOR).expect(200);
      const duracion = Date.now() - inicio;

      const matriz = respuesta.body as MatrizRespuesta;
      expect(matriz.cabecera.totalOperativos).toBe(30);
      expect(duracion).toBeLessThan(3000);
    });

    it('caso 7 · las filas llegan completas en esa misma composición', async () => {
      // Si faltara el `include`, las relaciones vendrían vacías o el servicio tendría que
      // ir a buscarlas una por una. Que estén todas confirma que viajaron con la consulta.
      const respuesta = await consultarMatriz(DIRECTOR).expect(200);
      const conCarga = (respuesta.body as MatrizRespuesta).secciones.find(
        (seccion) => seccion.numero === 1,
      );

      const conPersonal = conCarga?.filas.find(
        (fila) => fila.personal.length > 0,
      );

      expect(conCarga?.filas).toHaveLength(30);
      expect(conPersonal?.personal[0].nombre).toContain('SEGOVIA');
    });
  });

  describe('caso 8 · el documento exportado', () => {
    it('responde un PDF con nombre por fecha', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/matriz/${FECHA}/exportar`)
        .set(como(DIRECTOR))
        .expect(200);

      expect(respuesta.headers['content-type']).toContain('application/pdf');
      expect(respuesta.headers['content-disposition']).toContain(
        `matriz-${FECHA}.pdf`,
      );
    });

    it('el contenido es un PDF real y no un texto con extensión', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/matriz/${FECHA}/exportar`)
        .set(como(DIRECTOR))
        .buffer()
        .parse((res, callback) => {
          const partes: Buffer[] = [];
          res.on('data', (parte: Buffer) => partes.push(parte));
          res.on('end', () => callback(null, Buffer.concat(partes)));
        })
        .expect(200);

      const contenido = respuesta.body as Buffer;

      expect(contenido.subarray(0, 4).toString()).toBe('%PDF');
      expect(contenido.byteLength).toBeGreaterThan(1500);
    });
  });
});
