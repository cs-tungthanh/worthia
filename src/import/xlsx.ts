import { strFromU8, unzipSync } from "fflate";

// Minimal .xlsx reader: an .xlsx is a zip of XML files. Reads the first worksheet into rows of cells,
// indexed by column (A = 0). Enough for broker statements; no formulas, styles or dates-as-formats.

export type Cell = string | number | null;

const colIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

// Tags by local name: some generators write <x:row> instead of <row>.
const byTag = (el: Document | Element, name: string) => [...el.getElementsByTagNameNS("*", name)];

export function readFirstSheet(data: Uint8Array): Cell[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter: (f) => f.name.startsWith("xl/") });
  } catch {
    throw new Error("This isn't a valid .xlsx file.");
  }
  const parse = (name: string) => {
    const bytes = files[name];
    return bytes ? new DOMParser().parseFromString(strFromU8(bytes), "application/xml") : null;
  };

  // Text cells usually point into a shared table. Phonetic runs (<rPh>) aren't part of the text.
  const sharedDoc = parse("xl/sharedStrings.xml");
  const shared = (sharedDoc ? byTag(sharedDoc, "si") : []).map((si) =>
    byTag(si, "t")
      .filter((t) => t.parentElement?.localName !== "rPh")
      .map((t) => t.textContent ?? "")
      .join(""),
  );

  // The first sheet listed in the workbook, wherever its file is.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const workbook = parse("xl/workbook.xml");
  const rels = parse("xl/_rels/workbook.xml.rels");
  const firstSheet = workbook ? byTag(workbook, "sheet")[0] : undefined;
  const relId = firstSheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  const rel = (rels ? byTag(rels, "Relationship") : []).find((r) => r.getAttribute("Id") === relId);
  const target = rel?.getAttribute("Target");
  if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;

  const sheet = parse(sheetPath);
  if (!sheet) throw new Error("The spreadsheet has no worksheet.");

  return byTag(sheet, "row").map((row) => {
    const cells: Cell[] = [];
    for (const c of byTag(row, "c")) {
      const i = colIndex(c.getAttribute("r") ?? "A");
      const type = c.getAttribute("t");
      const v = byTag(c, "v")[0]?.textContent ?? null;
      let value: Cell = null;
      if (type === "s" && v != null) value = shared[Number(v)] ?? null;
      else if (type === "inlineStr")
        value = byTag(c, "t")
          .map((t) => t.textContent ?? "")
          .join("");
      else if (type === "str" || type === "e") value = v;
      else if (v != null) value = Number(v);
      cells[i] = value;
    }
    return cells;
  });
}
