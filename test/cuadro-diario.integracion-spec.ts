/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Cuadro diario
 * Archivo: cuadro-diario.integracion-spec.ts
 * Responsabilidad: Verificar los nueve casos del plan contra la base real.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * EXIGE LA BASE LEVANTADA. Se ejecuta con `npm run test:integracion`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOBRE LAS VENTANAS. El estado del cuadro sigue a las ventanas de carga, que en la
 * base están sembradas con horarios reales —departamental hasta las 15H00, transporte
 * de 15H00 a 16H30—. Para que la prueba no dependa de la hora a la que se ejecute,
 * **desactiva temporalmente las cuatro ventanas activas** y las restituye al terminar:
 * una ventana inactiva no restringe, de modo que el cuadro puede llegar a APROBADO.
 *
 * Es el mismo criterio de M-08: el momento se controla, no se espera.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  EstadoCuadro,
  PoliticaVehiculo,
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
import { VentanaCargaService } from '../src/modules/configuracion/application/ventana-carga.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { como } from './identidad-de-prueba';

const PREFIJO = 'PRUEBA_M13';
const API = '/api/v1';
const ADMINISTRADOR = '6';
const DIRECTOR = '5';
const OPERATIVOS = '1';

const FECHA = '2026-08-05';
const FIN_DE_ANIO = '2026-12-31';

interface CuadroRespuesta {
  fecha: string;
  ordenTrabajo: string;
  nroSemana: number;
  anioSemana: number;
  estado: EstadoCuadro;
  admiteEscritura: boolean;
  cerradoPor: number | null;
  reaperturas: number;
}

