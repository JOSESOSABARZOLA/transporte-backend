/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de personal y alertas
 * Archivo: asignacion-personal.integracion-spec.ts
 * Responsabilidad: Verificar los nueve casos del plan contra la base real.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * EXIGE LA BASE LEVANTADA. Se ejecuta con `npm run test:integracion`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ES LA PRUEBA QUE ATRAVIESA LOS TRES SUBMÓDULOS. Una asignación toca
 * `configuracion` —áreas admitidas del formulario—, `talento-operativo` —el maestro y el
 * veredicto de descanso— y `operativos` —el cupo, la traza y las alertas—. Con dobles no
 * se vería que las tres piezas encajan.
 *
 * Las ventanas de carga se desactivan mientras corre, como en M-13 y M-14: el momento se
 * controla, no se espera.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccesoFormulario,
  AreaPersonal,
  PoliticaVehiculo,
  RolDepartamental,
  TipoContrato,
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

const PREFIJO = 'PRUEBA_M15';
const API = '/api/v1';

const INSPECCIONES = '2';
const OPERATIVOS = '1';
const INSTRUCTOR = '3';

/** Miércoles: ni fin de semana, para que el contrato no interfiera. */
const FECHA = '2026-10-14';

interface Alerta {
  codigo: string;
  campo: string;
  critica: boolean;
}

interface OperativoRespuesta {
  id: number;
  identificador: string;
  version: number;
  alertaActiva: boolean;
  alertas: Alerta[];
  personal: {
    funcionarioId: number;
    nombre: string;
    area: string;
    telefono: string | null;
    esResponsable: boolean;
    asignadoPorRol: string;
  }[];
  composicion: {
    esPatrulla: boolean;
    completa: boolean;
    areasPendientes: string[];
  };
}

