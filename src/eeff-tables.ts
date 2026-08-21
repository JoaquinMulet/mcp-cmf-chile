/**
 * Post-procesamiento de tablas de estados financieros extraídas de PDFs:
 * 1) Separación de cifras: una celda con N números → N celdas.
 * 2) Des-fusión de conceptos: N conceptos + cifras → N filas en orden.
 * 3) Notas al pie: se detectan por POSICIÓN (columnas sobrantes tras asignar
 *    K conceptos × C columnas), nunca "porque parecen un número".
 * 4) Detección honesta: separadas vs fusionadas pendientes vs cifras separadas.
 * 5) Cuadratura contable (identidades del balance).
 */

type EstadoVerificacion = "cuadra" | "no_cuadra" | "no_verificado";

interface VerificacionIdentidad {
  /** "cuadra": identidad se cumple; "no_cuadra": hay diferencia real;
   *  "no_verificado": falta una fila clave (puede estar fusionada o con otro nombre). */
  estado: EstadoVerificacion;
  /** Compatibilidad: true solo si estado === "cuadra". */
  ok: boolean;
  diferencia: number | null;
}

interface CuadraturaResult {
  activos: VerificacionIdentidad;
  balance: VerificacionIdentidad;
  patrimonio: VerificacionIdentidad;
}

export interface ProcesamientoTablas {
  markdown: string;
  filasSeparadas: number;
  filasFusionadasPendientes: number;
  filasCifrasSeparadas: number;
  cuadratura: CuadraturaResult | null;
  esEstadoFinanciero: boolean;
}

/** Normaliza un número chileno: "1.234,56" o "1234.56" o "1 234" → número. */
function parsearNumero(s: string): number | null {
  const t = s.replace(/[$\s]/g, "").trim();
  if (!t || !/[\d]/.test(t)) return null;
  let n: number;
  if (t.includes(",")) {
    n = parseFloat(t.replace(/\./g, "").replace(",", "."));
  } else {
    const partes = t.split(".");
    if (partes.length > 1 && partes[partes.length - 1].length === 3) {
      n = parseFloat(t.replace(/\./g, ""));
    } else {
      n = parseFloat(t);
    }
  }
  return Number.isFinite(n) ? n : null;
}

/** Divide una celda con múltiples conceptos: primero antes de cada TOTAL/Total,
 *  luego por el patrón "minúscula→Mayúscula". */
function partirConceptos(celda: string): string[] {
  const t = celda.trim().replace(/\s+/g, " ");
  if (!t) return [];
  // Las mayúsculas consecutivas no dan transición: "PATRIMONIO TOTAL DE PASIVOS" → 2 conceptos.
  const porTotales = t.split(/\s+(?=(?:TOTAL(?:ES)?|Total)\b)/g);
  // Solo transiciones minúscula→Mayúscula (lookbehind): "controladoras TOTAL" sí,
  // "TOTAL DE" no (mayúscula→mayúscula no corta). Puntuación terminal ("a,", ")") cuenta.
  const partes = porTotales.flatMap((p) => p.split(/(?<=[a-záéíóúñü0-9,;.)])\s+(?=[A-ZÁÉÍÓÚÑ])/g));
  return partes.map((p) => p.replace(/[,;]+$/g, "").trim()).filter((p) => p.length > 0);
}

/** ¿La celda contiene 2 o más nombres de concepto? (señal barata: comas o mayúscula tras minúscula) */
function esConceptoFusionado(celda: string): boolean {
  const t = celda.trim();
  if (!t) return false;
  const conComa = t.includes(",") && t.split(",").filter((p) => p.trim().length > 2).length > 1;
  // 1 transición minúscula→Mayúscula ya implica 2 nombres ("Otras reservas Patrimonio…")
  const conMayusculas = (t.match(/[a-záéíóúñü][a-záéíóúñü]+\s+[A-ZÁÉÍÓÚÑ]/g) ?? []).length >= 1;
  return conComa || conMayusculas;
}

/** ¿Esta parte de la celda puede ser un nombre de concepto? (descarta "UF", "AUD", "R.U.T."…) */
function esParteDeConcepto(p: string): boolean {
  return /^(?:TOTAL(?:ES)?|Total)\b/.test(p) || (p.length >= 4 && !/%|\./.test(p));
}