describe('Cuadro diario · integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ventanas: VentanaCargaService;
  let ventanasIniciales: VentanaCarga[] = [];
  let formularioId = 0;

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
    ventanas = app.get(VentanaCargaService);

    await limpiar();

    // Se guardan las seis ventanas y se desactivan, para que la prueba no dependa de
    // la hora a la que se ejecute.
    ventanasIniciales = await prisma.ventanaCarga.findMany();
    await prisma.ventanaCarga.updateMany({ data: { activo: false } });
    ventanas.invalidarCache();

    const formulario = await prisma.formulario.create({
      data: {
        numero: 6,
        codigo: `${PREFIJO}_NOCTURNO`,
        nombre: 'FORMULARIO CON CONDICIONANTE',
        colorFondo: '#EEEEEE',
        colorAcento: '#000000',
        colorNombre: 'gris',
        rolDueno: RolDepartamental.DMIP_INSPECCIONES,
        politicaVehiculo: PoliticaVehiculo.REQUERIDO,
        // El condicionante nocturno es lo que INV-11 comprueba al cerrar.
        condicionanteNoct: true,
        esPatrulla: false,
        orden: 6,
      },
    });
    formularioId = formulario.id;
  });

  afterAll(async () => {
    await limpiar();

    for (const original of ventanasIniciales) {
      await prisma.ventanaCarga.update({
        where: { rol: original.rol },
        data: { activo: original.activo },
      });
    }
    ventanas.invalidarCache();
    await app.close();
  });

  /**
   * Se limpia por FECHA y no por prefijo de orden de trabajo.
   *
   * Hasta el 2026-08-07 la orden llegaba como dato y esta suite la prefijaba con
   * `PRUEBA_M13`, lo que bastaba para aislar sus filas. Al resolverse PV-28, la orden la
   * genera el sistema como `AMC-AAAA-MM-DD` y **ya no hay prefijo por el que filtrar**:
   * el criterio de aislamiento pasa a ser la fecha, que es lo que esta suite controla.
   */
  const FECHAS_DE_LA_SUITE = [
    FECHA,
    FIN_DE_ANIO,
    '2026-08-20',
    '2026-08-21',
    '2026-08-22',
  ];

  const limpiar = async (): Promise<void> => {
    await prisma.cuadroDiario.deleteMany({
      where: {
        fecha: { in: FECHAS_DE_LA_SUITE.map((f) => new Date(`${f}T00:00:00Z`)) },
      },
    });
    await prisma.formulario.deleteMany({
      where: { codigo: { startsWith: PREFIJO } },
    });
  };

  const servidor = (): Server => app.getHttpServer() as Server;

  describe('apertura', () => {
    it('el ADMINISTRADOR abre la jornada y la semana se deriva', async () => {
      const respuesta = await request(servidor())
        .post(`${API}/cuadros`)
        .set(como(ADMINISTRADOR))
        .send({ fecha: FECHA })
        .expect(201);

      const cuadro = respuesta.body as CuadroRespuesta;
      expect(cuadro.nroSemana).toBe(32);
      expect(cuadro.anioSemana).toBe(2026);
      expect(cuadro.estado).toBe(EstadoCuadro.BORRADOR);
      expect(cuadro.admiteEscritura).toBe(true);
    });

    /** PV-28, resuelto el 2026-08-07. */
    it('la orden de trabajo la genera el sistema como AMC-AAAA-MM-DD', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/cuadros/${FECHA}`)
        .set(como(ADMINISTRADOR))
        .expect(200);

      expect((respuesta.body as CuadroRespuesta).ordenTrabajo).toBe(
        `AMC-${FECHA}`,
      );
    });

    it('caso 1 · dos cuadros para la misma fecha se rechazan', async () => {
      const respuesta = await request(servidor())
        .post(`${API}/cuadros`)
        .set(como(ADMINISTRADOR))
        .send({ fecha: FECHA })
        .expect(400);

      // El mensaje nombra la orden que ya existe, que ahora es la generada.
      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        `AMC-${FECHA}`,
      );
    });

    it('caso 2 · el 31 de diciembre de 2026 cae en la semana 53 de 2026', async () => {
      const respuesta = await request(servidor())
        .post(`${API}/cuadros`)
        .set(como(ADMINISTRADOR))
        .send({ fecha: FIN_DE_ANIO })
        .expect(201);

      const cuadro = respuesta.body as CuadroRespuesta;
      expect(cuadro.nroSemana).toBe(53);
      expect(cuadro.anioSemana).toBe(2026);
      // Cambio de año: el código sigue el día de la jornada, no el de la semana ISO.
      expect(cuadro.ordenTrabajo).toBe(`AMC-${FIN_DE_ANIO}`);
    });

    it('caso 3 · el número de semana enviado por el cliente se rechaza', async () => {
      const respuesta = await request(servidor())
        .post(`${API}/cuadros`)
        .set(como(ADMINISTRADOR))
        .send({ fecha: '2026-08-20', nroSemana: 1 })
        .expect(400);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('CAMPOS_NO_PERMITIDOS');
      expect(cuerpo.mensaje).toContain('nroSemana');
    });

    /**
     * PV-28. Se retiró del contrato en lugar de dejarla opcional: quien la envíe recibe
     * un rechazo que le dice que el sistema la genera, en lugar de que convivan dos
     * códigos distintos para el mismo día.
     */
    it('enviar la orden de trabajo se rechaza: la genera el sistema', async () => {
      const respuesta = await request(servidor())
        .post(`${API}/cuadros`)
        .set(como(ADMINISTRADOR))
        .send({ fecha: '2026-08-21', ordenTrabajo: 'AMC-INVENTADA' })
        .expect(400);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('CAMPOS_NO_PERMITIDOS');
      expect(cuerpo.mensaje).toContain('ordenTrabajo');
    });

    it('un rol departamental no puede abrir la jornada', async () => {
      await request(servidor())
        .post(`${API}/cuadros`)
        .set(como(OPERATIVOS))
        .send({ fecha: '2026-08-22' })
        .expect(403);
    });
  });

  describe('consulta', () => {
    it('todos los roles ven el estado de la jornada', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/cuadros/${FECHA}`)
        .set(como(OPERATIVOS))
        .expect(200);

      // Con las ventanas desactivadas, la consulta lo sincroniza hasta APROBADO.
      expect((respuesta.body as CuadroRespuesta).estado).toBe(
        EstadoCuadro.APROBADO,
      );
    });

    it('una fecha sin cuadro responde 404', async () => {
      await request(servidor())
        .get(`${API}/cuadros/2030-01-01`)
        .set(como(OPERATIVOS))
        .expect(404);
    });

    it('una fecha mal escrita responde 400', async () => {
      await request(servidor())
        .get(`${API}/cuadros/05-08-2026`)
        .set(como(OPERATIVOS))
        .expect(400);
    });

    it('sin identidad responde 401', async () => {
      await request(servidor()).get(`${API}/cuadros/${FECHA}`).expect(401);
    });
  });

  describe('cierre', () => {
    it('caso 8 · un rol departamental no puede cerrar', async () => {
      await request(servidor())
        .post(`${API}/cuadros/${FECHA}/cerrar`)
        .set(como(OPERATIVOS))
        .expect(403);
    });

    it('el ADMINISTRADOR tampoco: el cierre es de la Dirección', async () => {
      await request(servidor())
        .post(`${API}/cuadros/${FECHA}/cerrar`)
        .set(como(ADMINISTRADOR))
        .expect(403);
    });

    it('caso 6 · no cierra con un operativo nocturno sin conductor', async () => {
      const cuadro = await prisma.cuadroDiario.findUnique({
        where: { fecha: new Date(`${FECHA}T00:00:00.000Z`) },
      });

      await prisma.operativo.create({
        data: {
          cuadroId: cuadro?.id as number,
          formularioId,
          identificador: `${PREFIJO}-NOCTURNO-001`,
          secuencial: 1,
          horaInicio: '20:00',
          horaFin: '02:00',
          esNocturno: true,
          cruzaMedianoche: true,
          duracionHoras: 6,
          puntoLibre: 'Punto de prueba',
          tipoLibre: 'Tipo de prueba',
          creadoPorRol: RolDepartamental.DMIP_INSPECCIONES,
          creadoPor: 2,
          modificadoPorRol: RolDepartamental.DMIP_INSPECCIONES,
          modificadoPor: 2,
        },
      });

      const respuesta = await request(servidor())
        .post(`${API}/cuadros/${FECHA}/cerrar`)
        .set(como(DIRECTOR))
        .expect(409);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('CONDICIONANTE_NOCTURNO');
      expect(cuerpo.mensaje).toContain(`${PREFIJO}-NOCTURNO-001`);
    });

    it('caso 7 · resuelto el condicionante, el cierre funciona y consolida', async () => {
      // La DAF determina que va por propios medios: el condicionante queda resuelto.
      await prisma.operativo.updateMany({
        where: { identificador: `${PREFIJO}-NOCTURNO-001` },
        data: { estadoTransporte: 'PROPIOS_MEDIOS' },
      });

      const respuesta = await request(servidor())
        .post(`${API}/cuadros/${FECHA}/cerrar`)
        .set(como(DIRECTOR))
        .expect(200);

      const cuadro = respuesta.body as CuadroRespuesta;
      expect(cuadro.estado).toBe(EstadoCuadro.CERRADO);
      expect(cuadro.cerradoPor).toBe(5);
      expect(cuadro.admiteEscritura).toBe(false);

      // El evento `CuadroCerrado` disparó la consolidación de M-11. El operativo no
      // tiene personal asignado, así que la jornada queda sin filas, y eso es correcto.
      const historial = await prisma.historialJornada.findMany({
        where: { fecha: new Date(`${FECHA}T00:00:00.000Z`) },
      });
      expect(historial).toHaveLength(0);
    });

    it('caso 5 · el cuadro cerrado ya no admite escritura', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/cuadros/${FECHA}`)
        .set(como(OPERATIVOS))
        .expect(200);

      expect((respuesta.body as CuadroRespuesta).admiteEscritura).toBe(false);
    });

    it('no se cierra dos veces', async () => {
      const respuesta = await request(servidor())
        .post(`${API}/cuadros/${FECHA}/cerrar`)
        .set(como(DIRECTOR))
        .expect(409);

      expect((respuesta.body as { codigo: string }).codigo).toBe(
        'CUADRO_CERRADO',
      );
    });

    it('el cierre queda auditado con el rol de la Dirección', async () => {
      const cuadro = await prisma.cuadroDiario.findUnique({
        where: { fecha: new Date(`${FECHA}T00:00:00.000Z`) },
      });

      const trazas = await prisma.auditoria.findMany({
        where: { entidad: 't_cuadro_diario', entidadId: cuadro?.id },
        orderBy: { id: 'asc' },
      });

      expect(trazas.map((traza) => traza.accion)).toEqual(['CREAR', 'CERRAR']);
      expect(trazas[1].usuario).toBe(5);
      expect(trazas[1].rol).toBe(RolDepartamental.DIRECTOR);
    });
  });

  describe('reapertura', () => {
    it('caso 9 · vuelve a APROBADO y el contador sube', async () => {
      const respuesta = await request(servidor())
        .post(`${API}/cuadros/${FECHA}/reabrir`)
        .set(como(DIRECTOR))
        .expect(200);

      const cuadro = respuesta.body as CuadroRespuesta;
      expect(cuadro.estado).toBe(EstadoCuadro.APROBADO);
      expect(cuadro.reaperturas).toBe(1);
      expect(cuadro.cerradoPor).toBeNull();
      expect(cuadro.admiteEscritura).toBe(true);
    });

    it('un rol departamental no puede reabrir', async () => {
      await request(servidor())
        .post(`${API}/cuadros/${FECHA}/reabrir`)
        .set(como(OPERATIVOS))
        .expect(403);
    });

    it('no se reabre lo que no está cerrado', async () => {
      await request(servidor())
        .post(`${API}/cuadros/${FECHA}/reabrir`)
        .set(como(DIRECTOR))
        .expect(409);
    });

    it('reabrir y volver a cerrar deja el contador en uno y el cuadro cerrado', async () => {
      await request(servidor())
        .post(`${API}/cuadros/${FECHA}/cerrar`)
        .set(como(DIRECTOR))
        .expect(200);

      const respuesta = await request(servidor())
        .get(`${API}/cuadros/${FECHA}`)
        .set(como(DIRECTOR))
        .expect(200);

      const cuadro = respuesta.body as CuadroRespuesta;
      expect(cuadro.estado).toBe(EstadoCuadro.CERRADO);
      expect(cuadro.reaperturas).toBe(1);
    });
  });
});
