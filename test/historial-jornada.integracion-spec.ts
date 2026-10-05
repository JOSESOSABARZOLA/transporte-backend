/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Historial de jornada
 * Archivo: historial-jornada.integracion-spec.ts
 * Responsabilidad: Verificar los seis casos del plan contra la base real.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * EXIGE LA BASE LEVANTADA. Se ejecuta con `npm run test:integracion`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ES LA PRIMERA PRUEBA QUE MONTA LA CADENA COMPLETA: formulario, cuadro, operativo,
 * funcionario y asignación. Todo con el prefijo `PRUEBA_M11` y borrado al terminar.
 *
 * Los operativos de prueba llevan valores que las restricciones exigen —punto libre y
 * tipo libre, uno de cada par— y **no representan operativos reales**: `t_operativo`
 * está vacía y seguirá estándolo hasta M-14.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { INestApplication } from '@nestjs/common';
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
import { HistorialJornadaService } from '../src/modules/talento-operativo/application/historial-jornada.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { como } from './identidad-de-prueba';

const PREFIJO = 'PRUEBA_M11';
const API = '/api/v1';

/** Compuestas con el algoritmo de módulo 10. No pertenecen a ninguna persona. */
const CEDULAS = ['1710034065', '0926687856'];

const dia = (texto: string): Date => new Date(`${texto}T00:00:00.000Z`);

