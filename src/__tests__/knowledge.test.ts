import { describe, expect, it } from "vitest";
import {
  KB_MAX_CHUNK_CHARS,
  buildQuery,
  chunkText,
  chunkVisibleTo,
  cosine,
  docChunkTexts,
  normalize,
  packVec,
  rankChunks,
  rowText,
  unpackVec,
} from "@/lib/knowledge";

describe("chunkText", () => {
  it("returns nothing for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n  ")).toEqual([]);
  });

  it("keeps a short text as a single chunk", () => {
    expect(chunkText("Halo dunia. Ini singkat.")).toEqual(["Halo dunia. Ini singkat."]);
  });

  it("splits long text and never exceeds max", () => {
    const out = chunkText("Kalimat panjang ".repeat(200)); // ~3000 chars, one paragraph
    expect(out.length).toBeGreaterThan(1);
    expect(Math.max(...out.map((c) => c.length))).toBeLessThanOrEqual(1600);
  });

  it("carries overlap from the previous chunk", () => {
    const out = chunkText(`${"A".repeat(600)}\n\n${"B".repeat(600)}`);
    expect(out).toHaveLength(2);
    expect(out[1]!.startsWith("A".repeat(150))).toBe(true);
  });
});

describe("rowText / docChunkTexts", () => {
  it("serializes a row, dropping empty cells", () => {
    expect(rowText("Produk", ["Nama", "Harga", "Kosong"], ["Tote", "150k", ""])).toBe("Produk\nNama: Tote | Harga: 150k");
  });

  it("makes one chunk per non-empty table row", () => {
    const chunks = docChunkTexts({
      type: "table",
      title: "T",
      columns: JSON.stringify(["A", "B"]),
      rows: JSON.stringify([
        ["1", "2"],
        ["", ""],
        ["3", ""],
      ]),
      text: null,
    });
    expect(chunks).toEqual(["T\nA: 1 | B: 2", "T\nA: 3"]);
  });

  it("splits a table row with a huge cell, keeping the title on every piece", () => {
    const chunks = docChunkTexts({
      type: "table",
      title: "Produk",
      columns: JSON.stringify(["Nama", "Deskripsi"]),
      rows: JSON.stringify([["Tote", "kata ".repeat(800)]]),
      text: null,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(KB_MAX_CHUNK_CHARS);
      expect(c.startsWith("Produk\n")).toBe(true);
    }
  });

  it("chunks free text documents", () => {
    expect(docChunkTexts({ type: "text", title: "FAQ", columns: null, rows: null, text: "Satu.\n\nDua." })).toEqual(["FAQ\nSatu.\n\nDua."]);
  });
});

describe("vectors", () => {
  it("round-trips a vector through base64", () => {
    const v = [0.5, -0.25, 1, 0];
    expect(Array.from(unpackVec(packVec(v)))).toEqual(v);
  });

  it("computes cosine similarity", () => {
    expect(cosine(normalize([3, 4]), normalize([3, 4]))).toBeCloseTo(1, 5);
    expect(cosine(normalize([1, 0]), normalize([0, 1]))).toBeCloseTo(0, 5);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });
});

describe("rankChunks", () => {
  const candidates = [
    { docId: "a", ord: 0, text: "close", vec: [1, 0] },
    { docId: "b", ord: 1, text: "mid", vec: [0.7, 0.7] },
    { docId: "c", ord: 2, text: "far", vec: [-1, 0] },
  ];

  it("orders by similarity and honours k", () => {
    expect(rankChunks([1, 0], candidates, { k: 2, minScore: 0 }).map((t) => t.text)).toEqual(["close", "mid"]);
  });

  it("drops chunks below minScore", () => {
    expect(rankChunks([1, 0], candidates, { k: 5, minScore: 0.9 }).map((t) => t.text)).toEqual(["close"]);
  });

  it("ignores vectors whose dimension differs from the query", () => {
    const mixed = [
      { docId: "a", ord: 0, text: "right width", vec: [1, 0] },
      { docId: "b", ord: 1, text: "wrong width", vec: [1, 0, 0] },
    ];
    // A partial dot product would otherwise make the 3-dim vector look like a perfect match.
    expect(rankChunks([1, 0], mixed, { k: 5, minScore: 0 }).map((t) => t.text)).toEqual(["right width"]);
  });
});

describe("buildQuery", () => {
  it("uses the last incoming messages, ignoring our own", () => {
    const q = buildQuery([
      { fromMe: false, body: "halo" },
      { fromMe: true, body: "ya" },
      { fromMe: false, body: "berapa harga tote bag?" },
    ]);
    expect(q).toBe("halo\nberapa harga tote bag?");
  });
});

describe("chunkVisibleTo", () => {
  it("global entries apply to every account", () => {
    expect(chunkVisibleTo(null, "native:a")).toBe(true);
    expect(chunkVisibleTo(null, "native:b")).toBe(true);
    expect(chunkVisibleTo(null, null)).toBe(true);
  });

  it("an account's entries are never visible to another account", () => {
    expect(chunkVisibleTo("native:a", "native:a")).toBe(true);
    expect(chunkVisibleTo("native:a", "native:b")).toBe(false);
    expect(chunkVisibleTo("native:b", "native:a")).toBe(false);
  });

  it("the un-scoped view ('All accounts') sees global entries only", () => {
    expect(chunkVisibleTo("native:a", null)).toBe(false);
  });
});