/** Tokeniza los números de una celda de cifra. */
function tokensDeCifra(celda: string): string[] {
  return celda.split(/\s+/).filter((t) => /\d/.test(t));
}

const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const CLAVES_CUADRATURA: { fila: string; conceptos: string[] }[] = [
  { fila: "total activos", conceptos: ["total de activos", "total activos"] },
  { fila: "activos corrientes", conceptos: ["total de activos corrientes", "activos corrientes totales", "total activos corrientes"] },
  { fila: "activos no corrientes", conceptos: ["total de activos no corrientes", "activos no corrientes totales", "total activos no corrientes"] },
  { fila: "total pasivos", conceptos: ["total de pasivos"] },
  { fila: "pasivos corrientes", conceptos: ["total de pasivos corrientes", "pasivos corrientes totales", "total pasivos corrientes"] },
  { fila: "pasivos no corrientes", conceptos: ["total de pasivos no corrientes", "pasivos no corrientes totales", "total pasivos no corrientes"] },
  { fila: "total pasivos y patrimonio", conceptos: ["total de pasivos y patrimonio", "total de patrimonio y pasivos"] },
  { fila: "patrimonio total", conceptos: ["patrimonio total", "total de patrimonio", "total patrimonio", "patrimonio neto total"] },
  {
    fila: "patrimonio atribuible",
    conceptos: ["patrimonio atribuible a los propietarios de la controladora", "patrimonio atribuible a los propietarios"],
  },
  { fila: "participaciones no controladoras", conceptos: ["participaciones no controladoras"] },
];

function buscarFila(lineas: { concepto: string; cifras: (number | null)[] }[], clave: string): number[] {
  const conceptos = CLAVES_CUADRATURA.filter((x) => x.fila === clave)[0]?.conceptos ?? [];
  const candidatas: number[] = [];
  for (const l of lineas) {
    const n = normalizar(l.concepto);
    if (conceptos.some((c) => n === c)) {
      for (const v of l.cifras) if (v !== null) candidatas.push(v);
    }
  }
  if (candidatas.length > 0) return candidatas;
  // Fallback por inclusión: solo si la fila matchea EXACTAMENTE una clave del mapa.
  // Si matchea 2+ (p.ej. una fusión no separada), no es confiable: doble conteo.
  const todas = CLAVES_CUADRATURA.flatMap((x) => x.conceptos);
  const clavesOrdenadas = [...conceptos].sort((a, b) => b.length - a.length);
  for (const l of lineas) {
    const n = normalizar(l.concepto);
    const cuantas = todas.filter((c) => n.includes(c)).length;
    if (cuantas === 1 && clavesOrdenadas.some((c) => n.includes(c))) {
      for (const v of l.cifras) if (v !== null) return [v];
    }
  }
  return [];
}

/** Verifica las tres identidades del balance. */
function verificarCuadratura(lineas: { concepto: string; cifras: (number | null)[] }[]): CuadraturaResult | null {
  const total = (clave: string): number | null => {
    const v = buscarFila(lineas, clave);
    return v.length > 0 ? v[0] : null;
  };
  const at = total("total activos");
  const ac = total("activos corrientes");
  const anc = total("activos no corrientes");
  const tpy = total("total pasivos y patrimonio");
  const pt = total("patrimonio total");
  const pa = total("patrimonio atribuible");
  const pnc2 = total("participaciones no controladoras");

  const diff = (a: number | null, b: number | null, c: number | null): VerificacionIdentidad => {
    if (a === null || b === null) return { estado: "no_verificado", ok: false, diferencia: null };
    const d = a - (b + (c ?? 0));
    const ok = Math.abs(d) <= Math.max(1, Math.abs(a) * 0.001);
    return ok ? { estado: "cuadra", ok: true, diferencia: d } : { estado: "no_cuadra", ok: false, diferencia: d };
  };

  return {
    activos: diff(at, ac, anc),
    balance: diff(at, tpy, null),
    patrimonio: diff(pt, pa, pnc2),
  };
}

/**
 * Procesa el markdown de tablas de un PDF: separación de cifras, des-fusión de
 * conceptos (con descarte posicional de notas al pie) y cuadratura.
 */