describe('Historial de jornada · integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let historial: HistorialJornadaService;

  let formularioPatrullaId = 0;
  let formularioNormalId = 0;
  let personaUno = 0;
  let personaDos = 0;

  const LUNES = dia('2026-08-03');
  const SABADO = dia('2026-08-08');

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = modulo.createNestApplication({ bufferLogs: true });
    // La identidad viaja en la cookie de sesion: sin esto `request.cookies` es indefinido
    // y toda peticion recibe 401. Lo registra tambien `main.ts`.
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = app.get(PrismaService);
    historial = app.get(HistorialJornadaService);

    await limpiar();

    const patrulla = await prisma.formulario.create({
      data: definicionFormulario(6, `${PREFIJO}_PATRULLA`, true),
    });
    const normal = await prisma.formulario.create({
      data: definicionFormulario(7, `${PREFIJO}_NORMAL`, false),
    });
    formularioPatrullaId = patrulla.id;
    formularioNormalId = normal.id;

    const uno = await prisma.funcionario.create({
      data: definicionFuncionario(CEDULAS[0], `${PREFIJO}_UNO`),
    });
    const dos = await prisma.funcionario.create({
      data: definicionFuncionario(CEDULAS[1], `${PREFIJO}_DOS`),
    });
    personaUno = uno.id;
    personaDos = dos.id;
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  /** El orden importa: el operativo depende del cuadro y del formulario. */
  const limpiar = async (): Promise<void> => {
    await prisma.cuadroDiario.deleteMany({
      where: { ordenTrabajo: { startsWith: PREFIJO } },
    });
    await prisma.funcionario.deleteMany({
      where: { apellidos: { startsWith: PREFIJO } },
    });
    await prisma.formulario.deleteMany({
      where: { codigo: { startsWith: PREFIJO } },
    });
  };

  const definicionFormulario = (
    numero: number,
    codigo: string,
    esPatrulla: boolean,
  ) => ({
    numero,
    codigo,
    nombre: `FORMULARIO DE PRUEBA ${numero}`,
    colorFondo: '#EEEEEE',
    // Relleno: PV-25 y PV-26 sin resolver. `esPatrulla` sí se usa aquí, y por eso la
    // prueba lo fija de forma explícita en lugar de suponerlo.
    colorAcento: '#000000',
    colorNombre: 'gris',
    rolDueno: RolDepartamental.DMIP_INSPECCIONES,
    politicaVehiculo: PoliticaVehiculo.CONDICIONAL,
    condicionanteNoct: false,
    esPatrulla,
    orden: numero,
  });

  const definicionFuncionario = (cedula: string, apellidos: string) => ({
    cedula,
    apellidos,
    nombres: 'PERSONA',
    area: AreaPersonal.GENERAL,
    tipoContrato: TipoContrato.NOMBRAMIENTO,
    direccion: RolDepartamental.DMIP_INSPECCIONES,
  });

  /** Crea el cuadro de una fecha, si no existe. */
  const crearCuadro = async (fecha: Date): Promise<number> => {
    const existente = await prisma.cuadroDiario.findUnique({
      where: { fecha },
    });
    if (existente) return existente.id;

    const cuadro = await prisma.cuadroDiario.create({
      data: {
        fecha,
        ordenTrabajo: `${PREFIJO}-${fecha.toISOString().slice(0, 10)}`,
        nroSemana: 32,
        anioSemana: 2026,
      },
    });
    return cuadro.id;
  };

  let secuencial = 0;

  /**
   * Crea un operativo con su asignación de personal.
   *
   * `puntoLibre` y `tipoLibre` en lugar de las referencias del catálogo: es lo que
   * `ck_operativo_punto` y `ck_operativo_tipo` admiten sin depender de PV-01.
   */
  const crearOperativo = async (datos: {
    cuadroId: number;
    formularioId: number;
    horas: number;
    esNocturno: boolean;
    personas: number[];
  }): Promise<void> => {
    secuencial += 1;

    await prisma.operativo.create({
      data: {
        cuadroId: datos.cuadroId,
        formularioId: datos.formularioId,
        identificador: `${PREFIJO}-${String(secuencial).padStart(3, '0')}`,
        secuencial,
        horaInicio: '08:00',
        horaFin: '16:00',
        esNocturno: datos.esNocturno,
        duracionHoras: datos.horas,
        puntoLibre: 'Punto de prueba',
        tipoLibre: 'Tipo de prueba',
        creadoPorRol: RolDepartamental.DMIP_INSPECCIONES,
        creadoPor: 2,
        modificadoPorRol: RolDepartamental.DMIP_INSPECCIONES,
        modificadoPor: 2,
        personal: {
          create: datos.personas.map((funcionarioId) => ({
            funcionarioId,
            asignadoPorRol: RolDepartamental.DMIP_INSPECCIONES,
          })),
        },
      },
    });
  };

  const servidor = (): Server => app.getHttpServer() as Server;

  describe('consolidarJornada', () => {
    it('caso 1 · tres operativos de una persona dan UNA fila con las horas sumadas', async () => {
      const cuadroId = await crearCuadro(LUNES);

      await crearOperativo({
        cuadroId,
        formularioId: formularioNormalId,
        horas: 4,
        esNocturno: false,
        personas: [personaUno],
      });
      await crearOperativo({
        cuadroId,
        formularioId: formularioNormalId,
        horas: 3.5,
        esNocturno: false,
        personas: [personaUno],
      });
      await crearOperativo({
        cuadroId,
        formularioId: formularioNormalId,
        horas: 2,
        esNocturno: false,
        personas: [personaUno, personaDos],
      });

      const resultado = await historial.consolidarJornada(LUNES);

      expect(resultado.personas).toBe(2);
      expect(resultado.operativos).toBe(4);

      const filas = await prisma.historialJornada.findMany({
        where: { fecha: LUNES },
      });
      const uno = filas.find((f) => f.funcionarioId === personaUno);

      expect(filas).toHaveLength(2);
      expect(Number(uno?.horasJornada)).toBe(9.5);
      expect(uno?.operativos).toBe(3);
    });

    it('caso 4 · reabrir y volver a cerrar no duplica ni acumula', async () => {
      await historial.consolidarJornada(LUNES);
      await historial.consolidarJornada(LUNES);

      const filas = await prisma.historialJornada.findMany({
        where: { fecha: LUNES },
      });
      const uno = filas.find((f) => f.funcionarioId === personaUno);

      expect(filas).toHaveLength(2);
      expect(Number(uno?.horasJornada)).toBe(9.5);
    });

    it('caso 2 · la patrulla nocturna marca las dos banderas', async () => {
      const cuadroId = await crearCuadro(LUNES);

      await crearOperativo({
        cuadroId,
        formularioId: formularioPatrullaId,
        horas: 6,
        esNocturno: true,
        personas: [personaDos],
      });

      await historial.consolidarJornada(LUNES);

      const dos = await prisma.historialJornada.findUnique({
        where: {
          funcionarioId_fecha: { funcionarioId: personaDos, fecha: LUNES },
        },
      });

      expect(dos?.fuePatrulla).toBe(true);
      expect(dos?.fueNocturna).toBe(true);
      expect(dos?.fueFinSemana).toBe(false);
    });

    it('caso 3 · un operativo en sábado marca el fin de semana', async () => {
      const cuadroId = await crearCuadro(SABADO);

      await crearOperativo({
        cuadroId,
        formularioId: formularioNormalId,
        horas: 8,
        esNocturno: false,
        personas: [personaUno],
      });

      await historial.consolidarJornada(SABADO);

      const uno = await prisma.historialJornada.findUnique({
        where: {
          funcionarioId_fecha: { funcionarioId: personaUno, fecha: SABADO },
        },
      });

      expect(uno?.fueFinSemana).toBe(true);
      // Y la jornada del lunes no se contamina.
      const lunes = await prisma.historialJornada.findUnique({
        where: {
          funcionarioId_fecha: { funcionarioId: personaUno, fecha: LUNES },
        },
      });
      expect(lunes?.fueFinSemana).toBe(false);
    });

    it('caso 5 · el operativo que cruza medianoche imputa sus horas al día de inicio', async () => {
      const cuadroId = await crearCuadro(SABADO);

      // 22H00 a 02H00: cuatro horas que terminan el domingo, pero pertenecen al cuadro
      // del sábado y ahí se cuentan.
      await prisma.operativo.create({
        data: {
          cuadroId,
          formularioId: formularioNormalId,
          identificador: `${PREFIJO}-CRUCE`,
          secuencial: 99,
          horaInicio: '22:00',
          horaFin: '02:00',
          esNocturno: true,
          cruzaMedianoche: true,
          duracionHoras: 4,
          puntoLibre: 'Punto de prueba',
          tipoLibre: 'Tipo de prueba',
          creadoPorRol: RolDepartamental.DMIP_INSPECCIONES,
          creadoPor: 2,
          modificadoPorRol: RolDepartamental.DMIP_INSPECCIONES,
          modificadoPor: 2,
          personal: {
            create: [
              {
                funcionarioId: personaDos,
                asignadoPorRol: RolDepartamental.DMIP_INSPECCIONES,
              },
            ],
          },
        },
      });

      await historial.consolidarJornada(SABADO);

      const sabado = await prisma.historialJornada.findUnique({
        where: {
          funcionarioId_fecha: { funcionarioId: personaDos, fecha: SABADO },
        },
      });
      const domingo = await prisma.historialJornada.findUnique({
        where: {
          funcionarioId_fecha: {
            funcionarioId: personaDos,
            fecha: dia('2026-08-09'),
          },
        },
      });

      expect(Number(sabado?.horasJornada)).toBe(4);
      expect(domingo).toBeNull();
    });

    it('retira de la fecha a quien deja de figurar en el cuadro', async () => {
      // Se borran los operativos del sábado y se vuelve a consolidar: nadie queda con
      // horas que ya no hizo.
      const cuadro = await prisma.cuadroDiario.findUnique({
        where: { fecha: SABADO },
      });
      await prisma.operativo.deleteMany({ where: { cuadroId: cuadro?.id } });

      await historial.consolidarJornada(SABADO);

      const filas = await prisma.historialJornada.findMany({
        where: { fecha: SABADO },
      });
      expect(filas).toHaveLength(0);
    });
  });

  describe('consultas de las políticas de descanso', () => {
    it('RN-24 · devuelve la fecha de la última patrulla', async () => {
      expect(await historial.obtenerUltimaPatrulla(personaDos)).toEqual(LUNES);
    });

    it('RN-24 · null para quien nunca salió en patrulla', async () => {
      expect(await historial.obtenerUltimaPatrulla(personaUno)).toBeNull();
    });

    it('RN-25 · cuenta las salidas pesadas del período', async () => {
      const salidas = await historial.contarSalidasPesadas(personaDos, {
        desde: dia('2026-08-01'),
        hasta: dia('2026-08-31'),
      });

      expect(salidas).toBe(1);
    });

    it('RN-36 · devuelve las horas del día, y cero si no hay jornada', async () => {
      expect(await historial.obtenerHorasDelDia(personaUno, LUNES)).toBe(9.5);
      expect(
        await historial.obtenerHorasDelDia(personaUno, dia('2026-08-04')),
      ).toBe(0);
    });
  });

  describe('caso 6 · ningún endpoint expone el acumulado (RN-35)', () => {
    const inexistentes = [
      '/historial',
      '/historial-jornada',
      '/personal/historial',
      '/personal/elegible/historial',
    ];

    it.each(inexistentes)('%s no existe', async (ruta) => {
      await request(servidor())
        .get(`${API}${ruta}`)
        .set(como('6'))
        .expect(404);
    });

    it('/administracion/personal/historial choca con la ficha y se rechaza', async () => {
      // No es un endpoint de historial: es `/administracion/personal/:id` recibiendo
      // «historial» donde espera un número. Sale 400, no 200, que es lo que importa.
      await request(servidor())
        .get(`${API}/administracion/personal/historial`)
        .set(como('6'))
        .expect(400);
    });

    it('la ficha completa del funcionario TAMPOCO trae el acumulado', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/administracion/personal/${personaUno}`)
        .set(como('6'))
        .expect(200);

      const cuerpo = JSON.stringify(respuesta.body);
      for (const campo of [
        'horasJornada',
        'fuePatrulla',
        'fueNocturna',
        'fueFinSemana',
        'historial',
      ]) {
        expect(cuerpo).not.toContain(campo);
      }
    });
  });
});
