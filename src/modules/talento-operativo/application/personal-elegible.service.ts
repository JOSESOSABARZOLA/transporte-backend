/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Personal elegible
 * Archivo: personal-elegible.service.ts
 * Responsabilidad: Responder a quién se le puede asignar un operativo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * POR QUÉ ES UN TERCER SERVICIO Y NO UN MÉTODO DE LOS OTROS DOS. La pregunta cruza
 * tres fuentes: qué áreas admite el formulario (submódulo `configuracion`), quién
 * pertenece a esas áreas (maestro de personal) y quién está ausente (disponibilidad).
 * Ponerlo en `FuncionariosService` lo obligaría a depender de `DisponibilidadService`,
 * que ya depende de él: una dependencia circular. Este servicio es la costura natural.
 *
 * ES TAMBIÉN DONDE ENTRARÁ M-12. Hoy responde con dos filtros —área y ausencia—; las
 * políticas de descanso añadirán patrulla consecutiva, tope de salidas pesadas,
 * jornada máxima y tipo de contrato. El contrato de salida ya contempla el motivo del
 * descarte, de modo que M-12 amplía la lista de motivos sin cambiar la forma.
 *
 * LO QUE DEVUELVE ES DELIBERADAMENTE POBRE. Ni cédula ni teléfono: quien arma el
 * cuadro elige personas por su nombre y su área. RN-34 dice que el teléfono vive solo
 * en el maestro, y la orden de servicio lo incorpora después, para el conductor.
 */

import { Injectable } from '@nestjs/common';
import type { AreaPersonal, RolDepartamental } from '@prisma/client';

import { FormulariosService } from '../../configuracion/application/formularios.service';
import { areasDeLosRoles } from '../domain/areas-del-rol';
import type { DatosParaSeleccion } from '../infrastructure/funcionarios.repository';
import { DisponibilidadService } from './disponibilidad.service';
import { ElegibilidadService } from './elegibilidad.service';
import { FuncionariosService } from './funcionarios.service';
import { clasificarEquidad } from './politicas/indice-fatiga.policy';
import type {
  NivelEquidad,
  NivelFatiga,
} from './politicas/indice-fatiga.policy';

/**
 * Candidato del formulario, **con su veredicto**.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * PV-37 RESUELTO EL 2026-08-11 · SE DEVUELVEN TODOS, CON EL MOTIVO DE QUIEN NO PUEDE.
 *
 * Hasta esta fecha esta consulta **descartaba** a quien no podía salir y devolvía solo a
 * los aptos. Quien armaba el cuadro veía una lista más corta sin saber por qué faltaba
 * alguien, y el motivo solo aparecía al intentar asignarlo —cosa imposible, porque no
 * estaba en la lista—. Es exactamente lo que el análisis quiso evitar: una persona que
 * desaparece sin explicación obliga a levantar el teléfono, que es el canal que este
 * sistema existe para reemplazar.
 *
 * EL MOTIVO DE UNA AUSENCIA NO SE DETALLA. Las reglas de descanso explican su rechazo
 * entero —«ya está asignada al operativo X», «acumularía 14,5 horas»— porque son hechos
 * operativos del cuadro. Una ausencia, no: `DisponibilidadService.ausentesEntre` entrega
 * solo identificadores a propósito, para no publicar que alguien está de reposo médico o
 * de calamidad doméstica. Aquí se dice **que no está disponible**, nunca por qué.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface PersonaElegible {
  id: number;
  apellidos: string;
  nombres: string;
  area: AreaPersonal;
  cargo: string | null;
  /**
   * Zona que la persona gestiona. Viaja para que la pantalla de registro proponga la zonal
   * del operativo al asignarla (2026-09-24). Nula si no tiene. No es un dato de contacto, así
   * que no cae en la reserva de la cédula/teléfono (RN-34).
   */
  zonalId: number | null;
  /** Si puede recibir la asignación en el horario consultado. */
  elegible: boolean;
  /** Por qué no puede, redactado para el funcionario. Nulo si puede. */
  motivo: string | null;
  /**
   * DOS SEÑALES ADVISORY DISTINTAS (2026-09-29). NO cambian `elegible` ni bloquean; si no se
   * calcularon, no viajan y el contrato anterior queda intacto. Ver `ElegibilidadService`.
   *
   * 1) FATIGA (seguridad, FRMS / ISO 45001): `indiceCarga` + `nivelFatiga`, por umbrales ABSOLUTOS.
   *    Mide si la persona se acerca a un límite de fatiga; no depende del grupo.
   * 2) EQUIDAD (reparto): `cuotaJusta` (media del grupo), `desviacionCarga` (carga − cuota) y
   *    `nivelEquidad`. Mide si carga más o menos que su parte justa; es relativa al grupo.
   */
  indiceCarga?: number;
  nivelFatiga?: NivelFatiga;
  /** Cuántos operativos tiene asignados la persona en el período de equidad (semana/mes). */
  operativosAsignados?: number;
  /** Cuota justa del grupo (media de las cargas de los elegibles): la «parte» de cada persona. */
  cuotaJusta?: number;
  /** Carga de la persona menos su cuota justa. Positivo = por encima de su parte. */
  desviacionCarga?: number;
  nivelEquidad?: NivelEquidad;
  /** Elegible por DEBAJO de su cuota justa, propuesto para equilibrar (no obliga: decide el operador). */
  sugerido?: boolean;
}

