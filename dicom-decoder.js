import dicomParser from "https://cdn.jsdelivr.net/npm/dicom-parser@1.8.21/+esm";

const UNCOMPRESSED_TRANSFER_SYNTAXES = new Map([
  ["1.2.840.10008.1.2", { label: "Implicit VR Little Endian", littleEndian: true }],
  ["1.2.840.10008.1.2.1", { label: "Explicit VR Little Endian", littleEndian: true }],
  ["1.2.840.10008.1.2.2", { label: "Explicit VR Big Endian", littleEndian: false }]
]);

export function isDicomFile(file) {
  return file?.name?.toLowerCase().endsWith(".dcm") || file?.type === "application/dicom";
}

export async function decodeDicom(file) {
  const byteArray = new Uint8Array(await file.arrayBuffer());
  let dataSet;
  try {
    dataSet = dicomParser.parseDicom(byteArray);
  } catch (error) {
    throw new Error(`Invalid DICOM data: ${error?.message || error}`);
  }

  const transferSyntaxUid = firstValue(dataSet.string("x00020010")) || "1.2.840.10008.1.2";
  const transferSyntax = UNCOMPRESSED_TRANSFER_SYNTAXES.get(transferSyntaxUid);
  if (!transferSyntax) {
    throw new Error(`Unsupported compressed DICOM transfer syntax: ${transferSyntaxUid}`);
  }

  const rows = requiredUint16(dataSet, "x00280010", "Rows");
  const columns = requiredUint16(dataSet, "x00280011", "Columns");
  const samplesPerPixel = dataSet.uint16("x00280002") || 1;
  const frames = positiveInteger(firstValue(dataSet.string("x00280008")), 1);
  const photometric = firstValue(dataSet.string("x00280004")) || "MONOCHROME2";
  const bitsAllocated = requiredUint16(dataSet, "x00280100", "Bits Allocated");
  const bitsStored = dataSet.uint16("x00280101") || bitsAllocated;
  const highBit = dataSet.uint16("x00280102") ?? (bitsStored - 1);
  const signed = dataSet.uint16("x00280103") === 1;

  if (frames !== 1) {
    throw new Error(`Multi-frame DICOM is not supported yet (${frames} frames)`);
  }
  if (samplesPerPixel !== 1 || !["MONOCHROME1", "MONOCHROME2"].includes(photometric)) {
    throw new Error(`Unsupported DICOM pixel format: ${photometric}, ${samplesPerPixel} sample(s)`);
  }
  if (![8, 16].includes(bitsAllocated) || bitsStored < 1 || bitsStored > bitsAllocated || highBit >= bitsAllocated) {
    throw new Error(`Unsupported DICOM bit layout: ${bitsStored}-bit stored in ${bitsAllocated}-bit samples`);
  }

  const pixelElement = dataSet.elements.x7fe00010;
  if (!pixelElement || pixelElement.length === undefined || pixelElement.length === 0xffffffff) {
    throw new Error("DICOM Pixel Data is missing or encapsulated");
  }
  const pixelCount = rows * columns;
  const bytesPerSample = bitsAllocated / 8;
  const requiredBytes = pixelCount * bytesPerSample;
  if (pixelElement.length < requiredBytes || pixelElement.dataOffset + requiredBytes > byteArray.length) {
    throw new Error(`DICOM Pixel Data is truncated (expected ${requiredBytes} bytes)`);
  }

  const slope = finiteNumber(firstValue(dataSet.string("x00281053")), 1);
  const intercept = finiteNumber(firstValue(dataSet.string("x00281052")), 0);
  const shift = highBit - bitsStored + 1;
  const mask = bitsStored === 16 ? 0xffff : (2 ** bitsStored) - 1;
  const signBit = 2 ** (bitsStored - 1);
  const signedRange = 2 ** bitsStored;
  const codeMinimum = signed ? -signBit : 0;
  const codeMaximum = signed ? signBit - 1 : mask;
  const codeRange = codeMaximum - codeMinimum || 1;
  const view = new DataView(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength);
  const pixels = new Float32Array(pixelCount * 4);

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = pixelElement.dataOffset + index * bytesPerSample;
    const stored = bitsAllocated === 8
      ? view.getUint8(offset)
      : view.getUint16(offset, transferSyntax.littleEndian);
    let value = Math.floor(stored / (2 ** shift)) & mask;
    if (signed && value >= signBit) value -= signedRange;
    const normalized = (value - codeMinimum) / codeRange;
    const target = index * 4;
    pixels[target] = normalized;
    pixels[target + 1] = normalized;
    pixels[target + 2] = normalized;
    pixels[target + 3] = 1;
  }

  const windowCenter = finiteNumber(firstValue(dataSet.string("x00281050")), Number.NaN);
  const windowWidth = finiteNumber(firstValue(dataSet.string("x00281051")), Number.NaN);
  const modalityDisplayRange = dicomWindowRange(windowCenter, windowWidth);
  const displayRange = normalizeDicomDisplayRange(
    modalityDisplayRange,
    slope,
    intercept,
    codeMinimum,
    codeRange
  );

  return {
    width: columns,
    height: rows,
    pixels,
    photometric,
    displayInvert: photometric === "MONOCHROME1",
    displayRange,
    transferSyntaxUid,
    transferSyntaxLabel: transferSyntax.label,
    bitsAllocated,
    bitsStored,
    signed,
    slope,
    intercept,
    integerEncoding: {
      bits: bitsStored,
      signed,
      normalized: true,
      transfer: "linear",
      syntheticAlpha: true,
      slope,
      intercept
    }
  };
}

function requiredUint16(dataSet, tag, label) {
  const value = dataSet.uint16(tag);
  if (!Number.isInteger(value) || value < 1) throw new Error(`DICOM ${label} is missing`);
  return value;
}

function firstValue(value) {
  return typeof value === "string" ? value.split("\\")[0].trim() : "";
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dicomWindowRange(center, width) {
  if (!Number.isFinite(center) || !Number.isFinite(width) || width <= 1) return null;
  return {
    min: center - 0.5 - (width - 1) / 2,
    max: center - 0.5 + (width - 1) / 2
  };
}

function normalizeDicomDisplayRange(range, slope, intercept, codeMinimum, codeRange) {
  if (!range || !Number.isFinite(slope) || slope === 0) return null;
  const first = ((range.min - intercept) / slope - codeMinimum) / codeRange;
  const second = ((range.max - intercept) / slope - codeMinimum) / codeRange;
  return { min: Math.min(first, second), max: Math.max(first, second) };
}