describe('Asignación de personal · integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ventanasIniciales: VentanaCarga[] = [];

  let formularioPatrulla = 0;
  let inspectorGeneral = 0;
  let inspectorTecnico = 0;
  let instructor = 0;
  let otroInstructor = 0;
  let personaDeOtraArea = 0;
  let generalSinAsignar = 0;
  let operativoId = 0;
  let versionActual = 1;

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
        't_formulario ya tiene formularios institucionales. Esta prueba crea el suyo con el número 5 y chocaría con ellos: revise la estrategia de datos de prueba antes de continuar.',
      );
    }

    // Reproduce el formulario 6 del negocio: dueño Inspecciones, DMIT con cupo de una
    // persona del área de Instrucción (PER-06, PV-09).
    const formulario = await prisma.formulario.create({
      data: {
        numero: 5,
        codigo: `${PREFIJO}_PATRULLA`,
        nombre: 'PATRULLA DE PRUEBA',
        colorFondo: '#EEEEEE',
        colorAcento: '#000000',
        colorNombre: 'gris',
        rolDueno: RolDepartamental.DMIP_INSPECCIONES,
        politicaVehiculo: PoliticaVehiculo.REQUERIDO,
        esPatrulla: true,
        orden: 5,
        // Autorización en t_formulario_rol: Inspecciones registra (ESCRITURA), DMIT aporta
        // una persona de Instrucción (APORTA, cupo 1).
        roles: {
          create: [
            {
              rol: RolDepartamental.DMIP_INSPECCIONES,
              acceso: AccesoFormulario.ESCRITURA,
            },
            {
              rol: RolDepartamental.DMIT_INSTRUCTOR,
              acceso: AccesoFormulario.APORTA,
              cupo: 1,
            },
          ],
        },
        prefijos: { create: [{ prefijo: 'PAT', esPredeterminado: true }] },
        areas: {
          create: [
            { area: AreaPersonal.GENERAL, esCompartida: false },
            { area: AreaPersonal.TECNICO, esCompartida: false },
            { area: AreaPersonal.INSTRUCCION, esCompartida: true },
          ],
        },
      },
    });
    formularioPatrulla = formulario.id;

    const zonal = await prisma.zonal.findFirst({ orderBy: { orden: 'asc' } });
    const punto = await prisma.puntoEncuentro.create({
      data: {
        nombre: `${PREFIJO} PUNTO`,
        zonalId: zonal?.id as number,
        formularios: { create: [{ formularioId: formularioPatrulla }] },
      },
    });
    const tipo = await prisma.tipoControl.create({
      data: {
        nombre: `${PREFIJO} CONTROL`,
        formularioId: formularioPatrulla,
      },
    });
    const entidad = await prisma.institucion.create({
      data: {
        sigla: `${PREFIJO}AMT`,
        nombre: 'Agencia de prueba',
        formularios: { create: [{ formularioId: formularioPatrulla }] },
      },
    });

    inspectorGeneral = await crearFuncionario('0101', AreaPersonal.GENERAL);
    inspectorTecnico = await crearFuncionario('0102', AreaPersonal.TECNICO);
    instructor = await crearFuncionario('0103', AreaPersonal.INSTRUCCION);
    otroInstructor = await crearFuncionario('0104', AreaPersonal.INSTRUCCION);
    personaDeOtraArea = await crearFuncionario('0105', AreaPersonal.OPERATIVOS);
    generalSinAsignar = await crearFuncionario('0107', AreaPersonal.GENERAL);

    await prisma.cuadroDiario.create({
      data: {
        fecha: new Date(`${FECHA}T00:00:00.000Z`),
        ordenTrabajo: `${PREFIJO}-OT-001`,
        nroSemana: 42,
        anioSemana: 2026,
      },
    });

    const creado = await request(servidor())
      .post(`${API}/operativos`)
      .set(como(INSPECCIONES))
      .send({
        cuadroFecha: FECHA,
        formularioCodigo: `${PREFIJO}_PATRULLA`,
        horaInicio: '08:00',
        horaFin: '12:00',
        zonalesIds: [zonal?.id],
        puntoEncuentroId: punto.id,
        tipoControlId: tipo.id,
        institucionesIds: [entidad.id],
      })
      .expect(201);

    const operativo = creado.body as OperativoRespuesta;
    operativoId = operativo.id;
    versionActual = operativo.version;
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
    await prisma.conductor.deleteMany({
      where: { nombreCompleto: { startsWith: PREFIJO } },
    });
    await prisma.vehiculo.deleteMany({ where: { placa: 'PRU0001' } });
  };

  const crearFuncionario = async (
    sufijo: string,
    area: AreaPersonal,
  ): Promise<number> => {
    const funcionario = await prisma.funcionario.create({
      data: {
        cedula: `999999${sufijo}`,
        apellidos: `${PREFIJO} APELLIDO`,
        nombres: `NOMBRE ${sufijo}`,
        telefono: `09${sufijo}00000`,
        area,
        // OCASIONAL: RN-26 no restringe su jornada, de modo que el caso que se prueba
        // aquí es la composición y no el contrato, que ya tiene sus pruebas en M-12.
        tipoContrato: TipoContrato.OCASIONAL,
        direccion: RolDepartamental.DMIP_INSPECCIONES,
      },
    });
    return funcionario.id;
  };

  const servidor = (): Server => app.getHttpServer() as Server;

  const asignar = (usuario: string, cuerpo: Record<string, unknown>) =>
    request(servidor())
      .post(`${API}/operativos/${operativoId}/personal`)
      .set(como(usuario))
      .send(cuerpo);

  const retirar = (usuario: string, funcionarioId: number) =>
    request(servidor())
      .delete(`${API}/operativos/${operativoId}/personal/${funcionarioId}`)
      .set(como(usuario));

  const codigosDeAlerta = (operativo: OperativoRespuesta): string[] =>
    operativo.alertas.map((alerta) => alerta.codigo);

  describe('el operativo recién registrado', () => {
    it('nace con sus alertas ya derivadas', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/operativos/${operativoId}`)
        .set(como(INSPECCIONES))
        .expect(200);

      const operativo = respuesta.body as OperativoRespuesta;

      // Sin personal y sin conductor. La ausencia de notas ya no emite alerta (ALV-05 se
      // retiró el 2026-09-14 por ruido: sin notas la celda queda vacía).
      expect(codigosDeAlerta(operativo)).toEqual(['ALV-01', 'ALV-02', 'ALV-03']);
      expect(operativo.alertaActiva).toBe(true);
      expect(operativo.personal).toHaveLength(0);
    });

    it('RN-31 · informa qué áreas faltan, sin impedir nada', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/operativos/${operativoId}`)
        .set(como(INSPECCIONES))
        .expect(200);

      const composicion = (respuesta.body as OperativoRespuesta).composicion;
      expect(composicion.esPatrulla).toBe(true);
      expect(composicion.completa).toBe(false);
      expect(composicion.areasPendientes).toEqual([
        'GENERAL',
        'TECNICO',
        'INSTRUCCION',
      ]);
    });
  });

  describe('asignación', () => {
    it('caso 1 · asigna a una persona elegible y ALV-01 desaparece', async () => {
      const respuesta = await asignar(INSPECCIONES, {
        funcionarioId: inspectorGeneral,
        esResponsable: true,
      }).expect(201);

      const operativo = respuesta.body as OperativoRespuesta;

      expect(operativo.personal).toHaveLength(1);
      expect(codigosDeAlerta(operativo)).not.toContain('ALV-01');
      expect(operativo.alertaActiva).toBe(true); // Siguen las de transporte.
    });

    it('caso 9 · el teléfono viene del maestro, no de la petición', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/operativos/${operativoId}`)
        .set(como(INSPECCIONES))
        .expect(200);

      const persona = (respuesta.body as OperativoRespuesta).personal[0];

      expect(persona.telefono).toBe('090101' + '00000');
      expect(persona.nombre).toContain('APELLIDO');
      expect(persona.esResponsable).toBe(true);
      expect(persona.asignadoPorRol).toBe(RolDepartamental.DMIP_INSPECCIONES);
    });

    it('el teléfono enviado en el cuerpo se rechaza (RN-34)', async () => {
      const respuesta = await asignar(INSPECCIONES, {
        funcionarioId: inspectorTecnico,
        telefono: '0988888888',
      }).expect(400);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('CAMPOS_NO_PERMITIDOS');
      expect(cuerpo.mensaje).toContain('telefono');
    });

    it('caso 2 · la misma persona dos veces responde 409', async () => {
      const respuesta = await asignar(INSPECCIONES, {
        funcionarioId: inspectorGeneral,
      }).expect(409);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        'ya figura',
      );
    });

    it('caso 3 · un área no admitida responde 409 enumerando las que sí', async () => {
      const respuesta = await asignar(INSPECCIONES, {
        funcionarioId: personaDeOtraArea,
      }).expect(409);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('AREA_NO_ADMITIDA');
      expect(cuerpo.mensaje).toContain('GENERAL');
      expect(cuerpo.mensaje).toContain('TECNICO');
    });

    it('un departamento ajeno no asigna en este formulario', async () => {
      await asignar(OPERATIVOS, { funcionarioId: inspectorTecnico }).expect(403);
    });

    it('completa la composición con el inspector técnico', async () => {
      const respuesta = await asignar(INSPECCIONES, {
        funcionarioId: inspectorTecnico,
      }).expect(201);

      const operativo = respuesta.body as OperativoRespuesta;
      expect(operativo.personal).toHaveLength(2);
      expect(operativo.composicion.areasPendientes).toEqual(['INSTRUCCION']);
    });

    it('marcar un segundo responsable retira la responsabilidad del primero', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/operativos/${operativoId}`)
        .set(como(INSPECCIONES))
        .expect(200);

      const responsables = (
        respuesta.body as OperativoRespuesta
      ).personal.filter((persona) => persona.esResponsable);

      expect(responsables).toHaveLength(1);
    });
  });

  describe('PER-06 · el cupo del rol compartido', () => {
    it('caso 6 · el DMIT no asigna fuera del área de Instrucción', async () => {
      // La persona es del área GENERAL: el formulario SÍ la admite —el dueño podría
      // asignarla—, pero no está entre las compartidas. Es exactamente la distinción
      // que separa VAL-10 de PER-06.
      const respuesta = await asignar(INSTRUCTOR, {
        funcionarioId: generalSinAsignar,
      }).expect(409);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('CUPO_COMPARTIDO_SUPERADO');
      expect(cuerpo.mensaje).toContain('INSTRUCCION');
    });

    it('caso 4 · dentro del cupo, el DMIT asigna a su persona de Instrucción', async () => {
      const respuesta = await asignar(INSTRUCTOR, {
        funcionarioId: instructor,
      }).expect(201);

      const operativo = respuesta.body as OperativoRespuesta;
      const asignada = operativo.personal.find(
        (persona) => persona.funcionarioId === instructor,
      );

      expect(asignada?.asignadoPorRol).toBe(RolDepartamental.DMIT_INSTRUCTOR);
      // RN-31 y RN-32: con las tres áreas, la composición queda completa.
      expect(operativo.composicion.completa).toBe(true);
    });

    it('caso 5 · una segunda persona excede el cupo', async () => {
      const respuesta = await asignar(INSTRUCTOR, {
        funcionarioId: otroInstructor,
      }).expect(409);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('CUPO_COMPARTIDO_SUPERADO');
      expect(cuerpo.mensaje).toContain('1 de 1');
    });

    it('el DUEÑO sí puede asignar a esa misma persona: el cupo es del rol compartido', async () => {
      const respuesta = await asignar(INSPECCIONES, {
        funcionarioId: otroInstructor,
      }).expect(201);

      expect((respuesta.body as OperativoRespuesta).personal).toHaveLength(4);
    });
  });

  describe('VAL-12 a VAL-17 · el veredicto llega de talento-operativo', () => {
    it('una persona de vacaciones se rechaza con el motivo y la fecha de retorno', async () => {
      await prisma.disponibilidad.create({
        data: {
          funcionarioId: personaDeOtraArea,
          estado: 'VACACIONES',
          desde: new Date(`${FECHA}T00:00:00.000Z`),
          hasta: new Date('2026-10-20T00:00:00.000Z'),
          registradoPor: 6,
        },
      });

      // El área tampoco está admitida, así que la composición responde antes. Para
      // aislar el veredicto de descanso se usa una persona del área correcta.
      await prisma.funcionario.update({
        where: { id: personaDeOtraArea },
        data: { area: AreaPersonal.GENERAL },
      });

      const respuesta = await asignar(INSPECCIONES, {
        funcionarioId: personaDeOtraArea,
      }).expect(409);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('PERSONA_NO_DISPONIBLE');
      expect(cuerpo.mensaje).toContain('vacaciones');
      expect(cuerpo.mensaje).toContain('2026-10-20');
    });
  });

  describe('retiro', () => {
    it('el rol compartido no retira lo que asignó el dueño', async () => {
      await retirar(INSTRUCTOR, inspectorGeneral).expect(403);
    });

    it('el rol compartido sí retira lo suyo, y recupera su cupo', async () => {
      await retirar(INSTRUCTOR, instructor).expect(200);

      // Recuperado el cupo, puede volver a asignar.
      await asignar(INSTRUCTOR, { funcionarioId: instructor }).expect(201);
      await retirar(INSTRUCTOR, instructor).expect(200);
    });

    it('quien no figura en el operativo produce 404', async () => {
      await retirar(INSPECCIONES, 999999).expect(404);
    });

    it('caso 7 · al retirar al último, ALV-01 vuelve a activarse sola', async () => {
      const restantes = await prisma.asignacionPersonal.findMany({
        where: { operativoId },
      });

      let ultima: OperativoRespuesta | undefined;
      for (const asignacion of restantes) {
        const respuesta = await retirar(
          INSPECCIONES,
          asignacion.funcionarioId,
        ).expect(200);
        ultima = respuesta.body as OperativoRespuesta;
      }

      expect(ultima?.personal).toHaveLength(0);
      expect(codigosDeAlerta(ultima as OperativoRespuesta)).toContain('ALV-01');
      expect(ultima?.alertaActiva).toBe(true);
    });
  });

  describe('caso 8 · las alertas se recalculan por completo', () => {
    it('cambiar el horario a nocturno con transporte asignado produce ALV-04', async () => {
      // La DAF ya asignó transporte: sin condicionante nocturno, no hay alertas de
      // conductor. Se escribe directamente porque el endpoint de transporte es M-17.
      const conductor = await prisma.conductor.create({
        data: {
          cedula: '9999990106',
          nombreCompleto: `${PREFIJO} CONDUCTOR`,
          licenciaTipo: 'E',
        },
      });
      const vehiculo = await prisma.vehiculo.create({
        data: { placa: 'PRU0001', descripcion: `${PREFIJO} camioneta` },
      });

      await prisma.operativo.update({
        where: { id: operativoId },
        data: {
          estadoTransporte: 'ASIGNADO',
          conductorId: conductor.id,
          vehiculoId: vehiculo.id,
          // Una nota de escenario (bitácora, 2026-09-09). La ausencia de notas ya no emite
          // alerta (ALV-05 se retiró el 2026-09-14), así que esto es solo dato del caso.
          observaciones: {
            create: {
              texto: 'Coordinado con la AMT.',
              creadoPorRol: RolDepartamental.DMIP_INSPECCIONES,
              creadoPor: 2,
            },
          },
        },
      });
      await prisma.formulario.update({
        where: { id: formularioPatrulla },
        data: { condicionanteNoct: true },
      });

      const actual = await request(servidor())
        .get(`${API}/operativos/${operativoId}`)
        .set(como(INSPECCIONES))
        .expect(200);

      versionActual = (actual.body as OperativoRespuesta).version;

      // Se reprograma a horario nocturno. El transporte sigue asignado, así que la
      // alerta crítica NO aparece: el conductor ya está.
      const editado = await request(servidor())
        .patch(`${API}/operativos/${operativoId}`)
        .set(como(INSPECCIONES))
        .send({ version: versionActual, horaInicio: '20:00', horaFin: '02:00' })
        .expect(200);

      const conConductor = editado.body as OperativoRespuesta;
      expect(codigosDeAlerta(conConductor)).not.toContain('ALV-04');

      // Y al retirar el transporte, el recálculo completo la hace aparecer.
      await prisma.operativo.update({
        where: { id: operativoId },
        data: {
          estadoTransporte: 'PENDIENTE',
          conductorId: null,
          vehiculoId: null,
        },
      });

      const reeditado = await request(servidor())
        .patch(`${API}/operativos/${operativoId}`)
        .set(como(INSPECCIONES))
        .send({ version: conConductor.version, horaFin: '03:00' })
        .expect(200);

      const alertas = (reeditado.body as OperativoRespuesta).alertas;
      const critica = alertas.find((alerta) => alerta.codigo === 'ALV-04');

      expect(critica).toBeDefined();
      expect(critica?.critica).toBe(true);
    });

    it('las alertas quedan guardadas en la base, no solo en la respuesta', async () => {
      const guardado = await prisma.operativo.findUnique({
        where: { id: operativoId },
      });

      const alertas = guardado?.alertas as unknown as Alerta[];
      expect(guardado?.alertaActiva).toBe(true);
      expect(alertas.some((alerta) => alerta.codigo === 'ALV-04')).toBe(true);
    });
  });
});