/**
 * Lo que se dice de una ausencia: que la hay, no cuál es. Ver la nota de arriba.
 *
 * Empieza por el nombre igual que los motivos de las políticas de descanso —«SOSA
 * BARZOLA JOSE LUIS ya está asignada al operativo…»—: la pantalla los muestra juntos y
 * dos redacciones distintas se leerían como dos clases de aviso.
 */
const motivoDeAusencia = (nombre: string): string =>
  `${nombre} no está disponible en la fecha del operativo por una ausencia registrada.`;

/**
 * DESCANSO de la cobertura por turnos (Instrucción). Es disponibilidad por día, no una
 * ausencia de `t_disponibilidad`, así que se dice sin horario igual que la ausencia.
 */
const motivoDeDescanso = (nombre: string): string =>
  `${nombre} tiene turno de descanso ese día en la cobertura por turnos de Instrucción.`;

export interface ConsultaElegibles {
  formularioCodigo: string;
  /** Jornada del operativo. Se admite un rango para la planificación de varios días. */
  desde: Date;
  hasta: Date;
  /**
   * Horario del operativo. **Opcional.**
   *
   * Sin él la lista solo puede filtrar por área y ausencia, que es lo que M-10 hacía.
   * Con él se aplican las seis reglas de descanso: sin horario no se puede saber si el
   * turno es nocturno, si se solapa con otro ni cuántas horas sumaría.
   */
  horaInicio?: string;
  horaFin?: string;
  /**
   * Roles de quien consulta. **Los pone el servidor, nunca la petición.**
   *
   * Acota la lista al personal del que esos departamentos disponen. Añadido el
   * 2026-08-27: hasta entonces esta consulta no sabía quién preguntaba, y en el 6 · REACN
   * el DMIT veía inspectores que el servidor le rechazaba al asignarlos.
   *
   * SON TODOS SUS ROLES Y NO EL «ROL DE PARTIDA». Este endpoint no declara `@Roles`, así
   * que la cadena de guardas no estrecha `usuario.rol` y ese campo se queda en el primero
   * que devolvió Auth. Tomarlo dejaba sin personal a quien tuviera además un rol sin área
   * —Administrador, por ejemplo—.
   *
   * Opcional en el tipo porque las pruebas de M-10 lo omiten y su comportamiento sigue
   * siendo el de entonces: sin roles, no se acota.
   */
  roles?: readonly RolDepartamental[];
}

@Injectable()
export class PersonalElegibleService {
  constructor(
    private readonly formularios: FormulariosService,
    private readonly funcionarios: FuncionariosService,
    private readonly disponibilidad: DisponibilidadService,
    private readonly elegibilidad: ElegibilidadService,
  ) {}