export function procesarTablasEEFF(markdown: string): ProcesamientoTablas {
  const lineasOut: string[] = [];
  const filasContables: { concepto: string; cifras: (number | null)[] }[] = [];
  let filasSeparadas = 0;
  let filasFusionadasPendientes = 0;
  let filasCifrasSeparadas = 0;
  const esEstadoFinanciero = /estado.*situacion|estado.*resultado|patrimonio|flujo|balance/i.test(markdown.slice(0, 3000));

  for (const linea of markdown.split("\n")) {
    if (!linea.trim().startsWith("|")) {
      lineasOut.push(linea);
      continue;
    }
    const celdas = linea
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim().replace(/[*_`]/g, ""));
    if (celdas.length < 2) {
      lineasOut.push(linea);
      continue;
    }
    const concepto = celdas[0];
    const celdasCifra = celdas.slice(1);

    // 1) Separar cifras: cada token numérico a su celda
    const tokens: string[] = [];
    let cifrasSeparadasAqui = false;
    for (const c of celdasCifra) {
      const ts = tokensDeCifra(c);
      if (ts.length > 1) {
        tokens.push(...ts);
        cifrasSeparadasAqui = true;
      } else {
        tokens.push(c);
      }
    }
    if (cifrasSeparadasAqui) filasCifrasSeparadas++;

    if (esConceptoFusionado(concepto)) {
      const conceptos = partirConceptos(concepto).filter(esParteDeConcepto);
      const K = conceptos.length;
      const M = tokens.length;
      // Fusión plausible: 2+ conceptos y cifras para 2 períodos por concepto
      // (M en [2K, 3K]; sobrantes M%K son notas al pie, siempre a la izquierda).
      const plausible = K > 1 && M >= 2 * K && M <= 3 * K;
      if (plausible) {
        const sobrantes = M % K;
        const C = Math.floor(M / K);
        const utiles = sobrantes > 0 ? tokens.slice(sobrantes) : tokens;
        // Orden real de pdf-inspector: los períodos van AGRUPADOS (todos los
        // actuales primero, luego los anteriores). Transponer: concepto i →
        // (utiles[i], utiles[K+i], utiles[2K+i], ...).
        const filasNuevas: string[] = [];
        for (let i = 0; i < K; i++) {
          const cifrasConcepto: string[] = [];
          for (let j = 0; j < C; j++) {
            const t = utiles[i + j * K];
            if (t !== undefined) cifrasConcepto.push(t);
          }
          if (cifrasConcepto.length > 0) {
            filasNuevas.push(`| ${conceptos[i]} | ${cifrasConcepto.join(" | ")} |`);
            filasContables.push({ concepto: conceptos[i], cifras: cifrasConcepto.map((t) => parsearNumero(t)) });
          }
        }
        if (filasNuevas.length > 0) {
          lineasOut.push(...filasNuevas);
          filasSeparadas++;
          continue;
        }
      } else if (K > 1 && M > 3 * K) {
        // Exceso de cifras inmapeable: fusión real que el modelo debe separar a mano
        filasFusionadasPendientes++;
        lineasOut.push(`| ${concepto} | ${tokens.join(" | ")} |`);
        if (tokens.length >= 1) {
          filasContables.push({ concepto, cifras: tokens.map((t) => parsearNumero(t)) });
        }
        continue;
      }
      // No plausible (p.ej. "Franco Suizo", "Bonos UF"): tratar como fila normal
    }

    // 2) Fila normal: descartar la nota al pie si la primera cifra es un entero pequeño (≤99)
    let cifrasFinales = tokens;
    if (tokens.length > 1) {
      const primero = parsearNumero(tokens[0]);
      if (primero !== null && Number.isInteger(primero) && primero >= 0 && primero <= 99) {
        cifrasFinales = tokens.slice(1);
      }
    }
    const esEncabezadoOpcion = /%|R\.U\.T\./.test(concepto);
    if (cifrasFinales.length >= 1 && !esEncabezadoOpcion) {
      filasContables.push({ concepto, cifras: cifrasFinales.map((t) => parsearNumero(t)) });
    }
    lineasOut.push(`| ${concepto} | ${cifrasFinales.join(" | ")} |`);
  }

  const cuadratura = esEstadoFinanciero ? verificarCuadratura(filasContables) : null;
  return {
    markdown: lineasOut.join("\n"),
    filasSeparadas,
    filasFusionadasPendientes,
    filasCifrasSeparadas,
    cuadratura,
    esEstadoFinanciero,
  };
}

/** Texto de verificación contable para la respuesta. Nunca vacío en un estado financiero:
 *  si nada se pudo verificar, ese es justo el caso en que más debe hablar. */
export function textoVerificacion(r: ProcesamientoTablas): string {
  if (!r.esEstadoFinanciero) return "";
  if (!r.cuadratura) return "";
  const nombreFila: Record<keyof CuadraturaResult, { ok: string; mal: string; falta: string }> = {
    activos: {
      ok: "total de activos = corrientes + no corrientes (cuadra)",
      mal: "total de activos ≠ corrientes + no corrientes",
      falta: "'total de activos' o 'total de activos corrientes/no corrientes'",
    },
    balance: {
      ok: "total de activos = total de pasivos y patrimonio (cuadra)",
      mal: "total de activos ≠ total de pasivos y patrimonio",
      falta: "'total de pasivos y patrimonio'",
    },
    patrimonio: {
      ok: "patrimonio total = atribuible + no controladoras (cuadra)",
      mal: "patrimonio total ≠ atribuible + no controladoras",
      falta: "'patrimonio total', 'patrimonio atribuible' o 'participaciones no controladoras'",
    },
  };
  const partes: string[] = [];
  let faltan = 0;
  for (const k of ["activos", "balance", "patrimonio"] as const) {
    const r2 = r.cuadratura[k];
    if (r2.estado === "no_verificado") {
      partes.push(`no encontré ${nombreFila[k].falta} como fila separada (¿está fusionada con otra? búscala en el markdown y verifica tú)`);
      faltan++;
    } else if (r2.estado === "cuadra") {
      partes.push(nombreFila[k].ok);
    } else {
      partes.push(`${nombreFila[k].mal} (difiere por ${Math.abs(r2.diferencia ?? 0)})`);
    }
  }
  const hayError = partes.some((p) => p.includes("≠"));
  if (faltan === 3) {
    const pend = r.filasFusionadasPendientes > 0
      ? ` Hay ${r.filasFusionadasPendientes} filas fusionadas pendientes (ver aviso de extracción): los totales pueden estar ahí.`
      : " Las filas clave pueden tener otro nombre en este formato.";
    return `\n\nVerificación contable: no pude verificar ninguna identidad — ${partes.join("; ")}.${pend} Sepáralas o encuéntralas tú y verifica las cifras antes de citarlas.`;
  }
  const cabecera = hayError ? "Verificación contable: NO cuadra" : faltan > 0 ? "Verificación contable: incompleta" : "Verificación contable: cuadra";
  return `\n\n${cabecera} — ${partes.join("; ")}.${hayError || faltan > 0 ? " Si cita cifras, verifíquelas contra el documento." : ""}`;
}

/** Aviso honesto según qué pasó realmente. */
export function textoAviso(r: ProcesamientoTablas): string {
  const partes: string[] = [];
  if (r.filasSeparadas > 0) {
    partes.push(`${r.filasSeparadas} filas venían fusionadas y fueron separadas (cifra i del concepto i, en orden)`);
  }
  if (r.filasFusionadasPendientes > 0) {
    partes.push(
      `${r.filasFusionadasPendientes} filas tienen varios conceptos compartiendo celda y NO se separaron automáticamente: sepáralas tú antes de citar (la primera cifra es del primer concepto, la segunda del segundo)`,
    );
  }
  if (r.filasCifrasSeparadas > 0) {
    partes.push(`${r.filasCifrasSeparadas} filas tenían varias cifras en una celda y fueron separadas`);
  }
  if (partes.length === 0) return "";
  return `\n\nAVISO DE EXTRACCION — ${partes.join(". ")}.\n\nAntes de citar cualquier cifra:\n1. Si una celda de concepto contiene mas de un nombre, sepáralos. Las cifras corresponden a esos conceptos EN EL MISMO ORDEN.\n2. NUNCA tomes la primera cifra de una celda con varias como el valor del ultimo concepto nombrado. Es el error mas comun y afecta justo a los totales.\n3. Comprueba la cuadratura antes de responder:\n     total de activos = activos corrientes + activos no corrientes\n     total de activos = total de pasivos y patrimonio\n     patrimonio total = atribuible a la controladora + no controladoras\n   Si no cuadra, la mal asignada es tu lectura, no el documento. Vuelve atras y reasigna.\n4. Si una tabla tiene mas celdas vacias que llenas, no la uses: di que ese estado no se pudo estructurar y cita el documento original.`;
}
