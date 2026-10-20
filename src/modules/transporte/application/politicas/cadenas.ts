/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · cadenas por funcionario
 * Archivo: cadenas.ts
 * Responsabilidad: Agrupar en un BLOQUE los operativos seguidos de un mismo funcionario.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * INSPECCIÓN CREA IDs SEPARADOS (ID-33, ID-34, ID-35) PARA LA MISMA PERSONA EN HORARIOS SEGUIDOS.
 * En la calle son un solo recorrido: deben ir con el mismo conductor y el mismo vehículo. Aquí se
 * calcula esa cadena —no se guarda: depende de los horarios, que pueden cambiar—.
 *
 * Dos operativos encadenan si comparten al menos un funcionario y el FIN de uno es exactamente el
 * INICIO del otro en la línea de tiempo de la jornada. El encadenamiento es transitivo: un tercero
 * que encadena con el segundo entra en el mismo bloque. Lo implementa un conjunto disjunto (unión-
 * búsqueda) sobre los operativos.
 *
 * ES PURA.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { franjaDe, type Franja } from './linea-de-tiempo';

/** Lo que la cadena necesita de un operativo. */
export interface OperativoDeCadena {
  id: number;
  horaInicio: string;
  horaFin: string;
  funcionarioIds: readonly number[];
}

/** Un bloque: los operativos que van juntos, en orden de inicio, y su franja total. */
export interface BloqueTransporte {
  operativoIds: number[];
  funcionarioIds: number[];
  franja: Franja;
}

/** Agrupa los operativos en bloques encadenados. Los sueltos quedan en un bloque de uno. */
export function agruparCadenas(
  operativos: readonly OperativoDeCadena[],
  inicioJornada: string,
): BloqueTransporte[] {
  const franjas = new Map<number, Franja>();
  for (const operativo of operativos) {
    franjas.set(
      operativo.id,
      franjaDe(operativo.horaInicio, operativo.horaFin, inicioJornada),
    );
  }

  // Unión-búsqueda con compresión de caminos.
  const padre = new Map<number, number>(operativos.map((o) => [o.id, o.id]));
  const raiz = (id: number): number => {
    let actual = id;
    while (padre.get(actual) !== actual) actual = padre.get(actual) as number;
    let paso = id;
    while (padre.get(paso) !== actual) {
      const siguiente = padre.get(paso) as number;
      padre.set(paso, actual);
      paso = siguiente;
    }
    return actual;
  };
  const unir = (a: number, b: number): void => {
    const ra = raiz(a);
    const rb = raiz(b);
    if (ra !== rb) padre.set(rb, ra);
  };

  // Por funcionario: sus operativos en orden; encadena el que empieza justo cuando termina otro.
  const porFuncionario = new Map<number, OperativoDeCadena[]>();
  for (const operativo of operativos) {
    for (const funcionarioId of operativo.funcionarioIds) {
      const lista = porFuncionario.get(funcionarioId) ?? [];
      lista.push(operativo);
      porFuncionario.set(funcionarioId, lista);
    }
  }
  for (const lista of porFuncionario.values()) {
    for (const a of lista) {
      for (const b of lista) {
        if (a.id === b.id) continue;
        const fa = franjas.get(a.id) as Franja;
        const fb = franjas.get(b.id) as Franja;
        if (fa.fin === fb.inicio) unir(a.id, b.id);
      }
    }
  }

  const grupos = new Map<number, OperativoDeCadena[]>();
  for (const operativo of operativos) {
    const r = raiz(operativo.id);
    const grupo = grupos.get(r) ?? [];
    grupo.push(operativo);
    grupos.set(r, grupo);
  }

  const bloques: BloqueTransporte[] = [...grupos.values()].map((grupo) => {
    const ordenados = [...grupo].sort(
      (a, b) =>
        (franjas.get(a.id) as Franja).inicio -
          (franjas.get(b.id) as Franja).inicio || a.id - b.id,
    );
    const funcionarios = new Set<number>();
    for (const o of ordenados)
      o.funcionarioIds.forEach((f) => funcionarios.add(f));
    return {
      operativoIds: ordenados.map((o) => o.id),
      funcionarioIds: [...funcionarios].sort((a, b) => a - b),
      franja: {
        inicio: Math.min(
          ...ordenados.map((o) => (franjas.get(o.id) as Franja).inicio),
        ),
        fin: Math.max(
          ...ordenados.map((o) => (franjas.get(o.id) as Franja).fin),
        ),
      },
    };
  });

  return bloques.sort(
    (a, b) =>
      a.franja.inicio - b.franja.inicio ||
      a.operativoIds[0] - b.operativoIds[0],
  );
}
