/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Jornada del día (P-13)
 * Archivo: jornada.integracion-spec.ts
 * Responsabilidad: Que la apertura de la jornada a los tres departamentos no filtre personal.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-01
 *
 * EXIGE LA BASE LEVANTADA. Se ejecuta con `npm run test:integracion`.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ES LA PRUEBA QUE SOSTIENE LA DECISIÓN DEL 2026-09-01.
 *
 * Ese día la jornada dejó de ser exclusiva del DMIT y pasó a los tres roles
 * departamentales. PER-02 —«la matriz no se renderiza para perfiles departamentales»—
 * pasó de una excepción a tres, y **el aislamiento de la información es el requisito que
 * originó este encargo**: el cuadro circulaba por WhatsApp y los intervenidos se
 * anticipaban al operativo.
 *
 * Lo que hace la apertura defendible es el recorte: en una sección que el rol solo lee,
 * el personal no viaja. Las pruebas unitarias lo fijan sobre el servicio; ésta lo
 * comprueba **atravesando la guarda, el servicio y el DTO**, que es donde un mapeo mal
 * escrito volvería a publicarlo sin que nada fallara.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * FIXTURE PROPIO Y DIRECTO, sin registrar por HTTP. Lo que se prueba es una consulta; dar
 * de alta los operativos por la API metería la ventana de carga y las reglas de descanso
 * en una prueba que no habla de ninguna de las dos.
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

const OPERATIVOS = '1';
const INSPECCIONES = '2';
const INSTRUCCION = '3';
const DAF = '4';
const DIRECTOR = '5';

const API = '/api/v1';
const PREFIJO = 'PRUEBA_P13';
const FECHA = '2027-04-12';

/** Compuestas con el algoritmo de módulo 10. No pertenecen a ninguna persona. */
const CEDULA_OPERATIVOS = '1710034065';
const CEDULA_INSPECCIONES = '1713175146';

interface FilaJornada {
  identificador: string;
  horario: string;
  personal: { nombre: string }[];
}

/** La seccion es PLANA en el contrato: el formulario no viaja anidado. */
interface SeccionJornada {
  numero: number;
  acceso: string;
  /** Si esta pantalla ofrece la acción de personal. Ver el bloque del final. */
  puedeEditarPersonal: boolean;
  /** El contrato las llama FILAS, no operativos. */
  filas: FilaJornada[];
}