  /**
   * Personal al que se le puede asignar el formulario en esas fechas.
   *
   * SI EL FORMULARIO NO DECLARA ÁREAS, la lista sale vacía. Es el mismo criterio que
   * en los catálogos de M-07: devolver a todo el personal «mientras llega la
   * delimitación» ofrecería a Inspecciones gente de Instrucción sin que nadie lo
   * notara. Una lista vacía se ve, se pregunta y se corrige.
   */
  async consultar(consulta: ConsultaElegibles): Promise<PersonaElegible[]> {
    const formulario = await this.formularios.obtenerDefinicion(
      consulta.formularioCodigo,
    );

    const areas = this.areasQueCorresponden(formulario, consulta.roles);
    if (areas.length === 0) return [];

    const candidatos = await this.funcionarios.listarPorAreas(areas);
    if (candidatos.length === 0) return [];

    // RN-30. Una sola consulta para todas las personas del rango, en lugar de una por
    // persona: son varias decenas de candidatos y la pantalla los pide al abrirse.
    const ausentes = await this.disponibilidad.ausentesEntre(
      consulta.desde,
      consulta.hasta,
    );

    // El DESCANSO de la cobertura es disponibilidad por día: no necesita horario, así que
    // se sabe también sin él. Solo el personal de Instrucción tiene cobertura; para el
    // resto el conjunto sale vacío.
    const enDescanso = await this.elegibilidad.descansosEnFecha(
      candidatos.map((candidato) => candidato.id),
      consulta.desde,
    );

    // SIN HORARIO solo se puede saber de las ausencias y del descanso: las seis reglas de
    // descanso necesitan el rango para decidir si el turno es nocturno, si se solapa con
    // otro o cuántas horas sumaría. Quien esté ausente o en descanso ya se dice; el resto
    // se ofrece.
    let base: PersonaElegible[];
    if (!consulta.horaInicio || !consulta.horaFin) {
      base = candidatos.map((candidato) =>
        ausentes.has(candidato.id)
          ? conVeredicto(candidato, motivoDeAusencia(nombreDe(candidato)))
          : enDescanso.has(candidato.id)
            ? conVeredicto(candidato, motivoDeDescanso(nombreDe(candidato)))
            : conVeredicto(candidato, null),
      );
    } else {
      const disponibles = candidatos.filter(
        (candidato) => !ausentes.has(candidato.id),
      );

      // `verificarVarios` en lugar de `filtrarElegibles`: el primero conserva el motivo de
      // cada rechazo, que es justo lo que PV-37 echaba en falta. Sigue siendo una consulta
      // de antecedentes para todo el grupo, no una por persona.
      const veredictos = await this.elegibilidad.verificarVarios(
        disponibles.map((candidato) => candidato.id),
        {
          fecha: consulta.desde,
          horaInicio: consulta.horaInicio,
          horaFin: consulta.horaFin,
          esPatrulla: formulario.esPatrulla,
        },
      );

      const porFuncionario = new Map(
        veredictos.map((fila) => [fila.funcionarioId, fila.veredicto]),
      );

      base = candidatos.map((candidato) => {
        if (ausentes.has(candidato.id)) {
          return conVeredicto(candidato, motivoDeAusencia(nombreDe(candidato)));
        }

        const veredicto = porFuncionario.get(candidato.id);
        return conVeredicto(
          candidato,
          veredicto && !veredicto.elegible
            ? (veredicto.motivo ?? 'no puede recibir esta asignación.')
            : null,
        );
      });
    }

    // ÍNDICE DE CARGA / FATIGA (advisory) y sugerencia. Se hace igual en las dos ramas —con y sin
    // horario—: el índice no depende del rango. No altera `elegible`; solo enriquece y ordena.
    return this.enriquecerConCarga(base, consulta.desde);
  }

  /**
   * Añade a cada persona sus DOS señales advisory y marca `sugerido`. No cambia `elegible` ni el
   * orden. Si `calcularCargas` no devuelve nada (p. ej. sin candidatos), la lista vuelve tal cual,
   * sin los campos nuevos, y el contrato anterior queda intacto.
   *
   * SON DOS PREGUNTAS DISTINTAS Y SE RESUELVEN POR SEPARADO:
   *  · FATIGA (seguridad): el `nivelFatiga` que ya trae la política, por umbrales ABSOLUTOS. No
   *    depende del grupo, así que se copia tal cual de `calcularCargas`.
   *  · EQUIDAD (reparto): se calcula AL FINAL, sobre todo el lote, porque necesita la CUOTA JUSTA
   *    —la media del grupo de elegibles—; solo aquí se tiene el grupo completo. Ver `equilibrar`.
   */
  private async enriquecerConCarga(
    base: PersonaElegible[],
    fecha: Date,
  ): Promise<PersonaElegible[]> {
    const [cargas, margen] = await Promise.all([
      this.elegibilidad.calcularCargas(
        base.map((persona) => persona.id),
        fecha,
      ),
      this.elegibilidad.margenEquidad(),
    ]);

    // SEÑAL 1 · FATIGA (absoluta): el nivel de seguridad que ya resolvió la política.
    const conIndice = base.map((persona) => {
      const carga = cargas.get(persona.id);
      return carga
        ? {
            ...persona,
            indiceCarga: carga.indiceCarga,
            nivelFatiga: carga.nivelFatiga,
            operativosAsignados: carga.operativos,
          }
        : persona;
    });

    // SEÑAL 2 · EQUIDAD (relativa a la cuota justa) y sugerencia de reparto.
    return equilibrar(conIndice, margen);
  }