describe('Jornada del día · integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = modulo.createNestApplication({ bufferLogs: true });
    app.use(correlacionMiddleware);
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

    const cuadro = await prisma.cuadroDiario.create({
      data: {
        fecha: new Date(`${FECHA}T00:00:00.000Z`),
        ordenTrabajo: `${PREFIJO}-OT`,
        nroSemana: 15,
        anioSemana: 2027,
      },
    });

    /**
     * DOS FORMULARIOS DE DEPARTAMENTOS DISTINTOS, cada uno con su fila en
     * `t_formulario_rol`. Sin esa fila el servicio los marcaría `LECTURA` para todo el
     * mundo y la prueba pasaría sin comprobar nada: el recorte se aplicaría siempre.
     */
    const deOperativos = await prisma.formulario.create({
      data: {
        numero: 1,
        codigo: `${PREFIJO}_OPE`,
        nombre: 'FORMULARIO DE PRUEBA P13 · OPERATIVOS',
        colorFondo: '#EEEEEE',
        colorAcento: '#000000',
        colorNombre: 'gris',
        rolDueno: RolDepartamental.DMIP_OPERATIVOS,
        politicaVehiculo: PoliticaVehiculo.CONDICIONAL,
        condicionanteNoct: false,
        esPatrulla: false,
        orden: 1,
        areas: { create: [{ area: AreaPersonal.OPERATIVOS }] },
        roles: {
          create: [
            {
              rol: RolDepartamental.DMIP_OPERATIVOS,
              acceso: 'ESCRITURA',
            },
          ],
        },
      },
    });

    const deInspecciones = await prisma.formulario.create({
      data: {
        numero: 2,
        codigo: `${PREFIJO}_INS`,
        nombre: 'FORMULARIO DE PRUEBA P13 · INSPECCIONES',
        colorFondo: '#EEEEEE',
        colorAcento: '#000000',
        colorNombre: 'gris',
        rolDueno: RolDepartamental.DMIP_INSPECCIONES,
        politicaVehiculo: PoliticaVehiculo.CONDICIONAL,
        condicionanteNoct: false,
        esPatrulla: false,
        orden: 2,
        areas: { create: [{ area: AreaPersonal.GENERAL }] },
        roles: {
          create: [
            {
              rol: RolDepartamental.DMIP_INSPECCIONES,
              acceso: 'ESCRITURA',
            },
          ],
        },
      },
    });

    const [unoDeOperativos, unoDeInspecciones] = await Promise.all([
      prisma.funcionario.create({
        data: {
          cedula: CEDULA_OPERATIVOS,
          apellidos: `${PREFIJO}_DE_OPERATIVOS`,
          nombres: 'PERSONA',
          area: AreaPersonal.OPERATIVOS,
          tipoContrato: TipoContrato.NOMBRAMIENTO,
          direccion: RolDepartamental.DMIP_OPERATIVOS,
        },
      }),
      prisma.funcionario.create({
        data: {
          cedula: CEDULA_INSPECCIONES,
          apellidos: `${PREFIJO}_DE_INSPECCIONES`,
          nombres: 'PERSONA',
          area: AreaPersonal.GENERAL,
          tipoContrato: TipoContrato.NOMBRAMIENTO,
          direccion: RolDepartamental.DMIP_INSPECCIONES,
        },
      }),
    ]);

    const operativo = (
      formularioId: number,
      sufijo: string,
      rol: RolDepartamental,
      funcionarioId: number,
      usuario: number,
    ) =>
      prisma.operativo.create({
        data: {
          cuadroId: cuadro.id,
          formularioId,
          identificador: `${PREFIJO}-${sufijo}`,
          secuencial: 1,
          horaInicio: '08:00',
          horaFin: '12:00',
          esNocturno: false,
          cruzaMedianoche: false,
          duracionHoras: 4,
          puntoLibre: 'Punto de prueba',
          tipoLibre: 'Tipo de prueba',
          creadoPorRol: rol,
          creadoPor: usuario,
          modificadoPorRol: rol,
          modificadoPor: usuario,
          personal: {
            create: [{ funcionarioId, asignadoPorRol: rol }],
          },
        },
      });

    await Promise.all([
      operativo(
        deOperativos.id,
        'OPE',
        RolDepartamental.DMIP_OPERATIVOS,
        unoDeOperativos.id,
        1,
      ),
      operativo(
        deInspecciones.id,
        'INS',
        RolDepartamental.DMIP_INSPECCIONES,
        unoDeInspecciones.id,
        2,
      ),
    ]);
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  const limpiar = async (): Promise<void> => {
    await prisma.operativo.deleteMany({
      where: { identificador: { startsWith: PREFIJO } },
    });
    await prisma.formulario.deleteMany({
      where: { codigo: { startsWith: PREFIJO } },
    });
    await prisma.funcionario.deleteMany({
      where: { apellidos: { startsWith: PREFIJO } },
    });
    await prisma.cuadroDiario.deleteMany({
      where: { ordenTrabajo: { startsWith: PREFIJO } },
    });
  };

  const servidor = (): Server => app.getHttpServer() as Server;

  const jornadaDe = async (rol: string): Promise<SeccionJornada[]> => {
    const respuesta = await request(servidor())
      .get(`${API}/jornada/${FECHA}`)
      .set(como(rol))
      .expect(200);

    return (respuesta.body as { secciones: SeccionJornada[] }).secciones.filter(
      (seccion) => seccion.numero <= 2,
    );
  };

  const nombresDe = (secciones: SeccionJornada[], numero: number): string[] =>
    secciones
      .filter((seccion) => seccion.numero === numero)
      .flatMap((seccion) => seccion.filas)
      .flatMap((operativo) => operativo.personal)
      .map((persona) => persona.nombre);

  describe('quién abre la jornada', () => {
    it('los tres roles departamentales', async () => {
      for (const rol of [OPERATIVOS, INSPECCIONES, INSTRUCCION]) {
        await request(servidor())
          .get(`${API}/jornada/${FECHA}`)
          .set(como(rol))
          .expect(200);
      }
    });

    /**
     * ES LA QUE DISCRIMINA. La anterior pasaría con un endpoint abierto a cualquiera;
     * ésta exige que la apertura sea de los tres y no de todos. La Dirección tiene la
     * suya en `/matriz`, con el documento completo; la DAF no consulta la jornada.
     */
    it('y ni la DAF ni la Dirección', async () => {
      for (const rol of [DAF, DIRECTOR]) {
        await request(servidor())
          .get(`${API}/jornada/${FECHA}`)
          .set(como(rol))
          .expect(403);
      }
    });
  });

  describe('el personal ajeno no sale del servidor', () => {
    it('cada departamento ve el suyo en la sección que escribe', async () => {
      expect(nombresDe(await jornadaDe(OPERATIVOS), 1)).toContain(
        `${PREFIJO}_DE_OPERATIVOS PERSONA`,
      );
      expect(nombresDe(await jornadaDe(INSPECCIONES), 2)).toContain(
        `${PREFIJO}_DE_INSPECCIONES PERSONA`,
      );
    });

    /**
     * ═══════════════════════════════════════════════════════════════════════════════
     * LA QUE PROTEGE EL REQUISITO QUE ORIGINÓ EL ENCARGO.
     *
     * Se afirma sobre el **cuerpo entero** de la respuesta y no sobre una sección: si un
     * mapeo futuro colara el personal por otro camino —una sección nueva, un campo
     * derivado, un resumen— esta prueba lo vería igual. Buscar solo donde hoy se recorta
     * probaría el recorte de hoy, no la promesa.
     * ═══════════════════════════════════════════════════════════════════════════════
     */
    it('y no aparece ni un nombre ajeno en toda la respuesta', async () => {
      const paraOperativos = await request(servidor())
        .get(`${API}/jornada/${FECHA}`)
        .set(como(OPERATIVOS))
        .expect(200);

      const cuerpo = JSON.stringify(paraOperativos.body);

      expect(cuerpo).toContain(`${PREFIJO}_DE_OPERATIVOS`);
      expect(cuerpo).not.toContain(`${PREFIJO}_DE_INSPECCIONES`);
    });

    /**
     * EL RECORTE ALCANZA TAMBIÉN AL DMIT, que no participa en ninguno de los dos. Es
     * deliberado: la regla es una —participo, veo; solo leo, no— y hacerla depender de
     * qué rol pregunta habría vuelto a meter un rol dentro de un `if`.
     */
    it('el DMIT tampoco ve el personal de los dos formularios ajenos', async () => {
      const secciones = await jornadaDe(INSTRUCCION);

      expect(nombresDe(secciones, 1)).toEqual([]);
      expect(nombresDe(secciones, 2)).toEqual([]);
    });

    /**
     * Y LA SECCIÓN AJENA YA NO VIAJA (2026-09-15). Giro respecto de 2026-08-26: el rol ya no
     * ve la forma del día ajena. El formulario que solo leería no aparece en la respuesta.
     */
    it('la sección ajena ya no viaja', async () => {
      const secciones = await jornadaDe(INSTRUCCION);
      const ajena = secciones.find((seccion) => seccion.numero === 1);

      expect(ajena).toBeUndefined();
    });
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * LA OTRA MITAD DE LA DECISIÓN DEL 2026-09-01: «SOLO EN LECTURA».
   *
   * Al abrir esta rejilla a los tres departamentos, el negocio pidió dos cosas: sin el
   * personal ajeno —lo que prueba el bloque de arriba— y **solo en lectura**. La segunda
   * no se implementó ese día: la pantalla ofrecía la acción donde `acceso <> LECTURA`, y
   * los dos roles nuevos tienen ESCRITURA en lo suyo.
   *
   * LO QUE ESTA SUITE APORTA, Y NO PUEDEN LAS UNITARIAS, es que el dato **llegue**. La
   * lógica está fijada en `jornada.service.spec.ts`; aquí se comprueba el camino entero
   * —columna de `t_formulario_rol`, servicio, DTO, respuesta HTTP—, que es donde se
   * pierde un campo cuando alguien añade uno al servicio y olvida mapearlo.
   *
   * SE AFIRMA `toBe(false)` Y NO `toBeFalsy()`: un campo que no viajara llegaría como
   * `undefined`, que es falso y pasaría la comprobación laxa dejando a la pantalla
   * decidiendo con un valor que el servidor nunca envió.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  describe('quién puede asignar personal desde la jornada', () => {
    it('ninguno de los tres, con la siembra de esta suite', async () => {
      // Los formularios de la suite se crean sin conceder el camino, que es la postura
      // por omisión de la columna: participar no lo concede.
      for (const rol of [OPERATIVOS, INSPECCIONES, INSTRUCCION]) {
        for (const seccion of await jornadaDe(rol)) {
          expect(seccion.puedeEditarPersonal).toBe(false);
        }
      }
    });

    /**
     * ES LA QUE DISCRIMINA. La anterior pasaría con un servidor que devolviera `false`
     * siempre, e incluso con uno que no devolviera nada. Aquí se concede el camino en una
     * sola fila y se exige que **esa** sección cambie y la otra no.
     */
    it('con la columna puesta, la sección propia trae la acción; la ajena ni aparece', async () => {
      await prisma.formularioRol.updateMany({
        where: {
          rol: RolDepartamental.DMIP_OPERATIVOS,
          formulario: { codigo: `${PREFIJO}_OPE` },
        },
        data: { editaDesdeJornada: true },
      });

      try {
        const secciones = await jornadaDe(OPERATIVOS);

        // La sección donde OPERATIVOS escribe y tiene la columna: con acción.
        expect(
          secciones.find((seccion) => seccion.numero === 1)
            ?.puedeEditarPersonal,
        ).toBe(true);
        // La sección ajena (form 2, de Inspecciones) ya no viaja (2026-09-15).
        expect(
          secciones.find((seccion) => seccion.numero === 2),
        ).toBeUndefined();
      } finally {
        // Se devuelve el dato a como estaba: las suites comparten base y una fila
        // alterada haría fallar a la anterior según el orden de ejecución.
        await prisma.formularioRol.updateMany({
          where: { formulario: { codigo: { startsWith: PREFIJO } } },
          data: { editaDesdeJornada: false },
        });
      }
    });
  });
});