  /**
   * Las áreas de las que se saca la lista: las del formulario, acotadas al rol.
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * ES UNA INTERSECCIÓN, Y SOLO AFECTA A LO QUE SE OFRECE.
   *
   * Las reglas de escritura no cambian: `reglaAreaAdmitida` sigue aceptando cualquier
   * área que el formulario admita, venga de quien venga. La lista pasa a ser un
   * **subconjunto** de lo permitido, nunca al revés, así que nadie se encuentra un 403
   * por algo que la pantalla le ofreció.
   *
   * EL FORMULARIO PUEDE PEDIR QUE NO SE ACOTE. El 7 · OPERATIVO DMIT es el de los
   * eventuales: reúne gente de las cuatro áreas, y con el filtro su único departamento
   * vería solo Instrucción. Lo dice el dato —`form_filtra_personal_por_rol`—, no un
   * `if` con un código de formulario dentro: cambiarlo en otro es un UPDATE.
   *
   * SIN ROL NO SE ACOTA, que es como se comportaba antes del 2026-08-27. La consulta
   * llega siempre con él desde el controlador; el hueco existe para las pruebas de
   * M-10, que verifican el filtrado por área y no tienen por qué conocer los roles.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  private areasQueCorresponden(
    formulario: {
      areas: { area: AreaPersonal }[];
      filtraPersonalPorRol: boolean;
    },
    roles?: readonly RolDepartamental[],
  ): AreaPersonal[] {
    const admitidas = formulario.areas.map((area) => area.area);

    if (!roles?.length || !formulario.filtraPersonalPorRol) return admitidas;

    const suyas = areasDeLosRoles(roles);
    return admitidas.filter((area) => suyas.includes(area));
  }
}

/**
 * La conversión es directa porque el repositorio ya trae solo estos campos: la cédula
 * y el teléfono nunca llegaron hasta aquí.
 */
/** `APELLIDOS NOMBRES`, como se nombra a las personas en todo el sistema. */
function nombreDe(funcionario: DatosParaSeleccion): string {
  return `${funcionario.apellidos} ${funcionario.nombres}`;
}

function conVeredicto(
  funcionario: DatosParaSeleccion,
  motivo: string | null,
): PersonaElegible {
  return {
    id: funcionario.id,
    apellidos: funcionario.apellidos,
    nombres: funcionario.nombres,
    area: funcionario.area,
    cargo: funcionario.cargo,
    zonalId: funcionario.zonalId,
    elegible: motivo === null,
    motivo,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SEÑAL DE EQUIDAD Y SUGERENCIA DE REPARTO (2026-09-29).
 *
 * Calcula la CUOTA JUSTA del grupo de elegibles —la MEDIA de sus cargas— y sitúa a cada persona
 * frente a ella con `clasificarEquidad`: DEBAJO / EQUILIBRADO / ENCIMA de su parte. Marca `sugerido`
 * a los ELEGIBLES que están por DEBAJO de su cuota, que son los candidatos a recibir más para
 * equilibrar el reparto. No cambia `elegible` ni el orden: es advisory.
 *
 * ES DISTINTA DE LA FATIGA A PROPÓSITO. La fatiga es SEGURIDAD: absoluta, por umbrales, ya resuelta
 * en el `nivelFatiga` que trae la política. La equidad es REPARTO: relativa a la media del grupo.
 * Antes un único «semáforo por tercios» mezclaba ambas y daba resultados engañosos con grupos
 * pequeños o cargas concentradas (el máximo podía quedar en ámbar, o alguien con una salida en
 * rojo). Separarlas resuelve las dos preguntas sin que una contamine a la otra.
 *
 * SI NADIE CARGA (cuota 0), no hay parte que repartir: `clasificarEquidad` deja a todos EQUILIBRADO
 * y no se sugiere a nadie. La cuota se toma solo de los ELEGIBLES —entre quienes de verdad se
 * reparte—; a un no elegible se le informa su nivel, pero nunca se le sugiere.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function equilibrar(
  personas: PersonaElegible[],
  margen: number,
): PersonaElegible[] {
  const cargasElegibles = personas
    .filter((persona) => persona.elegible && persona.indiceCarga !== undefined)
    .map((persona) => persona.indiceCarga as number);

  if (cargasElegibles.length === 0) return personas;

  const cuotaJusta =
    cargasElegibles.reduce((suma, carga) => suma + carga, 0) /
    cargasElegibles.length;

  return personas.map((persona) => {
    if (persona.indiceCarga === undefined) return persona;

    const equidad = clasificarEquidad(persona.indiceCarga, cuotaJusta, margen);
    return {
      ...persona,
      cuotaJusta: equidad.cuotaJusta,
      desviacionCarga: equidad.desviacion,
      nivelEquidad: equidad.nivel,
      // Sugerido = elegible y por DEBAJO de su cuota justa (candidato a recibir más).
      sugerido: persona.elegible && equidad.nivel === 'DEBAJO',
    };
  });
}
